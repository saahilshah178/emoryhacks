"""Video handling with the ffmpeg binary bundled by imageio-ffmpeg (no system install).

Every upload is normalised to a seekable H.264 MP4 so that the browser can seek,
OpenCV can read it, and Gemini accepts it. Browser recordings need this most:
Chrome and Safari write fragmented MP4 whose header says the duration is zero, and
WebM recordings carry no duration or seek index at all, often with a variable frame
rate and a single keyframe at the very start.
"""
from __future__ import annotations

import re
import struct
import subprocess
from pathlib import Path

import imageio_ffmpeg

from . import config

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# Transcoded output: frame rate cap, longest side cap, and one keyframe every
# KEYFRAME_S seconds so that a <video> element (and OpenCV) can seek quickly.
MAX_FPS = 30
MAX_SIDE = 1280
KEYFRAME_S = 2
# An H.264 file is only copied as-is when its keyframes are at most this far apart
# (the reference videos reach about 9 s; browser recordings often have one keyframe).
MAX_COPY_KEYFRAME_GAP_S = 10.0


class MediaError(RuntimeError):
    pass


def _run(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run([FFMPEG, "-hide_banner", "-nostdin", *args], capture_output=True, text=True, timeout=timeout)


def _ffmpeg_header(path: str | Path) -> str:
    """ffmpeg's description of the input's container and streams (its stderr for `-i path`)."""
    return _run(["-i", str(path)], timeout=60).stderr


def probe(path: str | Path) -> dict:
    """Return duration_s, width, height, fps, vcodec for a media file."""
    err = _ffmpeg_header(path)
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
        raise MediaError(f"No video stream found in {Path(path).name}")
    return info


def has_audio(path: str | Path) -> bool:
    """True when the file has an audio stream."""
    return bool(re.search(r"Stream #.*Audio:", _ffmpeg_header(path)))


def strip_audio(src: str | Path, dst: str | Path) -> None:
    """Write a copy of src at dst with no audio track. The video is copied as it is (no
    re-encode), so this takes a moment. Raises MediaError, and leaves no file at dst, if the
    copy cannot be made or still has sound."""
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        proc = _run(["-i", str(src), "-map", "0:v:0", "-c", "copy", "-an", "-movflags", "+faststart",
                     "-y", str(dst)], timeout=300)
        ok = proc.returncode == 0 and dst.exists() and dst.stat().st_size > 0 and not has_audio(dst)
    except (OSError, subprocess.SubprocessError) as exc:
        dst.unlink(missing_ok=True)
        raise MediaError("The video could not be prepared for checking. Please send it again.") from exc
    if not ok:
        detail = proc.stderr[-300:]
        dst.unlink(missing_ok=True)
        raise MediaError(f"The video could not be prepared for checking. Please send it again.\n{detail}")


def mp4_boxes(path: str | Path) -> list[str]:
    """Names of the top-level boxes of an MP4/MOV file in file order ([] for other formats).

    'moof' means the file is fragmented; 'moov' before 'mdat' means faststart."""
    names: list[str] = []
    with open(path, "rb") as f:
        size_total = f.seek(0, 2)
        pos = 0
        while pos + 8 <= size_total:
            f.seek(pos)
            size, name = struct.unpack(">I4s", f.read(8))
            if size == 1:
                size = struct.unpack(">Q", f.read(8))[0]
            elif size == 0:
                size = size_total - pos
            if size < 8 or not name.isascii() or not name.decode("ascii").isprintable():
                break
            names.append(name.decode("ascii"))
            pos += size
    return names if names[:1] == ["ftyp"] else []


def keyframe_times(path: str | Path) -> tuple[list[float], float]:
    """Presentation times of the video keyframes, and the time just after the last frame.

    Reads packets without decoding (ffmpeg's framecrc muxer marks non-key packets with F=)."""
    proc = _run(["-loglevel", "error", "-i", str(path), "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"], timeout=300)
    timebase = 1.0
    keys: list[float] = []
    end = 0.0
    for line in proc.stdout.splitlines():
        if line.startswith("#tb 0:"):
            num, den = line.split(":", 1)[1].strip().split("/")
            timebase = int(num) / int(den)
        elif line and not line.startswith("#"):
            fields = [x.strip() for x in line.split(",")]
            pts, duration = int(fields[2]) * timebase, int(fields[3]) * timebase
            end = max(end, pts + duration)
            if not any(x.startswith("F=") for x in fields[6:]):
                keys.append(pts)
    return sorted(keys), end


def transcode_reason(path: str | Path, info: dict | None = None) -> str | None:
    """Why this file cannot simply be remuxed into the output MP4, or None if it can.

    Remuxing is only safe for a well-formed, upright H.264 file with regular keyframes;
    everything else (browser recordings in particular) is re-encoded."""
    info = info or probe(path)
    header = _ffmpeg_header(path)
    if info["vcodec"] != "h264":
        return f"video codec is {info['vcodec']}"
    if info["duration_s"] <= 0:
        return "container reports no duration"
    if "moof" in mp4_boxes(path):
        return "fragmented MP4"
    if not re.search(r"Video:.*\byuv420p\b", header):
        return "pixel format is not yuv420p"
    if re.search(r"rotation of -?[1-9]", header):
        return "has rotation metadata"
    if info["width"] % 2 or info["height"] % 2:
        return "odd frame size"
    keys, end = keyframe_times(path)
    if not keys:
        return "no keyframes found"
    gap = max(b - a for a, b in zip([0.0, *keys], [*keys, end]))
    if gap > MAX_COPY_KEYFRAME_GAP_S:
        return f"keyframes are up to {gap:.1f}s apart"
    return None


def _output_fps(info: dict) -> int:
    fps = info.get("fps") or 0
    return int(round(fps)) if 5 <= fps <= MAX_FPS else MAX_FPS


def _transcode_args(src: Path, dst: Path, info: dict) -> list[str]:
    """Re-encode to constant-frame-rate H.264 with regular keyframes, upright and even-sized."""
    fps = _output_fps(info)
    vf = (f"fps={fps},scale='min(iw,{MAX_SIDE})':'min(ih,{MAX_SIDE})':force_original_aspect_ratio=decrease"
          f":force_divisible_by=2,setsar=1,format=yuv420p")
    return ["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", str(fps * KEYFRAME_S),
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-y", str(dst)]


def _remux_args(src: Path, dst: Path) -> list[str]:
    return ["-i", str(src), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "copy", "-c:a", "aac",
            "-movflags", "+faststart", "-y", str(dst)]


def normalize(src: str | Path, dst: str | Path) -> dict:
    """Write a seekable H.264/AAC MP4 at dst and return its probe info.

    A well-formed H.264 file is remuxed without re-encoding (fast, lossless); anything
    else is transcoded. The result always has its index at the front (faststart) and a
    real duration. Raises MediaError if the input has no readable video."""
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    info = probe(src)
    attempts = []
    if transcode_reason(src, info) is None:
        attempts.append(_remux_args(src, dst))
    attempts.append(_transcode_args(src, dst, info))
    last = ""
    for args in attempts:
        proc = _run(args)
        if proc.returncode == 0 and dst.exists() and dst.stat().st_size > 0:
            out = probe(dst)
            if out["duration_s"] > 0 and out["width"] > 0:
                return out
        last = proc.stderr[-600:]
    dst.unlink(missing_ok=True)
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

    Used to synthesise test attempts with a step removed or two steps swapped. The audio
    track is cut the same way when the source has one, because the grader listens to speech."""
    src, dst = Path(src), Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    has_audio = bool(re.search(r"Stream #.*Audio:", _ffmpeg_header(src)))
    filters, labels = [], []
    for i, (a, b) in enumerate(segments):
        filters.append(f"[0:v]trim=start={a:.2f}:end={b:.2f},setpts=PTS-STARTPTS[v{i}]")
        labels.append(f"[v{i}]")
        if has_audio:
            filters.append(f"[0:a]atrim=start={a:.2f}:end={b:.2f},asetpts=PTS-STARTPTS[a{i}]")
            labels.append(f"[a{i}]")
    outputs = "[out][aout]" if has_audio else "[out]"
    filters.append(f"{''.join(labels)}concat=n={len(segments)}:v=1:a={1 if has_audio else 0}{outputs}")
    maps = ["-map", "[out]"] + (["-map", "[aout]", "-c:a", "aac"] if has_audio else [])
    proc = _run(["-i", str(src), "-filter_complex", ";".join(filters), *maps, "-c:v", "libx264",
                 "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", str(dst)])
    if proc.returncode != 0:
        raise MediaError(f"Could not cut {src.name}: {proc.stderr[-400:]}")
    return probe(dst)


def video_path(video_id) -> Path:
    return config.VIDEO_DIR / f"{video_id}.mp4"
