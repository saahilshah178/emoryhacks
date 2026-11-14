"""Check video normalisation and the in-browser recording flow by hand. No Gemini calls.

  cd backend
  uv run python -m scripts.try_recording normalize FILE [FILE ...]
      Show, for each file, why it would be remuxed or re-encoded, the result's probe
      info, its largest keyframe gap and whether its index is at the front.

  uv run --with playwright python -m scripts.try_recording chrome [--base URL] [--seconds N] [--webm]
      Drive the installed Google Chrome headlessly with a fake camera: record N seconds
      on record.html (nurse) and on attempt.html (caregiver), let each upload, then check
      the stored video's duration and that seeking it in a <video> element fires "seeked"
      at the requested time. --webm hides MP4 support from MediaRecorder so Chrome
      records WebM, as Firefox does. Start the server first with FIRSTSHIFT_FAKE_AI=1.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from app import media


def normalize_files(paths: list[str]) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        for path in paths:
            print(f"== {path}")
            try:
                before = media.probe(path)
                reason = media.transcode_reason(path, before)
                started = time.time()
                out = Path(tmp) / "out.mp4"
                after = media.normalize(path, out)
            except media.MediaError as exc:
                print(f"   rejected: {exc}")
                continue
            keys, end = media.keyframe_times(out)
            gap = max(b - a for a, b in zip([0.0, *keys], [*keys, end]))
            boxes = media.mp4_boxes(out)
            print(f"   input:  {before}")
            print(f"   action: {'re-encode (' + reason + ')' if reason else 'remux'} in {time.time() - started:.1f}s")
            print(f"   output: {after}")
            print(f"   keyframe gap max {gap:.2f}s, faststart={boxes.index('moov') < boxes.index('mdat')}")


def _get_json(url: str) -> dict:
    with urllib.request.urlopen(url) as res:
        return json.load(res)


# Runs in the page: load a video, seek to `target`, and report where "seeked" landed.
SEEK_CHECK = """async ([src, target]) => {
  const v = document.createElement("video");
  v.muted = true; v.preload = "auto"; v.src = src;
  document.body.append(v);
  await new Promise((ok, fail) => { v.onloadedmetadata = ok; v.onerror = () => fail(new Error("video failed to load")); });
  const duration = v.duration;
  const seeked = new Promise((ok) => v.addEventListener("seeked", () => ok(v.currentTime), { once: true }));
  v.currentTime = target;
  const landed = await Promise.race([seeked, new Promise((ok) => setTimeout(() => ok(null), 10000))]);
  v.remove();
  return { duration, landed };
}"""


def _record(page, base: str, path: str, seconds: float, done_prefix: str) -> dict:
    """Record `seconds` on a page with the fake camera, upload, wait for the redirect."""
    page.goto(base + path)
    page.click("[data-act=camera]")
    page.wait_for_selector("[data-act=start]:not([hidden])")
    mime = page.evaluate("import('/js/recorder.js').then((m) => m.pickMimeType())")
    page.click("[data-act=start]")
    page.wait_for_selector(".rec-timer:not([hidden])", timeout=10000)
    page.wait_for_timeout(seconds * 1000)
    page.click("[data-act=stop]")
    page.wait_for_selector("[data-act=use]:not([hidden])")
    recorded = page.evaluate("(window.__recStop - window.__recStart) / 1000")
    page.click("[data-act=use]")
    page.wait_for_url(f"**{done_prefix}*", timeout=180000)
    return {"mime": mime, "recorded_s": recorded, "url": page.url}


# Note when each MediaRecorder starts and stops, to compare with the stored duration.
TIME_RECORDER = """{
  const start = MediaRecorder.prototype.start;
  MediaRecorder.prototype.start = function (...args) {
    this.addEventListener("start", () => { window.__recStart = performance.now(); });
    this.addEventListener("stop", () => { window.__recStop = performance.now(); });
    return start.apply(this, args);
  };
}"""

# Make MediaRecorder claim it cannot write MP4, so the recorder falls back to WebM.
HIDE_MP4 = """{
  const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
  MediaRecorder.isTypeSupported = (t) => !t.startsWith("video/mp4") && supported(t);
}"""


def chrome(base: str, seconds: float, webm: bool) -> int:
    from playwright.sync_api import sync_playwright

    ok = True
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"])
        page = browser.new_page()
        page.add_init_script(TIME_RECORDER)
        if webm:
            page.add_init_script(HIDE_MP4)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and not m.text.startswith("Failed to load resource")
                and errors.append(m.text))
        page.on("response", lambda r: r.status >= 400 and not r.url.endswith("/favicon.ico")
                and errors.append(f"{r.status} {r.url}"))
        print(f"Chrome {browser.version}")

        page.goto(base + "/index.html")
        page.evaluate("localStorage.setItem('firstshift.role', 'nurse')")
        ref = _record(page, base, "/record.html", seconds, "/skill.html?id=")
        skill_id = ref["url"].split("id=")[1]
        skill = _get_json(f"{base}/api/skills/{skill_id}")
        checks = [("nurse reference", ref, skill["reference_video_id"])]

        page.evaluate("localStorage.setItem('firstshift.caregiverName', 'Fake Camera')")
        att = _record(page, base, f"/attempt.html?skill_id={skill_id}", seconds, "/result.html?id=")
        attempt = _get_json(f"{base}/api/attempts/{att['url'].split('id=')[1]}")
        checks.append(("caregiver attempt", att, attempt["video_id"]))

        for label, run, video_id in checks:
            video = _get_json(f"{base}/api/videos/{video_id}")
            target = round(video["duration_s"] * 0.6, 2)
            seek = page.evaluate(SEEK_CHECK, [f"/api/videos/{video_id}/file", target])
            duration_ok = abs(video["duration_s"] - run["recorded_s"]) <= 0.5
            seek_ok = seek["landed"] is not None and abs(seek["landed"] - target) < 0.1
            ok = ok and duration_ok and seek_ok
            print(f"{label}: container {run['mime']!r}, uploaded as {video['original_name']}")
            print(f"   recorded {run['recorded_s']:.2f}s, stored {video['duration_s']:.2f}s "
                  f"({video['width']}x{video['height']} @ {video['fps']} fps) -> {'ok' if duration_ok else 'MISMATCH'}")
            print(f"   <video> duration {seek['duration']:.2f}s; seek to {target}s fired seeked at {seek['landed']} "
                  f"-> {'ok' if seek_ok else 'FAILED'}")
        print("page errors (favicon 404s ignored):", errors or "none")
        browser.close()
    return 0 if ok and not errors else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("normalize")
    n.add_argument("files", nargs="+")
    c = sub.add_parser("chrome")
    c.add_argument("--base", default="http://localhost:8101")
    c.add_argument("--seconds", type=float, default=5)
    c.add_argument("--webm", action="store_true")
    args = parser.parse_args()
    if args.cmd == "normalize":
        normalize_files(args.files)
    else:
        sys.exit(chrome(args.base.rstrip("/"), args.seconds, args.webm))
