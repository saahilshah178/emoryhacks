"""A caregiver's attempt reaches Gemini without its sound; the stored file keeps it."""
import datetime as dt
import os
import subprocess
import types
from pathlib import Path

import pytest

from app import config, db, gemini, jobs, media, repo
from app.stages import _budget

FUTURE = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=30)


def _make(path: Path, sound: bool) -> Path:
    args = ["-f", "lavfi", "-i", "testsrc=size=160x120:rate=10:duration=2"]
    if sound:
        args += ["-f", "lavfi", "-i", "sine=frequency=440:duration=2"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p"] + (["-c:a", "aac"] if sound else []) + ["-y", str(path)]
    proc = media._run(args)
    assert proc.returncode == 0, proc.stderr
    return path


@pytest.fixture
def loud(tmp_path):
    return _make(tmp_path / "loud.mp4", True)


@pytest.fixture
def mute(tmp_path):
    return _make(tmp_path / "mute.mp4", False)


class FakeFiles:
    def __init__(self, fail=False):
        self.uploads = []  # (path, had audio at upload time)
        self.fail = fail

    def upload(self, file, config):
        self.uploads.append((str(file), media.has_audio(file)))
        if self.fail:
            raise RuntimeError("upload failed")
        return types.SimpleNamespace(name="files/n", uri=f"u-{len(self.uploads)}", mime_type="video/mp4",
                                     state=types.SimpleNamespace(name="ACTIVE"), expiration_time=FUTURE)


@pytest.fixture
def files(monkeypatch):
    f = FakeFiles()
    monkeypatch.setattr(gemini, "client", lambda: types.SimpleNamespace(files=f))
    return f


def _video(kind, path):
    return repo.create_video(kind, str(path), "x", {"duration_s": 2})


def _leftovers():
    return sorted(p.name for p in Path(config.TMP_DIR).glob("silent-*"))


def test_an_attempt_is_uploaded_without_sound_and_the_stored_file_keeps_it(migrated, files, loud):
    video = _video("attempt", loud)
    gemini.ensure_file(repo.get_video(video["id"]))
    assert files.uploads[0][0] != str(loud) and files.uploads[0][1] is False
    assert media.has_audio(loud)
    assert _leftovers() == []
    assert repo.get_video(video["id"])["gemini_file_audio"] is False


def test_a_reference_video_keeps_its_sound(migrated, files, loud):
    video = _video("reference", loud)
    gemini.ensure_file(repo.get_video(video["id"]))
    assert files.uploads == [(str(loud), True)]
    assert repo.get_video(video["id"])["gemini_file_audio"] is True


def test_a_video_that_never_had_sound_is_uploaded_as_it_is(migrated, files, mute):
    video = _video("attempt", mute)
    gemini.ensure_file(repo.get_video(video["id"]))
    assert files.uploads == [(str(mute), False)]
    assert repo.get_video(video["id"])["gemini_file_audio"] is False


@pytest.mark.parametrize("audio, reused", [(None, False), (True, False), (False, True)])
def test_a_cached_handle_is_reused_by_an_attempt_only_if_it_is_silent(migrated, files, loud, audio, reused):
    video = _video("attempt", loud)
    db.execute("UPDATE videos SET gemini_file_name='files/old', gemini_file_uri='u-old', gemini_file_expires=%s, "
               "gemini_file_audio=%s WHERE id=%s", (FUTURE, audio, video["id"]))
    uri = gemini.ensure_file(repo.get_video(video["id"]))[0]
    assert (uri == "u-old") is reused and len(files.uploads) == (0 if reused else 1)


@pytest.mark.parametrize("audio", [None, True, False])
def test_a_cached_handle_is_reused_for_a_reference(migrated, files, loud, audio):
    video = _video("reference", loud)
    db.execute("UPDATE videos SET gemini_file_name='files/old', gemini_file_uri='u-old', gemini_file_expires=%s, "
               "gemini_file_audio=%s WHERE id=%s", (FUTURE, audio, video["id"]))
    assert gemini.ensure_file(repo.get_video(video["id"]))[0] == "u-old" and files.uploads == []


def test_the_copy_is_deleted_when_the_upload_fails(migrated, monkeypatch, loud):
    f = FakeFiles(fail=True)
    monkeypatch.setattr(gemini, "client", lambda: types.SimpleNamespace(files=f))
    video = _video("attempt", loud)
    with pytest.raises(RuntimeError):
        gemini.ensure_file(repo.get_video(video["id"]))
    assert len(f.uploads) == 1 and _leftovers() == []


def test_when_the_silent_copy_cannot_be_made_nothing_is_uploaded(migrated, files, loud, monkeypatch):
    def broken(src, dst):
        Path(dst).write_bytes(b"half")
        raise media.MediaError("The video could not be prepared for checking. Please send it again.")

    monkeypatch.setattr(media, "strip_audio", broken)
    video = _video("attempt", loud)
    with pytest.raises(media.MediaError) as err:
        gemini.ensure_file(repo.get_video(video["id"]))
    assert files.uploads == [] and _leftovers() == []
    assert jobs.failure_text(err.value).startswith("The video could not be prepared")


def test_strip_audio_on_a_real_failure_raises(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    with pytest.raises(media.MediaError):
        media.strip_audio(bad, tmp_path / "out.mp4")
    assert not (tmp_path / "out.mp4").exists()


def test_estimates_leave_out_the_sound_of_an_attempt():
    part = gemini.video_part("u", fps=1.0)
    with_sound = gemini.estimate_input_tokens([part], 100.0)
    silent = gemini.estimate_input_tokens([part], 100.0, audio=False)
    assert with_sound - silent == 100 * config.AUDIO_TOKENS_PER_SECOND
    assert gemini.estimate_usd([part], video_seconds=100.0, audio=False) < gemini.estimate_usd([part], video_seconds=100.0)


def test_the_context_and_the_budget_helper_follow_the_video_kind():
    attempt = jobs.StageContext(job_id=None, video={"id": 1, "kind": "attempt", "duration_s": 100})
    reference = jobs.StageContext(job_id=None, video={"id": 2, "kind": "reference", "duration_s": 100})
    part = gemini.video_part("u")
    assert attempt.estimate([part]) < reference.estimate([part])
    assert _budget.clip_estimate(attempt, 0, 100, 1) < _budget.clip_estimate(reference, 0, 100, 1)
