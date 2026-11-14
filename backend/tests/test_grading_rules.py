"""Grading by sight only, steps that were not needed, and recordings that start part-way in.
Gemini is never called: ctx.generate_json is stubbed (see test_evaluate.StubCtx)."""
import re

import pytest

from app.models import Evaluation, OrderViolation, SafetyFlag, StepResult, Timeline, TimelineStep
from app.stages import _fake, assess, evaluate, scoring, timeline
from app.stages import evaluate_prompts as prompts
from fixtures_evaluate import GLOVE_REMOVAL, GLOVE_SKILL, GLOVE_TIMELINE, SIT_TO_STAND
from test_evaluate import StubCtx, answer_with, grade_reply, judgement, real_ai  # noqa: F401

NA = "not_applicable"
# Words that would tell the model to use sound. The rubric text in a prompt is checked
# separately (sight.spoken_words); this is about the prompt's own instructions.
HEARING = re.compile(r"\b(hear\w*|audio|audibl\w*|inaudible|speech|spoken|speak\w*|microphone|voices?|say\w*|said"
                     r"|aloud|listen\w*)\b", re.IGNORECASE)


def conditional(rubric, step_id, when="The patient cannot get up unaided after being lowered."):
    """rubric with step_id needed only when `when`."""
    rubric = rubric.model_copy(deep=True)
    for s in rubric.steps:
        if s.step_id == step_id:
            s.applies_when = when
    return rubric


def result(step_id, status, confidence=0.9, start=None, end=None, evidence="seen"):
    return StepResult(step_id=step_id, status=status, confidence=confidence, feedback="", evidence=evidence,
                      evidence_start_s=start, evidence_end_s=end)


def ev(statuses, **kw):
    return Evaluation(people=[], steps=[result(f"s{i + 1}", s) for i, s in enumerate(statuses)], **kw)


# --- the prompts: sight only ----------------------------------------------------------
def test_no_grading_prompt_asks_the_model_to_use_sound():
    # The glove rubric has no text that depends on speech, so a hearing word would be the prompt's own.
    rubric = conditional(GLOVE_REMOVAL, "s6", "The caregiver touched something dirty.")
    step = rubric.steps[5]
    flag = SafetyFlag(kind="patient_off_center", severity="medium", start_s=10, end_s=12, description="leans")
    texts = {
        "assess": assess.assess_prompts.assess_prompt(GLOVE_SKILL, rubric, 70),
        "clip": prompts.double_check_prompt(GLOVE_SKILL, step, 20, 40, 70),
        "clip at the start": prompts.double_check_prompt(GLOVE_SKILL, step, 0, 12, 70),
        "whole": prompts.double_check_prompt(GLOVE_SKILL, step, 0, 70, 70, whole_video=True),
        "confirm flag": prompts.confirm_flag_prompt(GLOVE_SKILL, flag, 8, 14, 70, rubric.safety_criteria),
        "refine": timeline.timeline_prompts.refine(step.title, step.description, step.evals.visual_cues,
                                                   10, 14, 7, 17),
    }
    for name, text in texts.items():
        assert not HEARING.findall(text), (name, HEARING.findall(text))
        assert "no sound" in text, name
    assert "grimacing, flinching, clutching" in texts["assess"]


def test_criteria_that_depend_on_speech_never_reach_the_model():
    greet = SIT_TO_STAND.steps[0]  # every criterion of "Greet and explain" is about speaking
    block = prompts._step_block(greet)
    assert "speaks" not in block and "saying anything" not in block and "no audio" not in block
    assert "talking" not in block
    assert "Passed when: what the step describes can be seen to be done." in block
    assert 'What it is: Face the patient' in block  # the step is still shown, judged by sight

    rise = SIT_TO_STAND.steps[5].model_copy(deep=True)
    rise.evals.fail_criteria.append("The caregiver does not count aloud.")
    block = prompts._step_block(rise)
    assert "count aloud" not in block
    assert "The patient is lifted or pulled up without leaning forward." in block  # sight criteria stay
    assert prompts._step_block(rise) == block  # deterministic


def test_refine_prompt_leaves_out_spoken_cues(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "FAKE_AI", False)
    rubric = conditional(GLOVE_REMOVAL, "s6", "")
    rubric.steps[0].evals.visual_cues = ["Caregiver says 'pinch'.", "One gloved hand pinching the other."]
    reply = assess.AssessReply(
        observed=[], people=[], skill_match=True, overall_feedback="",
        steps=[assess.StepAssessment(step_id="s1", performed=True, start_s=20, end_s=40, timing_confidence_pct=90,
                                     evidence="seen", status="passed", confidence_pct=90, feedback="", note="")])
    sent = []

    class Ctx:
        duration = 300.0
        skill = GLOVE_SKILL

        def video_part(self, **kw):
            return {"type": "video", **kw}

        def generate_json(self, purpose, parts, schema, **kw):
            sent.append((purpose, parts[1]["text"]))
            return reply if purpose == "assess" else timeline._RefineReply(performed=False, start_s=0, end_s=0,
                                                                           confidence=0)

        def log(self, message):
            pass
    timeline.run(Ctx(), rubric)
    [refine] = [text for purpose, text in sent if purpose.startswith("timeline_refine")]
    assert "One gloved hand pinching the other." in refine and "says" not in refine


def test_grading_prompts_judge_the_purpose_not_incidental_detail():
    rubric = GLOVE_REMOVAL
    for text in (assess.assess_prompts.assess_prompt(GLOVE_SKILL, rubric, 70),
                 prompts.double_check_prompt(GLOVE_SKILL, rubric.steps[0], 20, 40, 70)):
        assert "an equally safe way of achieving\n  the same thing passes" in text
        assert "a fail criterion that is seen is still a\n  failure" in text
    flag = SafetyFlag(kind="other", severity="low", start_s=1, description="x")
    confirm = prompts.confirm_flag_prompt(GLOVE_SKILL, flag, 0, 4, 70, [])
    assert "equally safe" not in confirm  # no criteria to read there


# --- the prompts: not needed and the start of the recording ------------------------------
def test_a_conditional_step_shows_its_condition_and_the_not_applicable_rules():
    rubric = conditional(GLOVE_REMOVAL, "s6", "The caregiver touched something dirty.")
    text = assess.assess_prompts.assess_prompt(GLOVE_SKILL, rubric, 70)
    assert "  Only needed when: The caregiver touched something dirty.\n" in text
    assert text.count("Only needed when") == 2  # the s6 block, and the rule that names the line
    assert '- not_applicable: only for a step that has an "Only needed when" line' in text
    assert "If you cannot tell whether the situation came up, it is unverified." in text
    assert "one plain sentence on why the step was not needed this time" in text
    whole = prompts.double_check_prompt(GLOVE_SKILL, rubric.steps[5], 0, 70, 70, whole_video=True)
    clip = prompts.double_check_prompt(GLOVE_SKILL, rubric.steps[5], 20, 40, 70)
    assert "- not_applicable:" in whole and "- not_applicable:" not in clip
    assert "the clip cannot show whether that situation came up" in clip
    assert "Only needed when" not in prompts._step_block(GLOVE_REMOVAL.steps[5])


def test_the_start_rule_is_in_the_whole_video_prompts_and_a_clip_only_at_the_start():
    step = GLOVE_REMOVAL.steps[0]
    rule = "A step that comes before the first thing the recording shows"
    assert rule in assess.assess_prompts.assess_prompt(GLOVE_SKILL, GLOVE_REMOVAL, 70)
    assert rule in prompts.double_check_prompt(GLOVE_SKILL, step, 0, 70, 70, whole_video=True)
    assert rule in prompts.double_check_prompt(GLOVE_SKILL, step, 0, 12, 70)
    assert rule not in prompts.double_check_prompt(GLOVE_SKILL, step, 20, 40, 70)
    assert "is performed, from 0 to when the next action begins" in \
        assess.assess_prompts.assess_prompt(GLOVE_SKILL, GLOVE_REMOVAL, 70)


# --- not_applicable: what code keeps ------------------------------------------------------
def test_a_not_needed_verdict_stands_only_for_a_conditional_step_that_was_not_done():
    rubric = conditional(GLOVE_REMOVAL, "s6")
    na = result("s6", NA, 0.8, evidence="The patient stood up unaided.")
    assert evaluate.settle_not_applicable(na, rubric.steps[5], performed=False) == na

    done_anyway = evaluate.settle_not_applicable(na, rubric.steps[5], performed=True)
    assert (done_anyway.status, done_anyway.confidence) == ("unverified", 0.0)  # graded on a second look
    assert "how well it was done was not judged" in done_anyway.evidence

    always = GLOVE_REMOVAL.steps[5]
    skipped = evaluate.settle_not_applicable(na, always, performed=False)
    assert skipped.status == "failed" and skipped.evidence_start_s is None
    assert skipped.feedback == '"Hand hygiene" is needed every time, and it was not done in this recording.'
    assert evaluate.settle_not_applicable(na, always, performed=True).status == "unverified"

    passed = result("s6", "passed")
    assert evaluate.settle_not_applicable(passed, always, performed=True) == passed


def test_build_evaluation_settles_not_applicable_from_the_reply(real_ai):  # noqa: F811
    rubric = conditional(GLOVE_REMOVAL, "s3")
    reply = grade_reply(steps=[
        judgement("s1"), judgement("s2"),
        judgement("s3", NA, 90, start=None, end=None),          # conditional, not done: kept
        judgement("s4", NA, 90, start=None, end=None),          # always needed, not done: failed
        judgement("s5", NA, 90, start=None, end=None, performed=True),  # done, called not needed
        judgement("s6"),
    ])
    out = evaluate.build_evaluation(reply, rubric, 70.0)
    assert [r.status for r in out.steps] == ["passed", "passed", NA, "failed", "unverified", "passed"]


def test_missing_result_for_a_conditional_step_is_unverified():
    rubric = conditional(GLOVE_REMOVAL, "s6")
    out = evaluate.build_evaluation(grade_reply(steps=[judgement(f"s{i}") for i in range(1, 6)]), rubric, 70.0)
    assert out.steps[5].status == "unverified"


# --- second looks ---------------------------------------------------------------------------
def test_a_confident_not_needed_step_gets_no_second_look():
    rubric = conditional(GLOVE_REMOVAL, "s4")  # s4 is critical
    assert not evaluate.needs_double_check(result("s4", NA, 0.9), rubric.steps[3])
    assert evaluate.needs_double_check(result("s4", NA, 0.5), rubric.steps[3])
    assert evaluate.pick_double_checks(rubric, ev(["passed", "passed", "passed", NA, "passed", "passed"])) == []


def test_a_clip_cannot_show_that_a_situation_never_came_up():
    before = result("s6", NA, 0.6)
    absent = result("s6", "failed", 0.95)  # failed on a clip without seeing anything of the step
    kept = evaluate.better_supported(before, absent, whole_video=False)
    assert kept.status == NA and kept.double_checked and "was not kept" in kept.evidence
    assert evaluate.better_supported(before, result("s6", "unverified", 0.95), False).status == NA
    seen_failing = result("s6", "failed", 0.95, start=30, end=34)  # done anyway, and done badly
    assert evaluate.better_supported(before, seen_failing, False).status == "failed"
    assert evaluate.better_supported(before, result("s6", "passed", 0.9, 30, 34), False).status == "passed"
    # A clip's own not_applicable is never kept, even over an unverified first look.
    assert evaluate.better_supported(result("s6", "unverified", 0.5), result("s6", NA, 0.9), False).status == \
        "unverified"
    # The whole video can show it.
    assert evaluate.better_supported(result("s6", "unverified", 0.5), result("s6", NA, 0.9), True).status == NA
    assert evaluate.better_supported(before, absent, whole_video=True).status == "failed"
    assert evaluate.better_supported(before, result("s6", NA, 0.9), False).status == NA


def test_a_low_confidence_not_needed_step_stays_not_needed_when_its_clip_shows_nothing(real_ai):  # noqa: F811
    rubric = conditional(GLOVE_REMOVAL, "s3")
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in (1, 2)]
                        + [judgement("s3", NA, 50, start=None, end=None)]
                        + [judgement(f"s{i}", "passed", 95) for i in (4, 5, 6)])
    clip_says = lambda step_id: judgement(step_id, "failed", 95, start=None, end=None)  # noqa: E731
    ctx = StubCtx(answer_with(reply, clip_says), duration=70.0)
    out = evaluate.run(ctx, rubric, GLOVE_TIMELINE)
    assert [c["purpose"] for c in ctx.calls if c["purpose"].startswith("evaluate_double_check")] == \
        ["evaluate_double_check:s3"]
    assert out.steps[2].status == NA and out.steps[2].double_checked


def test_a_clip_never_fails_an_always_needed_step_through_a_not_applicable_reply(real_ai):  # noqa: F811
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in range(1, 6)]
                        + [judgement("s6", "unverified", 50)])
    ctx = StubCtx(answer_with(reply, lambda step_id: judgement(step_id, NA, 95, start=None, end=None)),
                  duration=70.0)
    out = evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)  # s6 has no condition; its clip is partial
    assert out.steps[5].status == "unverified" and out.steps[5].double_checked


def test_the_rewritten_summary_reads_not_needed_in_plain_words(real_ai):  # noqa: F811
    rubric = conditional(GLOVE_REMOVAL, "s3")
    reply = grade_reply(steps=[judgement("s1", "passed", 40)] + [judgement(f"s{i}", "passed", 95) for i in (2,)]
                        + [judgement("s3", NA, 90, start=None, end=None, feedback="Not needed this time.")]
                        + [judgement(f"s{i}", "passed", 95) for i in (4, 5, 6)])
    ctx = StubCtx(answer_with(reply, lambda step_id: judgement(step_id, "failed", 90)), duration=70.0)
    sent = []
    ctx.generate_text = lambda purpose, parts, **kw: sent.append(parts[0]["text"]) or "Summary."
    evaluate.run(ctx, rubric, GLOVE_TIMELINE)
    [text] = sent
    assert "- Hold the removed glove in the gloved hand: not needed this time, so not counted." in text
    assert NA not in text


# --- the ends of the recording ----------------------------------------------------------------
STOPPED_AFTER_S3 = Timeline(steps=[
    TimelineStep(step_id="s1", found=True, start_s=5, end_s=12, confidence=0.8),
    TimelineStep(step_id="s2", found=True, start_s=12, end_s=17, confidence=0.8),
    TimelineStep(step_id="s3", found=True, start_s=17, end_s=23, confidence=0.8),
    *[TimelineStep(step_id=f"s{i}", found=False) for i in (4, 5, 6)],
])


def test_a_conditional_step_the_recording_stopped_before_stays_unverified_without_a_second_look(real_ai):  # noqa: F811
    rubric = conditional(conditional(GLOVE_REMOVAL, "s5"), "s6")
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in (1, 2, 3)]
                        + [judgement("s4", "unverified", 80, start=None, end=None),
                           judgement("s5", "unverified", 60, start=None, end=None),
                           judgement("s6", NA, 60, start=None, end=None)])
    ctx = StubCtx(answer_with(reply), duration=24.0)
    out = evaluate.run(ctx, rubric, STOPPED_AFTER_S3)
    assert [r.status for r in out.steps[3:]] == ["failed", "unverified", NA]
    assert not any(c["purpose"].startswith("evaluate_double_check") for c in ctx.calls)


# Glove removal recorded from part-way in: the first steps are on screen from the start.
STARTED_AT_S3 = Timeline(steps=[
    TimelineStep(step_id="s1", found=False), TimelineStep(step_id="s2", found=False),
    TimelineStep(step_id="s3", found=True, start_s=1, end_s=6, confidence=0.8),
    TimelineStep(step_id="s4", found=False),
    TimelineStep(step_id="s5", found=True, start_s=12, end_s=18, confidence=0.8),
    TimelineStep(step_id="s6", found=True, start_s=18, end_s=26, confidence=0.8),
])


def test_steps_before_the_recording_start():
    assert evaluate.steps_before_recording_start(GLOVE_REMOVAL, STARTED_AT_S3) == ["s1", "s2"]
    late = STARTED_AT_S3.model_copy(deep=True)
    late.steps[2].start_s = 9.0  # the recording shows 9 s of something else first: s1 and s2 were skipped
    assert evaluate.steps_before_recording_start(GLOVE_REMOVAL, late) == []
    assert evaluate.steps_before_recording_start(GLOVE_REMOVAL, GLOVE_TIMELINE) == []  # s1 was located
    nothing = Timeline(steps=[TimelineStep(step_id=s.step_id, found=False) for s in GLOVE_REMOVAL.steps])
    assert evaluate.steps_before_recording_start(GLOVE_REMOVAL, nothing) == []


def test_a_step_done_before_the_recording_began_is_unverified_not_failed(real_ai):  # noqa: F811
    reply = grade_reply(steps=[
        judgement("s1", "failed", 90, start=None, end=None),   # nothing of it seen: unverified
        judgement("s2", "failed", 90, start=0, end=1),         # seen at the start and failed: stays failed
        judgement("s3", "passed", 95, start=1, end=6),
        judgement("s4", "failed", 90, start=None, end=None),   # skipped part-way through: still failed
        judgement("s5", "passed", 95, start=12, end=18), judgement("s6", "passed", 95, start=18, end=26)])
    ctx = StubCtx(answer_with(reply, lambda step_id: judgement(step_id, "failed", 99)), duration=30.0)
    out = evaluate.run(ctx, GLOVE_REMOVAL, STARTED_AT_S3)
    s1 = out.steps[0]
    assert (s1.status, s1.confidence, s1.evidence_start_s) == ("unverified", 0.9, None)
    assert s1.feedback.endswith("Start recording before you begin.") and not s1.double_checked
    assert [r.status for r in out.steps[1:]] == ["failed", "passed", "failed", "passed", "passed"]
    checked = sorted(c["purpose"].split(":")[1] for c in ctx.calls if c["purpose"].startswith("evaluate_double_check"))
    assert checked == ["s2", "s4"]  # failed critical steps that were seen or could have been
    assert out.overall_feedback == "Rewritten summary."


def test_the_start_rule_leaves_a_recording_that_starts_with_something_else_alone():
    evaluation = ev(["failed", "passed", "passed", "passed", "passed", "passed"])
    timeline_ = STARTED_AT_S3.model_copy(deep=True)
    timeline_.steps[2].start_s = 9.0
    assert evaluate.apply_recording_start(GLOVE_REMOVAL, timeline_, evaluation, 30.0) == []
    assert evaluation.steps[0].status == "failed"


# --- scoring ---------------------------------------------------------------------------------------
def test_a_step_not_needed_is_left_out_of_the_score():
    rubric = conditional(GLOVE_REMOVAL, "s6")
    sc = scoring.score(rubric, GLOVE_TIMELINE, ev(["passed"] * 5 + [NA]), [])
    assert (sc.overall, sc.score_pct, sc.needs_nurse_review) == ("passed", 100.0, False)
    assert sc.reasons == ["All the steps that were needed met the criteria.",
                          "1 of 6 steps was not needed in this recording, so it was not counted."]
    half = scoring.score(rubric, GLOVE_TIMELINE, ev(["passed"] * 4 + ["unverified", NA]), [])
    assert half.score_pct == 90.0  # (4 + 0.5) / 5


def test_not_needed_steps_are_out_of_the_quarter_thresholds():
    rubric = GLOVE_REMOVAL.model_copy(deep=True)
    rubric.steps.extend(rubric.steps[2].model_copy(update={"step_id": f"s{i}", "order": i}) for i in (7, 8))
    # 8 steps, 2 not needed: 2 failed of the 6 that count is over a quarter (2 of 8 would not be).
    statuses = ["passed", "passed", "failed", "passed", "passed", "failed", NA, NA]
    sc = scoring.score(rubric, GLOVE_TIMELINE, ev(statuses), [])
    assert sc.overall == "failed"
    assert sc.reasons == ["2 of 6 steps were not done correctly.",
                          "2 of 8 steps were not needed in this recording, so they were not counted."]
    assert sc.score_pct == round(100 * 4 / 6, 1)


def test_a_critical_step_not_needed_goes_to_a_nurse_without_changing_the_result():
    sc = scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, ev([NA] + ["passed"] * 5), [])  # s1 is critical
    assert (sc.overall, sc.score_pct, sc.needs_nurse_review) == ("passed", 100.0, True)
    assert 'A critical step was judged not needed in this recording, for a nurse to confirm: ' \
           '"Pinch the first glove at the wrist".' in sc.reasons
    some = scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, ev([NA] + ["passed"] * 4 + ["failed"]), [])
    assert some.overall == "passed" and some.reasons[0].startswith("Every critical step that was needed met")


def test_every_step_not_needed_is_sent_to_a_nurse():
    sc = scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, ev([NA] * 6), [])
    assert (sc.overall, sc.score_pct, sc.needs_nurse_review) == ("unverified", 0.0, True)
    assert sc.reasons[0] == "No step was needed in this recording, so there was nothing to grade."
    flag = SafetyFlag(kind="patient_distress", severity="high", start_s=1, description="drops hard")
    assert scoring.score(GLOVE_REMOVAL, GLOVE_TIMELINE, ev([NA] * 6), [flag]).overall == "failed"


def test_a_not_needed_step_does_not_hide_an_order_problem():
    rubric = conditional(GLOVE_REMOVAL, "s2")  # s3 must follow s2, which must follow s1
    steps = [TimelineStep(step_id="s1", found=True, start_s=20, end_s=25, confidence=0.9),
             TimelineStep(step_id="s2", found=False),
             TimelineStep(step_id="s3", found=True, start_s=5, end_s=10, confidence=0.9),
             *[TimelineStep(step_id=f"s{i}", found=True, start_s=30 + i, end_s=31 + i, confidence=0.9)
               for i in (4, 5, 6)]]
    tl = timeline.build_timeline(rubric, steps, not_needed={"s2"})
    assert [(v.step_id, v.expected_after) for v in tl.order_violations] == [("s3", "s1")]
    assert tl.missing_step_ids == []
    assert tl.steps[1].note == "Not needed in this recording."
    assert timeline.build_timeline(rubric, steps).missing_step_ids == ["s2"]
    sc = scoring.score(rubric, tl, ev(["passed", NA, "passed", "passed", "passed", "passed"]), [])
    assert sc.overall == "failed" and sc.reasons[0].startswith("Steps out of order")


def test_timeline_knows_which_steps_were_not_needed(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "FAKE_AI", False)
    rubric = conditional(GLOVE_REMOVAL, "s4")
    items = [("s1", True, NA), ("s2", True, "passed"), ("s3", True, "passed"), ("s4", False, NA),
             ("s5", True, "passed"), ("s6", False, NA)]
    reply = assess.AssessReply(observed=[], people=[], skill_match=True, overall_feedback="", steps=[
        assess.StepAssessment(step_id=i, performed=done, start_s=5.0 * n if done else None,
                              end_s=5.0 * n + 4 if done else None, timing_confidence_pct=90, evidence="",
                              status=status, confidence_pct=90, feedback="", note="")
        for n, (i, done, status) in enumerate(items, start=1)])
    # s1 was done (so it is graded as usual) and s6 is always needed: only s4 was not needed.
    assert timeline.not_needed_from(rubric, reply) == {"s4"}

    class Ctx:
        duration = 60.0
        skill = GLOVE_SKILL

        def video_part(self, **kw):
            return {}

        def generate_json(self, *a, **kw):
            return reply

        def log(self, message):
            pass
    assert timeline.run(Ctx(), rubric).missing_step_ids == ["s6"]


# --- canned AI ----------------------------------------------------------------------------------------
def test_fake_ai_finds_a_conditional_step_not_needed():
    class Ctx:
        duration = 60.0
    rb = _fake.rubric(Ctx())
    rb.steps[3].applies_when = "The person is unsteady once standing."
    tl = _fake.timeline(Ctx(), rb)
    out = _fake.evaluation(Ctx(), rb, tl)
    assert [r.status for r in out.steps] == ["passed", "failed", "unverified", NA]
    assert not tl.steps[3].found and out.steps[3].evidence_start_s is None
    assert [t.found for t in tl.steps[:3]] == [True] * 3 and tl.order_violations  # the rest as before
    plain = _fake.rubric(Ctx())
    for step in plain.steps:  # the canned rubric's last step has a condition; without one it is graded as usual
        step.applies_when = ""
    assert _fake.timeline(Ctx(), plain).steps == _fake.timeline(Ctx(), plain).steps
    assert [r.status for r in _fake.evaluation(Ctx(), plain, _fake.timeline(Ctx(), plain)).steps] == \
        ["passed", "failed", "unverified", "passed"]


# --- stored and reviewed ------------------------------------------------------------------------------
def test_not_needed_is_stored_loaded_and_can_be_a_nurses_decision(migrated, sample_video):
    from fastapi.testclient import TestClient

    from app import jobs, repo
    from app.main import app

    ref = jobs.ingest(str(sample_video), "reference", sample_video.name)
    job_id = repo.create_job("reference", ref["id"])
    jobs.run_reference(job_id, slug="sit_to_stand", name="Sit to stand")
    skill_id = repo.get_job(job_id)["skill_id"]
    repo.patch_step(skill_id, "s4", {"applies_when": " The person is unsteady once standing. "})
    video = jobs.ingest(str(sample_video), "attempt", sample_video.name)
    attempt_id = repo.create_attempt(skill_id, video["id"], "Not needed test")
    jobs.run_attempt(repo.create_job("attempt", video["id"], skill_id=skill_id, attempt_id=attempt_id))

    loaded = repo.load_evaluation(attempt_id)
    assert [r.status for r in loaded.steps] == ["passed", "failed", "unverified", NA]
    assert repo.load_timeline(attempt_id).missing_step_ids == []
    attempt = repo.get_attempt(attempt_id)
    assert attempt["steps"][3]["applies_when"] == "The person is unsteady once standing."
    assert any("not needed in this recording" in r for r in attempt["reasons"])

    with TestClient(app) as client:
        body = {"overall": "unverified", "note": "",
                "steps": [{"step_id": "s2", "status": NA, "note": "Not needed for this patient."},
                          {"step_id": "s4", "status": "failed", "note": "The patient was unsteady."}]}
        res = client.post(f"/api/attempts/{attempt_id}/review", json=body)
        assert res.status_code == 200, res.text
        steps = {s["step_id"]: s for s in res.json()["steps"]}
        assert (steps["s2"]["nurse_status"], steps["s2"]["status"]) == (NA, "failed")
        assert (steps["s4"]["nurse_status"], steps["s4"]["status"]) == ("failed", NA)
        bad = dict(body, steps=[{"step_id": "s2", "status": "skipped"}])
        assert client.post(f"/api/attempts/{attempt_id}/review", json=bad).status_code == 422


@pytest.mark.parametrize("statuses", [["passed", NA], [NA, NA]])
def test_order_violation_reasons_are_unchanged_by_not_needed_steps(statuses):
    rubric = GLOVE_REMOVAL
    violation = OrderViolation(step_id="s2", expected_after="s1", message='"Peel" came before "Pinch".')
    sc = scoring.score(rubric, Timeline(steps=GLOVE_TIMELINE.steps, order_violations=[violation]),
                       ev(["passed"] * 4 + statuses), [])
    assert sc.reasons[0] == 'Steps out of order: "Peel" came before "Pinch".'


def test_an_unseen_step_before_the_recording_start_gets_no_second_look():
    evaluation = Evaluation(people=[], steps=[result("s1", "unverified", 0.5), result("s2", "unverified", 0.5, 0, 1),
                                              *[result(f"s{i}", "passed") for i in range(3, 7)]])
    assert evaluate.settled_by_recording_start(GLOVE_REMOVAL, STARTED_AT_S3, evaluation, 30.0) == {"s1"}
    assert evaluate.pick_double_checks(GLOVE_REMOVAL, evaluation, skip={"s1"}) == ["s2"]
