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
