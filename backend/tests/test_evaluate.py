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
        self.calls = []
        self.logs = []
        self._lock = threading.Lock()

    def video_part(self, **kwargs):
        return {"type": "video", **kwargs}

    def generate_json(self, purpose, parts, schema, **kwargs):
        with self._lock:
            self.calls.append({"purpose": purpose, "video": parts[0], "schema": schema, **kwargs})
        return self.answer(purpose, parts, schema)

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
        judgement("s1", "failed", 95),       # failed critical -> checked
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
        assert c["video"]["resolution"] == "high" and c["video"]["fps"] > 1
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
    result = StepResult(step_id="s4", status="unverified", confidence=0.3, feedback="",
                        evidence_start_s=30.0, evidence_end_s=32.0)
    assert evaluate.step_window("s4", GLOVE_REMOVAL, timeline, result, 60.0) == (27.0, 35.0)


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
        return FlagCheckReply(observed=False)
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
    assert one_minor.overall == "passed" and not one_minor.needs_nurse_review and one_minor.score_pct == 91.7

    medium = SafetyFlag(kind="patient_off_center", severity="medium", start_s=3, description="leans left")
    flagged = scoring.score(rubric, timeline, _ev(["passed"] * 6), [medium, medium])
    assert flagged.overall == "passed" and flagged.needs_nurse_review
    assert flagged.reasons.count("Safety point for a nurse to review: leans left") == 1

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
