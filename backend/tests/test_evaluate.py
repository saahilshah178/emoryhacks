"""Evaluate stage and scoring. Gemini is never called: ctx.generate_json is stubbed."""
import threading

import pytest

from app import config
from app.models import (
    Evaluation, OrderViolation, PersonObs, SafetyFlag, StepResult, Timeline, TimelineStep,
)
from app.stages import _fake, evaluate, scoring
from app.stages.evaluate import FlagCheckReply, FlagObservation, GradeReply, StepJudgement
from fixtures_evaluate import GLOVE_MISSING_TIMELINE, GLOVE_REMOVAL, GLOVE_SKILL, GLOVE_TIMELINE


class StubCtx:
    """Stands in for jobs.StageContext: records Gemini requests and answers them with `answer`."""

    def __init__(self, answer, duration=60.0, skill=GLOVE_SKILL):
        self.answer = answer
        self.duration = duration
        self.skill = skill
        self.video = {"height": 360}
        self.calls = []
        self.logs = []
        self._lock = threading.Lock()

    def video_part(self, **kwargs):
        return {"type": "video", **kwargs}

    def generate_json(self, purpose, parts, schema, **kwargs):
        with self._lock:
            self.calls.append({"purpose": purpose, "video": parts[0], "schema": schema, **kwargs})
        return self.answer(purpose, parts, schema)

    def generate_text(self, purpose, parts, **kwargs):
        with self._lock:
            self.calls.append({"purpose": purpose, "video": None, "schema": None, **kwargs})
        return "Rewritten summary."

    def log(self, message):
        self.logs.append(message)


@pytest.fixture
def real_ai(monkeypatch):
    monkeypatch.setattr(config, "FAKE_AI", False)


def judgement(step_id, status="passed", pct=90, start=1, end=2, feedback="Good."):
    return StepJudgement(step_id=step_id, evidence="seen", evidence_start_s=start, evidence_end_s=end,
                         status=status, confidence_pct=pct, feedback=feedback)


def grade_reply(steps, **kw):
    base = dict(people=[PersonObs(label="P1", role="caregiver", description="gown and gloves")], skill_match=True,
                steps=steps, safety_flags=[], overall_feedback="Nice work.")
    return GradeReply(**{**base, **kw})


def answer_with(first: GradeReply, second=lambda step_id: judgement(step_id, "passed", 95)):
    def answer(purpose, parts, schema):
        if purpose == "evaluate":
            return first
        return second(purpose.split(":")[1])
    return answer


# --- run: validation ----------------------------------------------------------------
def test_one_result_per_step_with_clamping(real_ai):
    reply = grade_reply(
        steps=[judgement("s1", pct=150, start=80, end=70), judgement("s1", "failed"), judgement("s9"),
               judgement("s2"), judgement("s3"), judgement("s4"), judgement("s5", pct=-5), judgement("s6")],
        safety_flags=[FlagObservation(kind="patient_distress", severity="high", start_s=-3, end_s=500,
                                      person_label="P7", description="grimaces")],
    )
    ctx = StubCtx(answer_with(reply), duration=60.0)
    ev = evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)

    assert [r.step_id for r in ev.steps] == ["s1", "s2", "s3", "s4", "s5", "s6"]
    s1 = ev.steps[0]
    assert s1.status == "passed" and s1.confidence == 1.0  # first duplicate kept, confidence clamped
    assert (s1.evidence_start_s, s1.evidence_end_s) == (60.0, 60.0)
    flag = ev.safety_flags[0]
    assert (flag.start_s, flag.end_s, flag.person_label) == (0.0, 60.0, None)
    assert flag.source == "gemini" and flag.counts_toward_score
    assert ev.steps[4].double_checked  # s5 had confidence 0 so it got a second look


def test_omitted_steps_become_unverified_then_double_checked(real_ai):
    reply = grade_reply(steps=[judgement("s1"), judgement("s2"), judgement("s3"), judgement("s6")])
    ctx = StubCtx(answer_with(reply, second=lambda step_id: judgement(step_id, "unverified", 40)))
    ev = evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)
    by_id = {r.step_id: r for r in ev.steps}
    assert by_id["s4"].status == by_id["s5"].status == "unverified"
    assert by_id["s4"].double_checked and by_id["s5"].double_checked
    assert not by_id["s1"].double_checked


def test_fake_path_makes_no_calls():
    ctx = StubCtx(lambda *a: pytest.fail("Gemini called in fake mode"))
    ev = evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)
    assert len(ev.steps) == len(GLOVE_REMOVAL.steps) and not ctx.calls
    flags = [SafetyFlag(kind="other", severity="high", start_s=1, description="x", source="pose",
                        counts_toward_score=False)]
    assert evaluate.confirm_pose_flags(ctx, GLOVE_REMOVAL, flags) == flags


# --- run: double-check --------------------------------------------------------------
def test_double_check_picks_unclear_steps_and_replaces_them(real_ai):
    reply = grade_reply(steps=[
        judgement("s1", "failed", 95, start=30, end=34),  # failed critical -> checked
        judgement("s2", "passed", 50),       # low confidence -> checked
        judgement("s3", "passed", 95),
        judgement("s4", "unverified", 80),   # unverified -> checked
        judgement("s5", "passed", 90),
        judgement("s6", "failed", 90),       # failed but not critical -> not checked
    ])
    ctx = StubCtx(answer_with(reply), duration=70.0)
    ev = evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)

    checks = [c for c in ctx.calls if c["purpose"].startswith("evaluate_double_check")]
    assert sorted(c["purpose"].split(":")[1] for c in checks) == ["s1", "s2", "s4"]
    for c in checks:
        assert c["model"] == "strong" and c["schema"] is StepJudgement
        assert c["video"]["resolution"] == "medium" and c["video"]["fps"] > 1  # the stub video is 360p
    assert ev.overall_feedback == "Rewritten summary."  # a status changed, so the summary was rewritten
    s1_clip = next(c["video"] for c in checks if c["purpose"].endswith("s1"))
    assert (s1_clip["start_s"], s1_clip["end_s"]) == (26.0, 39.0)  # timeline 29-36 padded by 3 s
    by_id = {r.step_id: r for r in ev.steps}
    assert by_id["s1"].status == "passed" and by_id["s1"].double_checked
    assert by_id["s6"].status == "failed" and not by_id["s6"].double_checked
    assert by_id["s3"].double_checked is False


def test_double_check_is_capped_and_critical_first(real_ai):
    rubric = GLOVE_REMOVAL.model_copy(deep=True)
    template = rubric.steps[2]
    extra = [template.model_copy(update={"step_id": f"x{i}", "order": 10 + i}) for i in range(4)]
    rubric.steps.extend(extra)
    picked = evaluate.pick_double_checks(rubric, Evaluation(people=[], steps=[
        StepResult(step_id=s.step_id, status="unverified", confidence=0.1 if s.step_id.startswith("x") else 0.6,
                   feedback="") for s in rubric.steps
    ]))
    assert len(picked) == evaluate.MAX_DOUBLE_CHECKS
    assert picked[:4] == ["s1", "s2", "s4", "s5"]  # the critical steps come first


def test_failed_double_check_keeps_first_result(real_ai):
    reply = grade_reply(steps=[judgement(f"s{i}", "unverified" if i == 2 else "passed", 90) for i in range(1, 7)])

    def second(step_id):
        raise RuntimeError("model unavailable")
    ctx = StubCtx(answer_with(reply, second))
    ev = evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)
    assert ev.steps[1].status == "unverified" and not ev.steps[1].double_checked
    assert any("keeping first result" in line for line in ctx.logs)


def test_skill_mismatch_skips_double_check(real_ai):
    reply = grade_reply(steps=[judgement(f"s{i}", "failed", 95) for i in range(1, 7)], skill_match=False,
                        skill_match_note="Shows a fall response.")
    ctx = StubCtx(answer_with(reply))
    ev = evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)
    assert [c["purpose"] for c in ctx.calls] == ["evaluate"]
    assert ev.skill_match is False and ev.skill_match_note == "Shows a fall response."


def test_window_for_unlocated_step_lies_between_neighbours():
    # s4 and s5 were not located; s3 ends at 23 and s6 starts at 23, so the neighbours touch
    # and the window falls back to the whole video.
    assert evaluate.step_window("s4", GLOVE_REMOVAL, GLOVE_MISSING_TIMELINE, None, 25.0) == (0.0, 25.0)
    timeline = GLOVE_MISSING_TIMELINE.model_copy(deep=True)
    timeline.steps[5].start_s, timeline.steps[5].end_s = 40.0, 44.0
    assert evaluate.step_window("s4", GLOVE_REMOVAL, timeline, None, 60.0) == (20.0, 43.0)
    # First-pass evidence inside the gap does not narrow it; evidence outside widens it, up to MAX_CLIP_S.
    def seen(start, end):
        return StepResult(step_id="s4", status="unverified", confidence=0.3, feedback="",
                          evidence_start_s=start, evidence_end_s=end)
    assert evaluate.step_window("s4", GLOVE_REMOVAL, timeline, seen(30.0, 32.0), 60.0) == (20.0, 43.0)
    assert evaluate.step_window("s4", GLOVE_REMOVAL, timeline, seen(45.0, 50.0), 60.0) == (20.0, 53.0)
    timeline.steps[5].start_s, timeline.steps[5].end_s = 90.0, 95.0
    assert evaluate.step_window("s4", GLOVE_REMOVAL, timeline, seen(5.0, 8.0), 120.0) == (20.0, 93.0)


def test_window_for_a_located_step_takes_in_evidence_seen_elsewhere():
    # The timeline put s1 at 29-36 but the first pass saw it at 40-44: the clip covers both.
    result = StepResult(step_id="s1", status="passed", confidence=0.6, feedback="",
                        evidence_start_s=40.0, evidence_end_s=44.0)
    assert evaluate.step_window("s1", GLOVE_REMOVAL, GLOVE_TIMELINE, result, 70.0) == (26.0, 47.0)
    assert evaluate.step_window("s1", GLOVE_REMOVAL, GLOVE_TIMELINE, None, 70.0) == (26.0, 39.0)


def test_unseen_step_keeps_no_evidence_times(real_ai):
    """Evidence times are nullable, so a step nobody saw is not saved at 0-0."""
    unseen = StepJudgement(step_id="s6", evidence="not seen", evidence_start_s=None, evidence_end_s=None,
                           status="failed", confidence_pct=90, feedback="Wash your hands.")
    result = evaluate.to_step_result(unseen, 60.0)
    assert (result.evidence_start_s, result.evidence_end_s) == (None, None)
    assert StepJudgement.model_json_schema()["required"].count("evidence_start_s") == 1


# --- confirm_pose_flags -------------------------------------------------------------
def _pose_flag(severity, start):
    return SafetyFlag(kind="patient_off_center", severity=severity, start_s=start, end_s=start + 2,
                      person_label="P2", description="centre of mass outside base", source="pose",
                      counts_toward_score=False)


def test_confirm_pose_flags_checks_three_most_severe(real_ai):
    flags = [_pose_flag("low", 1), _pose_flag("high", 10), _pose_flag("medium", 20), _pose_flag("medium", 30),
             _pose_flag("low", 40)]

    def answer(purpose, parts, schema):
        assert schema is FlagCheckReply
        start = parts[0]["start_s"]
        if start == 8.0:  # the high flag's clip
            return FlagCheckReply(observed=True, kind="patient_unsteady", severity="medium", start_s=10, end_s=12,
                                  description="The patient's knees buckle as they stand.")
        return FlagCheckReply(observed=False, description="")
    ctx = StubCtx(answer, duration=60.0)
    out = evaluate.confirm_pose_flags(ctx, GLOVE_REMOVAL, flags)

    assert sorted(c["video"]["start_s"] for c in ctx.calls) == [8.0, 18.0, 28.0]
    assert out[1].source == "pose_confirmed" and out[1].counts_toward_score
    assert (out[1].severity, out[1].kind) == ("medium", "patient_unsteady")
    assert out[1].description == "The patient's knees buckle as they stand."
    assert [f for i, f in enumerate(out) if i != 1] == [f for i, f in enumerate(flags) if i != 1]


# --- scoring -------------------------------------------------------------------------
def _ev(statuses, **kw):
    return Evaluation(people=[], steps=[StepResult(step_id=f"s{i + 1}", status=s, confidence=0.9, feedback="")
                                       for i, s in enumerate(statuses)], **kw)


def test_scoring_reasons_and_review():
    rubric, timeline = GLOVE_REMOVAL, GLOVE_TIMELINE  # s1, s2, s4, s5 are critical
    ok = scoring.score(rubric, timeline, _ev(["passed"] * 6), [])
    assert (ok.overall, ok.score_pct, ok.needs_nurse_review) == ("passed", 100.0, False)

    one_minor = scoring.score(rubric, timeline, _ev(["passed"] * 5 + ["unverified"]), [])
    assert one_minor.overall == "passed" and one_minor.score_pct == 91.7
    assert one_minor.needs_nurse_review  # nobody saw s6, so a nurse should

    missing = scoring.score(rubric, GLOVE_MISSING_TIMELINE, _ev(["passed", "passed", "passed", "failed", "failed", "passed"]), [])
    assert missing.overall == "failed"
    assert missing.reasons[0] == 'A critical step was not done correctly: "Slide bare fingers inside the second cuff".'
    assert "2 of 6 steps were not done correctly." in missing.reasons

    mismatch = scoring.score(rubric, timeline, _ev(["failed"] * 6, skill_match=False, skill_match_note="Shows a fall."), [])
    assert (mismatch.overall, mismatch.score_pct) == ("failed", 0.0)
    assert mismatch.reasons == ["The video does not appear to show this skill. Shows a fall."]

    no_result = scoring.score(rubric, timeline, _ev(["passed"] * 5), [])  # s6 has no result
    assert no_result.overall == "passed" and no_result.score_pct == 91.7

    violation = OrderViolation(step_id="s2", expected_after="s1", message='"Peel" came before "Pinch".')
    unordered = rubric.model_copy(update={"order_matters": False})
    assert scoring.score(unordered, Timeline(steps=timeline.steps, order_violations=[violation]),
                         _ev(["passed"] * 6), []).overall == "passed"
    out_of_order = scoring.score(rubric, Timeline(steps=timeline.steps, order_violations=[violation, violation]),
                                 _ev(["passed"] * 6), [])
    assert out_of_order.overall == "failed" and len(out_of_order.reasons) == 1


def test_fake_evaluation_scores_as_before():
    """The canned pipeline output still fails (failed critical step and an order violation)."""
    class Ctx:
        duration = 60.0
    rb = _fake.rubric(Ctx())
    tl = _fake.timeline(Ctx(), rb)
    ev = _fake.evaluation(Ctx(), rb, tl)
    sc = scoring.score(rb, tl, ev, ev.safety_flags)
    assert sc.overall == "failed" and sc.needs_nurse_review
    assert any(r.startswith("Steps out of order") for r in sc.reasons)


def test_timeline_step_none_times_do_not_break_window():
    timeline = Timeline(steps=[TimelineStep(step_id=s.step_id, found=False) for s in GLOVE_REMOVAL.steps])
    assert evaluate.step_window("s3", GLOVE_REMOVAL, timeline, None, 70.0) == (0.0, 70.0)


def test_double_check_uses_high_resolution_for_webcam_sized_video(real_ai):
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in range(1, 7)][:5] + [judgement("s6", "passed", 40)])
    ctx = StubCtx(answer_with(reply), duration=70.0)
    ctx.video = {"height": 720}
    evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)
    checks = [c for c in ctx.calls if c["purpose"].startswith("evaluate_double_check")]
    assert checks and all(c["video"]["resolution"] == "high" for c in checks)
    assert all(c["max_output_tokens"] == evaluate.DOUBLE_CHECK_MAX_TOKENS for c in checks)


# --- scoring: safety flags, order confidence, combined fraction --------------------------
def _flag(kind="patient_off_center", severity="medium", start=10.0, end=12.0, description="leans left", **kw):
    return SafetyFlag(kind=kind, severity=severity, start_s=start, end_s=end, description=description, **kw)


def test_counted_patient_flags_lower_the_score_and_medium_sends_for_review():
    rubric, timeline, all_passed = GLOVE_REMOVAL, GLOVE_TIMELINE, _ev(["passed"] * 6)

    medium = scoring.score(rubric, timeline, all_passed, [_flag(), _flag()])  # the same flag twice counts once
    assert (medium.overall, medium.score_pct, medium.needs_nurse_review) == ("unverified", 90.0, True)
    assert medium.reasons == ["Patient safety concern for a nurse to review: leans left"]

    high = scoring.score(rubric, timeline, all_passed, [_flag(kind="patient_distress", severity="high")])
    assert (high.overall, high.score_pct) == ("failed", 75.0)

    low = scoring.score(rubric, timeline, all_passed, [_flag(severity="low", description="grimaces")])
    assert (low.overall, low.score_pct, low.needs_nurse_review) == ("passed", 95.0, False)
    assert low.reasons == ["All steps met the criteria.", "Minor safety point: grimaces"]


def test_flags_not_about_the_patient_keep_the_result():
    caregiver = _flag(kind="unsafe_caregiver_posture", description="pulls on the arm")
    sc = scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, _ev(["passed"] * 6), [caregiver])
    assert (sc.overall, sc.score_pct, sc.needs_nurse_review) == ("passed", 90.0, True)
    assert sc.reasons[1] == "Safety point for a nurse to review: pulls on the arm"
    clutter = _flag(kind="environment_hazard", severity="low", description="clutter")
    assert scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, _ev(["passed"] * 6), [clutter]).score_pct == 100.0


def test_flags_that_do_not_count_change_nothing():
    advisory = [_flag(severity=s, source="pose", counts_toward_score=False) for s in ("high", "medium", "low")]
    sc = scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, _ev(["passed"] * 6), advisory)
    assert (sc.overall, sc.score_pct, sc.needs_nurse_review, sc.reasons) == (
        "passed", 100.0, False, ["All steps met the criteria."])


def test_one_event_flagged_by_gemini_and_pose_counts_once_at_its_highest_severity():
    gemini_flag = _flag(severity="medium", start=10, end=14, description="Patient leans hard left.")
    confirmed = _flag(severity="high", start=12, end=15, description="Patient slides off the seat.",
                      source="pose_confirmed")
    later = _flag(severity="medium", start=40, end=42, description="Leans again.")
    sc = scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, _ev(["passed"] * 6), [gemini_flag, confirmed, later])
    assert sc.overall == "failed" and sc.score_pct == 65.0  # 100 - 25 (high) - 10 (the later medium)
    assert sc.reasons[0] == "Safety risk: Patient slides off the seat."


def test_order_violation_fails_only_when_the_timeline_was_sure_of_both_steps():
    violation = OrderViolation(step_id="s2", expected_after="s1", message='"Peel" came before "Pinch".')
    sure = Timeline(steps=GLOVE_TIMELINE.steps, order_violations=[violation])  # both at confidence 0.8
    failed = scoring.score(GLOVE_REMOVAL, sure, _ev(["passed"] * 6), [])
    assert (failed.overall, failed.score_pct) == ("failed", 85.0)  # never 100 for a failed attempt

    steps = [t.model_copy(update={"confidence": 0.3}) if t.step_id == "s1" else t for t in GLOVE_TIMELINE.steps]
    unsure = scoring.score(GLOVE_REMOVAL, Timeline(steps=steps, order_violations=[violation]), _ev(["passed"] * 6), [])
    assert (unsure.overall, unsure.score_pct, unsure.needs_nurse_review) == ("unverified", 100.0, True)
    assert unsure.reasons == ['Steps may be out of order: "Peel" came before "Pinch".']


def test_many_steps_failed_or_unseen_together_need_review():
    rubric = GLOVE_REMOVAL.model_copy(deep=True)
    extra = [rubric.steps[2].model_copy(update={"step_id": f"s{i}", "order": i}) for i in (7, 8)]
    rubric.steps.extend(extra)  # 8 steps; s3, s6, s7 and s8 are not critical
    statuses = ["passed", "passed", "failed", "passed", "passed", "failed", "unverified", "unverified"]
    sc = scoring.score(rubric, GLOVE_TIMELINE, _ev(statuses), [])
    assert (sc.overall, sc.needs_nurse_review, sc.score_pct) == ("unverified", True, 62.5)
    assert sc.reasons == ["4 of 8 steps were not done correctly or could not be seen."]


def test_critical_step_passed_with_low_confidence_needs_review():
    ev = _ev(["passed"] * 6)
    ev.steps[0] = ev.steps[0].model_copy(update={"confidence": 0.4})
    sc = scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, ev, [])
    assert sc.overall == "unverified" and sc.reasons[0].endswith('"Pinch the first glove at the wrist".')


# --- second look: keep the better-supported verdict ---------------------------------
def _result(status, confidence, evidence="seen"):
    return StepResult(step_id="s1", status=status, confidence=confidence, feedback="", evidence=evidence)


def test_better_supported_keeps_a_confident_first_verdict():
    keep = evaluate.better_supported(_result("failed", 0.95), _result("passed", 0.4), whole_video=False)
    assert keep.status == "failed" and keep.double_checked
    assert 'second look said "passed" (40% sure)' in keep.evidence
    assert evaluate.better_supported(_result("passed", 0.5), _result("failed", 0.9), False).status == "failed"
    assert evaluate.better_supported(_result("unverified", 0.9), _result("passed", 0.6), False).status == "passed"
    same = evaluate.better_supported(_result("passed", 0.6), _result("passed", 0.9, "closer"), False)
    assert same.evidence == "closer"


def test_unseen_on_a_partial_clip_never_overturns_a_verdict():
    before = _result("failed", 0.6)
    assert evaluate.better_supported(before, _result("unverified", 0.95), whole_video=False).status == "failed"
    assert evaluate.better_supported(before, _result("unverified", 0.95), whole_video=True).status == "unverified"


def test_double_check_of_an_unlocated_step_with_no_located_neighbours_watches_the_whole_video(real_ai):
    timeline = Timeline(steps=[TimelineStep(step_id=s.step_id, found=False) for s in GLOVE_REMOVAL.steps])
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in range(1, 6)]
                        + [judgement("s6", "unverified", 80, start=None, end=None)])
    ctx = StubCtx(answer_with(reply), duration=70.0)
    ctx.video = {"height": 720}
    evaluate.run(ctx, GLOVE_REMOVAL, timeline)
    [check] = [c for c in ctx.calls if c["purpose"].startswith("evaluate_double_check")]
    v = check["video"]
    assert (v["start_s"], v["end_s"], v["fps"], v["resolution"]) == (0.0, 70.0, evaluate.WHOLE_VIDEO_FPS, "medium")


def test_double_check_prompt_fails_an_absent_step_only_on_the_whole_video():
    step = GLOVE_REMOVAL.steps[0]
    clip = evaluate.prompts.double_check_prompt(GLOVE_SKILL, step, 20, 40, 70)
    whole = evaluate.prompts.double_check_prompt(GLOVE_SKILL, step, 0, 70, 70, whole_video=True)
    assert "does not appear in this clip at all" in clip and "recording ends before it" not in clip
    assert "the whole 70-second video" in whole and "recording ends before it" in whole


def test_grade_prompt_fails_a_step_that_was_never_performed():
    prompt = evaluate.prompts.grade_prompt(GLOVE_SKILL, GLOVE_REMOVAL, GLOVE_TIMELINE, 70)
    assert "or the recording ends before it" in prompt
    assert "A step the recording\n     ends before is failed, not unverified" in prompt
    assert "use null for both" in prompt


# --- a recording that stops early -----------------------------------------------------
STOPPED_AFTER_S3 = Timeline(steps=[
    TimelineStep(step_id="s1", found=True, start_s=5, end_s=12, confidence=0.8),
    TimelineStep(step_id="s2", found=True, start_s=12, end_s=17, confidence=0.8),
    TimelineStep(step_id="s3", found=True, start_s=17, end_s=23, confidence=0.8),
    *[TimelineStep(step_id=f"s{i}", found=False) for i in (4, 5, 6)],
])


def test_steps_after_the_recording_ends():
    assert evaluate.steps_after_recording_end(GLOVE_REMOVAL, STOPPED_AFTER_S3, 24.0) == ["s4", "s5", "s6"]
    assert evaluate.steps_after_recording_end(GLOVE_REMOVAL, STOPPED_AFTER_S3, 60.0) == []  # it kept going
    assert evaluate.steps_after_recording_end(GLOVE_REMOVAL, GLOVE_MISSING_TIMELINE, 25.0) == []  # s6 was found
    nothing = Timeline(steps=[TimelineStep(step_id=s.step_id, found=False) for s in GLOVE_REMOVAL.steps])
    assert evaluate.steps_after_recording_end(GLOVE_REMOVAL, nothing, 24.0) == []


def test_steps_the_recording_stopped_before_are_failed_without_a_second_look(real_ai):
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in (1, 2, 3)]
                        + [judgement(f"s{i}", "unverified", 80, start=None, end=None) for i in (4, 5)])  # s6 omitted
    ctx = StubCtx(answer_with(reply), duration=24.0)
    ev = evaluate.run(ctx, GLOVE_REMOVAL, STOPPED_AFTER_S3)
    assert [r.status for r in ev.steps] == ["passed"] * 3 + ["failed"] * 3
    assert ev.steps[3].evidence == "The recording ends before this step." and ev.steps[3].evidence_start_s is None
    assert not any(c["purpose"].startswith("evaluate_double_check") for c in ctx.calls)
    assert ev.overall_feedback == "Rewritten summary."
    sc = scoring.score(GLOVE_REMOVAL, STOPPED_AFTER_S3, ev, [])
    assert sc.overall == "failed" and sc.score_pct == 50.0


def test_unseen_failed_steps_after_the_recording_ends_get_no_second_look(real_ai):
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in (1, 2, 3)]
                        + [judgement("s4", "failed", 90, start=22, end=24)]  # seen: still worth a second look
                        + [judgement(f"s{i}", "failed", 90, start=None, end=None) for i in (5, 6)])
    ctx = StubCtx(answer_with(reply), duration=24.0)
    ev = evaluate.run(ctx, GLOVE_REMOVAL, STOPPED_AFTER_S3)
    checked = [c["purpose"] for c in ctx.calls if c["purpose"].startswith("evaluate_double_check")]
    assert checked == ["evaluate_double_check:s4"]
    assert [r.status for r in ev.steps[4:]] == ["failed", "failed"]


def test_rewritten_summary_is_told_about_order_problems_and_safety_flags(real_ai):
    violation = OrderViolation(step_id="s2", expected_after="s1", message='"Peel" came before "Pinch".')
    timeline = Timeline(steps=GLOVE_TIMELINE.steps, order_violations=[violation])
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in range(1, 6)] + [judgement("s6", "passed", 40)],
                        safety_flags=[FlagObservation(kind="patient_distress", severity="medium", start_s=3,
                                                      description="Says their wrist hurts.")])
    ctx = StubCtx(answer_with(reply, second=lambda step_id: judgement(step_id, "failed", 90)), duration=70.0)
    prompts_sent = []
    ctx.generate_text = lambda purpose, parts, **kw: prompts_sent.append(parts[0]["text"]) or "Summary."
    evaluate.run(ctx, GLOVE_REMOVAL, timeline)
    [prompt] = prompts_sent
    assert '- Order: "Peel" came before "Pinch".' in prompt and "- Safety (medium): Says their wrist hurts." in prompt


def test_confirmed_flag_on_a_track_with_no_known_role_drops_the_track_label(real_ai):
    flag = _pose_flag("medium", 10).model_copy(update={"person_label": "track 0"})
    named = _pose_flag("medium", 30).model_copy(update={"person_label": "patient (track 1)"})
    ctx = StubCtx(lambda *a: FlagCheckReply(observed=True, kind="patient_unsteady", severity="high",
                                            description="The patient sways."))
    out = evaluate.confirm_pose_flags(ctx, GLOVE_REMOVAL, [flag, named])
    assert [f.person_label for f in out] == [None, "patient (track 1)"]
    assert "description" in FlagCheckReply.model_json_schema()["required"]


def test_safety_prompts_do_not_flag_the_instability_a_drill_is_about():
    grade = evaluate.prompts.grade_prompt(GLOVE_SKILL, GLOVE_REMOVAL, GLOVE_TIMELINE, 70)
    confirm = evaluate.prompts.confirm_flag_prompt(GLOVE_SKILL, _pose_flag("medium", 10), 8, 14, 70, [])
    assert "do not flag that instability itself" in grade
    assert "the loss of balance a drill" in confirm
