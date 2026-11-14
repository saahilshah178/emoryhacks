"""Run the rubric stage on reference videos with real Gemini calls and print the result.

  uv run python -m scripts.try_rubric "sittostand_primary.mp4"
  uv run python -m scripts.try_rubric "Glove Removal Primary.mp4" --verbose --out /tmp/rubrics
  uv run python -m scripts.try_rubric --sheet /tmp/rubrics /tmp/rubrics/sittostand_primary.json

With --out, each rubric is saved as JSON together with a contact sheet: one row per step
with the frames at its start, middle and end, for checking the timestamps by eye.
--sheet re-renders contact sheets from saved JSON files without calling Gemini.
A step that is only sometimes needed is printed with its condition, and the "rubric sight"
log lines show what was rewritten or removed because it could only be heard.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from app import catalog, config, db, gemini, jobs, media
from app.models import Classification, Rubric
from app.stages import rubric

FRAME_W = 360


def reference_video(filename: str) -> dict:
    """Reuse the newest stored copy of a reference file (and its Gemini upload) when there is one."""
    row = db.fetch_one(
        "SELECT * FROM videos WHERE kind='reference' AND original_name=%s ORDER BY recorded_at DESC LIMIT 1",
        (filename,),
    )
    if row and Path(row["path"]).exists():
        return row
    return jobs.ingest(str(config.REFERENCE_DIR / filename), "reference", filename)


def classification_for(filename: str) -> Classification:
    """The skill a reference file belongs to, from the catalog (the classify stage is not needed here)."""
    slug = next((s for s, f in catalog.REFERENCE_FILES.items() if filename in f.values()), "unknown_skill")
    entry = catalog.BY_SLUG.get(slug, {"name": slug.replace("_", " "), "category": "other"})
    return Classification(skill_slug=slug, skill_name=entry["name"], category=entry["category"], confidence=1.0,
                          summary="", people=[], order_matters=True)


def print_rubric(rb: Rubric, verbose: bool) -> None:
    for s in rb.steps:
        after = f" after {','.join(s.must_follow)}" if s.must_follow else ""
        crit = " CRITICAL" if s.critical else ""
        print(f"  {s.step_id:<4}{s.start_s:7.1f}-{s.end_s:<7.1f}{s.title}{crit}{after}")
        if s.applies_when:
            print(f"{'':<19}only needed when {s.applies_when}")
        if verbose:
            for name in ("pass_criteria", "fail_criteria", "unverified_when", "visual_cues"):
                for item in getattr(s.evals, name):
                    print(f"        {name.split('_')[0]:<10} {item}")
    print("  safety:", "; ".join(rb.safety_criteria))
    print("  notes:", rb.notes)


def contact_sheet(video_path: str, rb: Rubric, out: Path) -> None:
    """Save a grid with one row per step: frames at start, middle and end, labelled."""
    rows = []
    for s in rb.steps:
        tiles = []
        for label, t in (("start", s.start_s + 0.3), ("mid", (s.start_s + s.end_s) / 2), ("end", s.end_s - 0.3)):
            img = cv2.imdecode(np.frombuffer(media.frame_jpeg(video_path, t, FRAME_W), np.uint8), cv2.IMREAD_COLOR)
            img = cv2.resize(img, (FRAME_W, int(img.shape[0] * FRAME_W / img.shape[1])))
            cv2.rectangle(img, (0, 0), (FRAME_W, 22), (0, 0, 0), -1)
            cv2.putText(img, f"{s.step_id} {label} {t:.1f}s", (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            tiles.append(img)
        height = max(t.shape[0] for t in tiles)
        tiles = [cv2.copyMakeBorder(t, 0, height - t.shape[0], 0, 4, cv2.BORDER_CONSTANT) for t in tiles]
        caption = np.full((26, sum(t.shape[1] for t in tiles), 3), 255, np.uint8)
        cv2.putText(caption, f"{s.step_id}. {s.title}"[:90], (4, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1)
        rows.append(np.vstack([caption, np.hstack(tiles)]))
    width = max(r.shape[1] for r in rows)
    rows = [cv2.copyMakeBorder(r, 0, 6, 0, width - r.shape[1], cv2.BORDER_CONSTANT, value=(255, 255, 255)) for r in rows]
    cv2.imwrite(str(out), np.vstack(rows))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("videos", nargs="+", help="file names in reference_vids/ (or saved JSON with --sheet)")
    parser.add_argument("--out", type=Path, help="directory for <name>.json and <name>.jpg contact sheets")
    parser.add_argument("--sheet", type=Path, help="re-render contact sheets from saved JSON into this directory")
    parser.add_argument("--verbose", action="store_true", help="print every eval item")
    args = parser.parse_args()
    db.migrate()

    if args.sheet:
        args.sheet.mkdir(parents=True, exist_ok=True)
        for path in map(Path, args.videos):
            saved = json.loads(path.read_text())
            out = args.sheet / f"{path.stem}.jpg"
            contact_sheet(saved["video_path"], Rubric(**saved["rubric"]), out)
            print("wrote", out)
        return 0

    for filename in args.videos:
        video = reference_video(filename)
        ctx = jobs.StageContext(job_id=None, video=video)
        spent = gemini.spent_usd()
        started = time.time()
        rb = rubric.run(ctx, classification_for(filename))
        print(f"\n== {filename} ({ctx.duration:.0f}s): {len(rb.steps)} steps in {time.time() - started:.0f}s, "
              f"${gemini.spent_usd() - spent:.4f}")
        for line in ctx.logs:
            print("  log:", line)
        print_rubric(rb, args.verbose)
        if args.out:
            args.out.mkdir(parents=True, exist_ok=True)
            stem = Path(filename).stem.replace(" ", "_")
            (args.out / f"{stem}.json").write_text(json.dumps(
                {"file": filename, "video_path": video["path"], "rubric": rb.model_dump()}, indent=2))
            contact_sheet(video["path"], rb, args.out / f"{stem}.jpg")
            print("  saved", args.out / f"{stem}.json")
    print(f"\nTotal recorded spend ${gemini.spent_usd():.4f} of ${config.GEMINI_BUDGET_USD:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
