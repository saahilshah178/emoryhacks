"""Timeline stage: cleaning model output, performed order, missing steps and order violations.
No Gemini calls: the model is replaced by a stub ctx."""
import pytest

from app import config
from app.models import Rubric, RubricStep, StepEval, TimelineStep
from app.stages import timeline
from app.stages.timeline import _Located, _LocateReply, _Observed, _RefineReply
from tests.fixtures_timeline import CASES, FALL_RESPONSE, SIT_TO_STAND, expected_times


def _found(step_id, start, end=None):
    return TimelineStep(step_id=step_id, found=True, start_s=start, end_s=end if end is not None else start + 2)


def _missing(step_id):
    return TimelineStep(step_id=step_id, found=False)


def _rubric(*must_follow, order_matters=True, dependent=True):
    """Steps s1..sN where step i must follow the ids in must_follow[i]."""
    ev = StepEval(pass_criteria=["x"], fail_criteria=["y"], unverified_when=["z"])
    steps = [RubricStep(step_id=f"s{i + 1}", order=i + 1, title=f"Step {i + 1}", description="", start_s=100 + i,
                        end_s=101 + i, critical=False, order_dependent=dependent and bool(m), must_follow=list(m),
                        evals=ev)
             for i, m in enumerate(must_follow)]
    return Rubric(steps=steps, order_matters=order_matters)


@pytest.mark.parametrize("case", [c for c in CASES if c.truth], ids=lambda c: c.name)
def test_fixture_cases_with_perfect_locations(case):
    """If the model placed every step exactly at its true time, the stage would report exactly the
    expected violations and missing steps. This checks the fixtures and the order logic together."""
    truth = expected_times(case.segments, case.truth)
    steps = [_found(i, t[0], t[1]) if t else _missing(i) for i, t in truth.items()]
    tl = timeline.build_timeline(case.rubric, steps)
    assert {(v.step_id, v.expected_after) for v in tl.order_violations} == set(case.expect_violations)
    assert tl.missing_step_ids == list(case.expect_missing)


def test_swap_violation_message_and_time():
    truth = expected_times([(5.0, 13.0), (19.5, 26.0), (13.0, 19.5), (26.0, 50.0)],
                           {s.step_id: (s.start_s, s.end_s) for s in SIT_TO_STAND.steps})
    tl = timeline.build_timeline(SIT_TO_STAND, [_found(i, a, b) for i, (a, b) in truth.items()])
    [v] = tl.order_violations
    assert v.at_s == truth["s4"][0] == 8.0
    assert v.message == '"Feet back and apart" was performed before "Shuffle to the front of the chair".'
    by_id = {s.step_id: s for s in tl.steps}
    assert (by_id["s3"].performed_index, by_id["s4"].performed_index) == (4, 3)


def test_order_tolerance_is_one_second():
    rb = _rubric([], ["s1"])
    assert timeline.build_timeline(rb, [_found("s1", 10.0), _found("s2", 9.5)]).order_violations == []
    assert timeline.build_timeline(rb, [_found("s1", 10.0), _found("s2", 9.0)]).order_violations == []
    [v] = timeline.build_timeline(rb, [_found("s1", 10.0), _found("s2", 8.9)]).order_violations
    assert (v.step_id, v.expected_after, v.at_s) == ("s2", "s1", 8.9)


def test_no_violation_for_missing_prerequisite_or_when_order_does_not_matter():
    rb = _rubric([], ["s1"], ["s2"])
    tl = timeline.build_timeline(rb, [_missing("s1"), _found("s2", 1.0), _found("s3", 5.0)])
    assert tl.order_violations == [] and tl.missing_step_ids == ["s1"]
    early = [_found("s1", 10.0), _found("s2", 1.0), _found("s3", 5.0)]
    assert timeline.build_timeline(_rubric([], ["s1"], ["s2"], order_matters=False), early).order_violations == []
    assert timeline.build_timeline(_rubric([], ["s1"], ["s2"], dependent=False), early).order_violations == []


def test_order_is_checked_across_a_skipped_step():
    """brakes -> gait belt -> stand: the belt is skipped and the patient stands before the brakes."""
    rb = _rubric([], ["s1"], ["s2"], ["s3"])
    tl = timeline.build_timeline(rb, [_found("s1", 20.0), _missing("s2"), _found("s3", 5.0), _found("s4", 25.0)])
    assert [(v.step_id, v.expected_after) for v in tl.order_violations] == [("s3", "s1")]
    assert tl.order_violations[0].message == '"Step 3" was performed before "Step 1".'


def test_notes_name_steps_by_title_not_id():
    rb = _rubric([], [], [])
    located = [_Located(step_id="s3", performed=True, start_s=1, end_s=2, confidence=0.9,
                        note="Performed before s2; repeated after S1. Not s9.")]
    [_, _, s3] = timeline.clean_steps(rb, located, duration=40.0)
    assert s3.note == 'Performed before "Step 2"; repeated after "Step 1". Not s9.'
    assert "never by their id" in timeline.timeline_prompts.locate(rb, 40.0)


def test_refined_times_never_move_a_step_past_a_located_neighbour():
    first = [_found("s1", 100.0, 102.0), _found("s2", 102.0, 105.0), _missing("s3"), _found("s4", 110.0, 115.0)]
    refined = [_found("s1", 99.0, 101.5), _found("s2", 98.5, 104.0), _missing("s3"), _found("s4", 109.0, 114.0)]
    kept = timeline.keep_performed_order(first, refined)
    assert [(s.start_s, s.end_s) for s in kept if s.found] == [(99.0, 101.5), (102.0, 105.0), (109.0, 114.0)]
    assert not kept[2].found
    # A step refined later than its next neighbour's start also keeps its first-pass times.
    late = [_found("s1", 104.0, 106.0), *refined[1:]]
    assert timeline.keep_performed_order(first, late)[0].start_s == 100.0


def test_every_unmet_prerequisite_is_reported_in_time_order():
    rb = _rubric([], [], ["s1", "s2"])
    tl = timeline.build_timeline(rb, [_found("s1", 10.0), _found("s2", 20.0), _found("s3", 0.0)])
    assert [(v.step_id, v.expected_after) for v in tl.order_violations] == [("s3", "s1"), ("s3", "s2")]
    assert [s.performed_index for s in tl.steps] == [2, 3, 1]


def test_clean_steps_handles_messy_model_output():
    rb = _rubric([], [], [], [], [], [])
    located = [
        _Located(step_id="s1", performed=True, start_s=-3, end_s=4, confidence=1.7, note=" ok "),
        _Located(step_id="s1", performed=True, start_s=20, end_s=25, confidence=0.5),  # duplicate: ignored
        _Located(step_id="s2", performed=True, start_s=12, end_s=10, confidence=0.8),   # end before start
        _Located(step_id="s3", performed=True, start_s=None, end_s=None, confidence=0.4),  # no time: not found
        _Located(step_id="s4", performed=False, start_s=5, end_s=6, confidence=0.9, note="skipped"),
        _Located(step_id="s5", performed=True, start_s=38, end_s=90, confidence=-1),  # past the end
        _Located(step_id="s9", performed=True, start_s=1, end_s=2, confidence=0.9),   # not in the rubric
    ]
    steps = {s.step_id: s for s in timeline.clean_steps(rb, located, duration=40.0)}
    assert list(steps) == ["s1", "s2", "s3", "s4", "s5", "s6"]
    assert (steps["s1"].start_s, steps["s1"].end_s, steps["s1"].confidence, steps["s1"].note) == (0.0, 4.0, 1.0, "ok")
    assert (steps["s2"].start_s, steps["s2"].end_s) == (12.0, 13.0)
    assert not steps["s3"].found and steps["s3"].start_s is None
    assert not steps["s4"].found and steps["s4"].note == "skipped" and steps["s4"].start_s is None
    assert (steps["s5"].start_s, steps["s5"].end_s, steps["s5"].confidence) == (38.0, 40.0, 0.0)
    assert not steps["s6"].found


def test_clamp_span_keeps_end_after_start():
    assert timeline.clamp_span(39.8, 39.8, 40.0) == (39.0, 40.0)
    assert timeline.clamp_span(50, 60, 40.0) == (39.0, 40.0)
    assert timeline.clamp_span(3.04, None, 40.0) == (3.0, 4.0)


def test_sample_fps_drops_for_long_videos():
    assert [timeline.sample_fps(d) for d in (45, 120, 200, 460)] == [2.0, 2.0, 1.0, 0.5]


def test_expected_times_maps_steps_through_a_cut():
    truth = {"a": (0.0, 5.0), "b": (5.0, 10.0), "c": (10.0, 12.0)}
    assert expected_times([(5.0, 10.0), (0.0, 5.0)], truth) == {"a": (5.0, 10.0), "b": (0.0, 5.0), "c": None}


class _StubCtx:
    """Stands in for StageContext: records prompts and returns canned replies."""

    def __init__(self, duration, locate_reply, refine_reply=None):
        self.duration = duration
        self.locate_reply = locate_reply
        self.refine_reply = refine_reply
        self.calls = []
        self.logs = []

    def video_part(self, **kwargs):
        return {"type": "video", **kwargs}

    def generate_json(self, purpose, parts, schema, **kwargs):
        self.calls.append((purpose, parts))
        return self.locate_reply if purpose == "timeline" else self.refine_reply

    def log(self, message):
        self.logs.append(message)


def _reply(*items):
    return _LocateReply(observed=[_Observed(start_s=0, end_s=1, action="walks in")],
                        steps=[_Located(step_id=i, performed=s is not None, start_s=s, end_s=e, confidence=0.9)
                               for i, s, e in items])


def test_run_sends_video_first_without_reference_times(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)
    ctx = _StubCtx(60.0, _reply(("s1", 2, 8), ("s2", 30, 40), ("s3", 10, 20), ("s4", None, None),
                                ("s5", 41, 50), ("s6", 52, 58)))
    tl = timeline.run(ctx, FALL_RESPONSE)
    [(purpose, parts)] = ctx.calls  # 60 s is densely sampled, so no refine calls
    assert purpose == "timeline" and parts[0]["type"] == "video" and parts[0]["fps"] == 2.0
    prompt = parts[1]["text"]
    assert "60.0 seconds" in prompt and "Recognise the fall and pull close" in prompt
    for step in FALL_RESPONSE.steps:  # reference timestamps must not leak into the request
        assert f"{step.start_s:.1f}" not in prompt.replace("60.0", "")
    assert [(v.step_id, v.expected_after) for v in tl.order_violations] == [("s3", "s2")]
    assert tl.missing_step_ids == ["s4"]
    assert [s.performed_index for s in tl.steps] == [1, 3, 2, None, 4, 5]


def test_refine_pass_tightens_boundaries_and_ignores_answers_outside_the_clip(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)
    rb = _rubric([], ["s1"])
    ctx = _StubCtx(200.0, _reply(("s1", 20, 40), ("s2", 100, 130)),
                   refine_reply=_RefineReply(performed=True, start_s=22.0, end_s=37.5, confidence=0.9))
    tl = timeline.run(ctx, rb)  # 200 s is sampled at 1 fps, so the refine pass runs
    assert sorted(p for p, _ in ctx.calls) == ["timeline", "timeline_refine:s1", "timeline_refine:s2"]
    clip = next(parts[0] for p, parts in ctx.calls if p == "timeline_refine:s1")
    assert (clip["start_s"], clip["end_s"], clip["fps"]) == (16.0, 44.0, 4.0)
    by_id = {s.step_id: s for s in tl.steps}
    assert (by_id["s1"].start_s, by_id["s1"].end_s) == (22.0, 37.5)
    assert (by_id["s2"].start_s, by_id["s2"].end_s) == (100.0, 130.0)  # 22-37.5 is outside s2's clip


def test_review_stores_step_overrides(migrated, sample_video):
    """The decision the review screen posts stores per-step overrides."""
    from fastapi.testclient import TestClient

    from app import jobs, repo
    from app.main import app

    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug="sit_to_stand", name="Sit to stand")
    skill_id = repo.get_job(job_id)["skill_id"]
    video = jobs.ingest(str(sample_video), "attempt", sample_video.name)
    attempt_id = repo.create_attempt(skill_id, video["id"], "Reviewer test")
    jobs.run_attempt(repo.create_job("attempt", video["id"], skill_id=skill_id, attempt_id=attempt_id))

    with TestClient(app) as client:
        body = {"overall": "unverified", "note": "Camera angle hides the feet",
                "steps": [{"step_id": "s2", "status": "passed", "note": "fine on rewatch"},
                          {"step_id": "s3", "status": None, "note": ""}]}
        res = client.post(f"/api/attempts/{attempt_id}/review", json=body).json()
    assert res["final_status"] == "unverified" and res["reviewed_at"] and res["nurse_note"] == body["note"]
    steps = {s["step_id"]: s for s in res["steps"]}
    assert (steps["s2"]["nurse_status"], steps["s2"]["nurse_note"]) == ("passed", "fine on rewatch")
    assert steps["s3"]["nurse_status"] is None and steps["s3"]["status"] == "unverified"
    assert res["order_violations"] and all(s["found"] for s in res["steps"])


def test_fake_mode_makes_no_calls():
    ctx = _StubCtx(45.0, None)
    tl = timeline.run(ctx, SIT_TO_STAND)
    assert ctx.calls == [] and len(tl.steps) == len(SIT_TO_STAND.steps)
