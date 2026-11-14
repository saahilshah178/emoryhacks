"""Upload normalisation and playback for browser recordings.

Inputs are synthesised with the bundled ffmpeg to match what browsers really produce:
WebM written to a pipe (no duration, no cues), fragmented MP4 with a single keyframe,
a variable-frame-rate odd-sized clip with no audio, portrait clips, and non-videos."""
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, media

DURATION = 6.0


def _ffmpeg(*args: str, out: Path) -> Path:
    subprocess.run([media.FFMPEG, "-hide_banner", "-loglevel", "error", *args, "-y", str(out)], check=True)
    return out


def _pipe(*args: str, out: Path) -> Path:
    """Write ffmpeg output through a pipe, as MediaRecorder does, so the muxer cannot seek back."""
    with out.open("wb") as f:
        subprocess.run([media.FFMPEG, "-hide_banner", "-loglevel", "error", *args, "pipe:1"], stdout=f, check=True)
    return out


def _test_pattern(size: str, extra_filters: str = "") -> list[str]:
    return ["-f", "lavfi", "-i", f"testsrc2=size={size}:rate=30{extra_filters}", "-t", str(DURATION)]


TONE = ["-f", "lavfi", "-i", "sine=frequency=440", "-t", str(DURATION)]


@pytest.fixture(scope="module")
def inputs(tmp_path_factory) -> dict[str, Path]:
    d = tmp_path_factory.mktemp("inputs")
    landscape = _ffmpeg(*_test_pattern("640x360"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30",
                        out=d / "landscape.mp4")
    files = {
        "webm_live": _pipe(*_test_pattern("640x360"), *TONE, "-c:v", "libvpx", "-deadline", "realtime",
                           "-c:a", "libopus", "-live", "1", "-f", "webm", out=d / "live.webm"),
        "fragmented_mp4": _pipe(*_test_pattern("640x360"), *TONE, "-c:v", "libx264", "-g", "1000", "-c:a", "aac",
                                "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4",
                                out=d / "frag.mp4"),
        # Drop 2 of every 5 frames and keep the gaps, as a struggling webcam does.
        "vfr_odd_no_audio": _pipe(*_test_pattern("641x479", ",format=yuv444p,select='lt(mod(n\\,5)\\,3)'"),
                                  "-fps_mode", "vfr", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-an",
                                  "-live", "1", "-f", "webm", out=d / "vfr.webm"),
        "portrait": _ffmpeg(*_test_pattern("360x640"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "30",
                            out=d / "portrait.mp4"),
        # A phone clip stored landscape with a 90 degree display rotation.
        "rotated_phone": _ffmpeg("-display_rotation:v:0", "90", "-i", str(landscape), "-c", "copy",
                                 out=d / "rotated.mp4"),
        "landscape": landscape,
    }
    (d / "notes.mp4").write_text("this is not a video\n")
    files["not_video"] = d / "notes.mp4"
    files["audio_only"] = _ffmpeg(*TONE, "-c:a", "aac", out=d / "tone.m4a")
    return files


def _has_audio(path: Path) -> bool:
    return "Audio: aac" in media._ffmpeg_header(path)


def _assert_playable(info: dict, out: Path) -> None:
    assert abs(info["duration_s"] - DURATION) <= 0.5, info
    assert info["vcodec"] == "h264"
    boxes = media.mp4_boxes(out)
    assert "moof" not in boxes, boxes
    assert boxes.index("moov") < boxes.index("mdat"), f"index not at the front: {boxes}"
    keys, end = media.keyframe_times(out)
    gaps = [b - a for a, b in zip([0.0, *keys], [*keys, end])]
    assert max(gaps) <= media.KEYFRAME_S + 0.1, gaps


@pytest.mark.parametrize("name,size,audio", [
    ("webm_live", (640, 360), True),
    ("fragmented_mp4", (640, 360), True),
    ("vfr_odd_no_audio", (640, 478), False),
    ("portrait", (360, 640), False),
    ("rotated_phone", (360, 640), False),
])
def test_normalize_browser_like_inputs(inputs, tmp_path, name, size, audio):
    src = inputs[name]
    if name in ("webm_live", "vfr_odd_no_audio"):
        assert media.probe(src)["duration_s"] == 0, "test input should have no duration, like a browser WebM"
    out = tmp_path / "out.mp4"
    info = media.normalize(src, out)
    _assert_playable(info, out)
    assert (info["width"], info["height"]) == size
    assert _has_audio(out) is audio
    assert info["fps"] == 30


def test_variable_frame_rate_becomes_constant(inputs, tmp_path):
    out = tmp_path / "out.mp4"
    media.normalize(inputs["vfr_odd_no_audio"], out)
    proc = subprocess.run([media.FFMPEG, "-i", str(out), "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-"],
                          capture_output=True, text=True)
    durations = {line.split(",")[3].strip() for line in proc.stdout.splitlines() if line and line[0] != "#"}
    assert len(durations) == 1, durations


def test_only_well_formed_h264_is_copied(inputs, sample_video):
    assert media.transcode_reason(inputs["landscape"]) is None
    assert media.transcode_reason(sample_video) is None
    assert media.transcode_reason(inputs["webm_live"]) == "video codec is vp8"
    assert media.transcode_reason(inputs["fragmented_mp4"]) == "fragmented MP4"
    assert media.transcode_reason(inputs["rotated_phone"]) == "has rotation metadata"


@pytest.mark.parametrize("name", ["not_video", "audio_only"])
def test_non_videos_are_rejected(inputs, tmp_path, name):
    with pytest.raises(media.MediaError):
        media.normalize(inputs[name], tmp_path / "out.mp4")
    assert not (tmp_path / "out.mp4").exists()


def test_upload_recording_and_seek_by_range(migrated, inputs):
    from app.main import app

    with TestClient(app) as client:
        with inputs["webm_live"].open("rb") as f:
            res = client.post("/api/videos", data={"kind": "reference"},
                              files={"file": ("recording.webm", f, "video/webm")})
        assert res.status_code == 200, res.text
        body = res.json()
        video = client.get(f"/api/videos/{body['video_id']}").json()
        assert abs(video["duration_s"] - DURATION) <= 0.5 and video["original_name"] == "recording.webm"

        url = f"/api/videos/{body['video_id']}/file"
        size = int(client.get(url).headers["content-length"])
        ranged = client.get(url, headers={"Range": "bytes=100-199"})
        assert ranged.status_code == 206
        assert ranged.headers["content-range"] == f"bytes 100-199/{size}"
        assert len(ranged.content) == 100
        tail = client.get(url, headers={"Range": f"bytes={size - 50}-"})
        assert tail.status_code == 206 and tail.headers["content-range"] == f"bytes {size - 50}-{size - 1}/{size}"
        assert client.get(url, headers={"Range": f"bytes={size + 10}-"}).status_code == 416
        _wait(client, body["job_id"])


@pytest.mark.parametrize("data,file,status,message", [
    ({"kind": "reference"}, b"", 400, "empty"),
    ({"kind": "reference"}, b"this is not a video", 422, "Could not read that video"),
    ({"kind": "selfie"}, b"x", 400, "kind must be"),
    ({"kind": "attempt", "skill_id": "not-a-uuid"}, b"x", 400, "existing skill"),
    ({"kind": "attempt", "skill_id": "00000000-0000-0000-0000-000000000000"}, b"x", 400, "existing skill"),
])
def test_upload_errors_are_clear(migrated, data, file, status, message):
    from app.main import app

    with TestClient(app) as client:
        res = client.post("/api/videos", data=data, files={"file": ("clip.mp4", file, "video/mp4")})
    assert res.status_code == status, res.text
    assert message in res.json()["detail"]


def test_upload_too_large(migrated, monkeypatch):
    from app.main import app

    monkeypatch.setattr(config, "MAX_UPLOAD_MB", 1)
    with TestClient(app) as client:
        res = client.post("/api/videos", data={"kind": "reference"},
                          files={"file": ("big.mp4", b"\0" * (2 << 20), "video/mp4")})
    assert res.status_code == 413 and "1 MB limit" in res.json()["detail"]
    assert not any(config.TMP_DIR.iterdir()), "temp upload should be removed"


def _wait(client, job_id, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error"):
            return job
        time.sleep(0.5)
    raise AssertionError("job did not finish")
