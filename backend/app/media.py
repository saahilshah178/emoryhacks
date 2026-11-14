"""Video handling with the ffmpeg binary bundled by imageio-ffmpeg (no system install).

Every upload is normalised to a seekable H.264 MP4 so that the browser can seek,
OpenCV can read it, and Gemini accepts it. Browser recordings (fragmented MP4 or
WebM) have no usable duration until this is done.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

from . import config

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


class MediaError(RuntimeError):
    pass


def _run(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run([FFMPEG, "-hide_banner", "-nostdin", *args], capture_output=True, text=True, timeout=timeout)


def probe(path: str | Path) -> dict:
    """Return duration_s, width, height, fps, vcodec for a media file."""
    proc = _run(["-i", str(path)], timeout=60)
    err = proc.stderr
    info = {"duration_s": 0.0, "width": 0, "height": 0, "fps": 0.0, "vcodec": ""}
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", err)
    if m:
        info["duration_s"] = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    v = re.search(r"Stream #.*Video:\s*([a-zA-Z0-9_]+).*", err)
    if v:
        info["vcodec"] = v.group(1)
        line = v.group(0)
        size = re.search(r",\s*(\d{2,5})x(\d{2,5})", line)
        if size:
            info["width"], info["height"] = int(size.group(1)), int(size.group(2))
        fps = re.search(r"([\d.]+)\s*fps", line) or re.search(r"([\d.]+)\s*tbr", line)
        if fps:
            info["fps"] = float(fps.group(1))
    if not v:
        raise MediaError(f"No video stream found in {path}")
    return info


def normalize(src: str | Path, dst: str | Path) -> dict:
    """Write a seekable H.264/AAC MP4 at dst and return its probe info.

    H.264 input is remuxed without re-encoding; anything else is transcoded."""
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        info = probe(src)
    except MediaError:
        raise
    attempts = []
    if info["vcodec"] == "h264":
        attempts.append(["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac",
                         "-movflags", "+faststart", "-y", str(dst)])
    attempts.append(["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast",
                     "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                     "-c:a", "aac", "-movflags", "+faststart", "-y", str(dst)])
    last = ""
    for args in attempts:
        proc = _run(args)
        if proc.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
            out = probe(dst)
            if out["duration_s"] > 0:
                return out
        last = proc.stderr[-600:]
    raise MediaError(f"Could not convert {src.name} to MP4: {last}")


def thumbnail(path: str | Path, t: float, out: str | Path, width: int = 480) -> Path:
    """Save one JPEG frame taken at t seconds."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    proc = _run(["-ss", f"{max(0.0, t):.2f}", "-i", str(path), "-frames:v", "1",
                 "-vf", f"scale={width}:-2", "-q:v", "4", "-y", str(out)], timeout=60)
    if proc.returncode != 0 or not out.exists():
        raise MediaError(f"Could not grab a frame at {t:.1f}s: {proc.stderr[-300:]}")
    return out


def frame_jpeg(path: str | Path, t: float, width: int = 960) -> bytes:
    """Return one JPEG frame at t seconds as bytes (for sending a still to Gemini)."""
    proc = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostdin", "-ss", f"{max(0.0, t):.2f}", "-i", str(path), "-frames:v", "1",
         "-vf", f"scale={width}:-2", "-q:v", "3", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
        capture_output=True, timeout=60,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise MediaError(f"Could not grab a frame at {t:.1f}s")
    return proc.stdout


def cut(src: str | Path, dst: str | Path, segments: list[tuple[float, float]]) -> dict:
    """Write dst as the given (start_s, end_s) segments of src joined in the given order.

    Used to synthesise test attempts with a step removed or two steps swapped."""
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    filters, labels = [], []
    for i, (a, b) in enumerate(segments):
        filters.append(f"[0:v]trim=start={a:.2f}:end={b:.2f},setpts=PTS-STARTPTS[v{i}]")
        labels.append(f"[v{i}]")
    filters.append(f"{''.join(labels)}concat=n={len(segments)}:v=1:a=0[out]")
    proc = _run(["-i", str(src), "-filter_complex", ";".join(filters), "-map", "[out]", "-c:v", "libx264",
                 "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", str(dst)])
    if proc.returncode != 0:
        raise MediaError(f"Could not cut {src.name}: {proc.stderr[-400:]}")
    return probe(dst)


def video_path(video_id) -> Path:
    return config.VIDEO_DIR / f"{video_id}.mp4"
