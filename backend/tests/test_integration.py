"""Checks for the glue between branches: the Gemini output cap, audio in cut clips,
and renaming pose flags once tracks have roles."""
import re
import types
import uuid

import pytest

from app import gemini, media, repo
from app.models import SafetyFlag
from app.stages import pose


class _FakeInteractions:
    """Stands in for client().interactions: replies come from a list, calls are recorded."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    def create(self, **body):
        self.calls.append(body)
        status, text = self.replies.pop(0)
        usage = types.SimpleNamespace(total_input_tokens=10, total_output_tokens=5, total_thought_tokens=5)
        return types.SimpleNamespace(status=status, output_text=text, usage=usage)


def _use(monkeypatch, replies) -> _FakeInteractions:
    fake = _FakeInteractions(replies)
    monkeypatch.setattr(gemini, "client", lambda: types.SimpleNamespace(interactions=fake))
    return fake


def test_output_cap_is_sent_and_a_cut_off_reply_is_retried_with_less_thinking(migrated, monkeypatch):
    fake = _use(monkeypatch, [("incomplete", ""), ("completed", "done")])
    text = gemini.generate_text("test_cap", [gemini.text_part("hi")], thinking="medium", max_output_tokens=321)
    assert text == "done"
    assert [c["generation_config"] for c in fake.calls] == [
        {"thinking_level": "medium", "max_output_tokens": 321},
        {"thinking_level": "low", "max_output_tokens": 321},
    ]


def test_two_cut_off_replies_fail_instead_of_looping(migrated, monkeypatch):
    fake = _use(monkeypatch, [("incomplete", "{"), ("incomplete", "{"), ("completed", "never reached")])
    with pytest.raises(gemini.GeminiError, match="cut off"):
        gemini.generate_text("test_cap", [gemini.text_part("hi")])
    assert len(fake.calls) == 2


def test_cut_keeps_the_audio_track(sample_video, tmp_path):
    if not re.search(r"Stream #.*Audio:", media._ffmpeg_header(sample_video)):
        pytest.skip("sample video has no audio track")
    info = media.cut(sample_video, tmp_path / "cut.mp4", [(10, 14), (2, 5)])
    assert 6.5 < info["duration_s"] < 7.6
    assert re.search(r"Stream #.*Audio:", media._ffmpeg_header(tmp_path / "cut.mp4"))


def test_pose_flags_are_renamed_once_tracks_have_roles(migrated):
    video = repo.create_video("attempt", "/tmp/none.mp4", "x", {"duration_s": 30})
    repo.replace_pose(video["id"], video["recorded_at"], [], [
        {"person_idx": 0, "role": "caregiver", "n_frames": 50},
        {"person_idx": 1, "role": "patient", "n_frames": 50},
        {"person_idx": 2, "n_frames": 50},
    ])

    def flag(kind, track):
        return SafetyFlag(kind=kind, severity="medium", start_s=1, end_s=3, person_label=f"track {track}",
                          description=f"Pose readings: track {track}'s reading was out of range.", source="pose",
                          counts_toward_score=False)

    out = pose.relabel_flags(video["id"], [
        flag("patient_unsteady", 0),    # caregiver bending -> caregiver posture
        flag("patient_off_center", 0),  # caregiver shifting weight -> dropped
        flag("patient_off_center", 1),  # patient -> kept and named
        flag("patient_unsteady", 2),    # unknown role -> unchanged
    ])
    assert [(f.kind, f.person_label) for f in out] == [
        ("unsafe_caregiver_posture", "caregiver (track 0)"),
        ("patient_off_center", "patient (track 1)"),
        ("patient_unsteady", "track 2"),
    ]
    assert "the patient (track 1)'s reading" in out[1].description
    assert all(f.source == "pose" and not f.counts_toward_score for f in out)


def test_restart_only_fails_jobs_whose_process_is_gone(migrated):
    import socket

    from app import db

    video = repo.create_video("reference", "/tmp/none.mp4", "x", {"duration_s": 5})
    host = socket.gethostname()
    mine = repo.create_job("reference", video["id"])              # this process: a restart means it died
    other_live = repo.create_job("reference", video["id"])
    other_dead = repo.create_job("reference", video["id"])
    db.execute("UPDATE jobs SET runner=%s WHERE id=%s", (f"{host}:1", other_live))          # pid 1 always exists
    db.execute("UPDATE jobs SET runner=%s WHERE id=%s", (f"{host}:999999999", other_dead))  # no such process
    repo.fail_interrupted_jobs()
    status = {j: repo.get_job(j)["status"] for j in (mine, other_live, other_dead)}
    assert status == {mine: "error", other_live: "queued", other_dead: "error"}
    db.execute("UPDATE jobs SET status='done' WHERE id=%s", (other_live,))


def test_rebuild_keeps_graded_attempts_on_the_version_they_were_graded_against(migrated, sample_video):
    import time

    from fastapi.testclient import TestClient

    from app import jobs
    from app.main import app

    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug="rebuild_demo", name="Rebuild demo")
    skill_id = str(repo.get_job(job_id)["skill_id"])
    video = jobs.ingest(str(sample_video), "attempt", "attempt.mp4")
    attempt_id = repo.create_attempt(skill_id, video["id"], "Sam")
    jobs.run_attempt(repo.create_job("attempt", video["id"], skill_id=skill_id, attempt_id=attempt_id))
    before = [(s["step_id"], s["title"], s["status"]) for s in repo.get_attempt(attempt_id)["steps"]]

    with TestClient(app) as client:
        client.patch(f"/api/skills/{skill_id}/steps/s1", json={"title": "Edited before the rebuild"})
        job = client.post(f"/api/skills/{skill_id}/regenerate").json()
        for _ in range(240):
            state = client.get(f"/api/jobs/{job['job_id']}").json()
            if state["status"] in ("done", "error"):
                break
            time.sleep(0.25)
        assert state["status"] == "done", state["error"]
        listed = [s for s in client.get("/api/skills").json() if s["slug"] == "rebuild_demo"]
        assert [s["id"] for s in listed] == [state["skill_id"]]  # only the newest version is listed
        assert len([s for s in client.get("/api/skills?all=1").json() if s["slug"] == "rebuild_demo"]) == 2

    after = repo.get_attempt(attempt_id)
    assert str(after["skill_id"]) == skill_id
    assert [(s["step_id"], s["status"]) for s in after["steps"]] == [(i, st) for i, _, st in before]
    assert after["steps"][0]["title"] == "Edited before the rebuild"  # still the old version's steps


def test_a_step_can_only_be_made_to_follow_earlier_steps(migrated, sample_video):
    from fastapi.testclient import TestClient

    from app import jobs
    from app.main import app

    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug="prereq_demo", name="Prereq demo")
    skill_id = str(repo.get_job(job_id)["skill_id"])
    with TestClient(app) as client:
        ok = client.patch(f"/api/skills/{skill_id}/steps/s3", json={"must_follow": ["s1", "s2"]}).json()
        assert ok["steps"][2]["must_follow"] == ["s1", "s2"] and ok["steps"][2]["order_dependent"] is True
        assert client.patch(f"/api/skills/{skill_id}/steps/s2", json={"must_follow": ["s3"]}).status_code == 422
        cleared = client.patch(f"/api/skills/{skill_id}/steps/s3", json={"must_follow": []}).json()
        assert cleared["steps"][2]["must_follow"] == [] and cleared["steps"][2]["order_dependent"] is False


def test_a_reference_video_missing_on_this_machine_is_rebuilt_from_the_repository(migrated, sample_video):
    from pathlib import Path

    from app import db, jobs

    video = jobs.ingest(str(sample_video), "reference", sample_video.name)
    Path(video["path"]).unlink()
    db.execute("UPDATE videos SET path='/somewhere/else/on/another/laptop.mp4' WHERE id=%s", (video["id"],))
    fixed = repo.ensure_video_file(repo.get_video(video["id"]))
    assert Path(fixed["path"]).exists() and repo.get_video(video["id"])["path"] == fixed["path"]

    other = jobs.ingest(str(sample_video), "attempt", "recorded-elsewhere.webm")
    Path(other["path"]).unlink()
    with pytest.raises(media.MediaError, match="another machine"):
        repo.ensure_video_file(repo.get_video(other["id"]))


def test_a_still_image_is_rejected_as_too_short(migrated, sample_video, tmp_path):
    from app import jobs

    still = media.thumbnail(sample_video, 5, tmp_path / "photo.jpg")
    with pytest.raises(media.MediaError, match="seconds"):
        jobs.ingest(str(still), "attempt", "photo.jpg")
