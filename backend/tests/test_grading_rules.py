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
                                     situation_came_up=None,
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
    assert text.count("Only needed when") == 3  # the s6 block, and the rules that name the line
    rule = ("If not, it is not_applicable when the\n     situation does not come up (the evidence describes what "
            "shows it did not), failed when it\n     does, and unverified when you cannot tell.")
    assert rule in text
    assert "The recording ending before such a step is not\n     a failure" in text
    assert "situation_came_up,\n     answered before the status" in text
    assert "one plain sentence on why the step was not needed this time" in text
    whole = prompts.double_check_prompt(GLOVE_SKILL, rubric.steps[5], 0, 70, 70, whole_video=True)
    clip = prompts.double_check_prompt(GLOVE_SKILL, rubric.steps[5], 20, 40, 70)
    assert "- not_applicable is only for such a step." in whole and "not_applicable is only" not in clip
    assert "the clip cannot show whether that situation came up" in clip
    assert "situation_came_up is null: this clip cannot show" in clip and "situation_came_up is null" not in whole
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
    assert evaluate.settle_status(na, rubric.steps[5], performed=False) == na

    done_anyway = evaluate.settle_status(na, rubric.steps[5], performed=True)
    assert (done_anyway.status, done_anyway.confidence) == ("unverified", 0.0)  # graded on a second look
    assert "how well it was done was not judged" in done_anyway.evidence

    always = GLOVE_REMOVAL.steps[5]
    skipped = evaluate.settle_status(na, always, performed=False)
    assert skipped.status == "failed" and skipped.evidence_start_s is None
    assert skipped.feedback == '"Hand hygiene" is needed every time, and it was not done in this recording.'
    assert evaluate.settle_status(na, always, performed=True).status == "unverified"

    passed = result("s6", "passed")
    assert evaluate.settle_status(passed, always, performed=True) == passed


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
    unsure = result("s6", "unverified", 0.5)
    assert evaluate.better_supported(unsure, absent, False, conditional=True).status == "unverified"
    assert evaluate.better_supported(unsure, absent, False).status == "failed"  # always needed: as before
    assert evaluate.better_supported(unsure, absent, True, conditional=True).status == "failed"


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


# The start of a recording is the model's call (the prompt's start rule). On the real path a
# step the model reports as not performed has no evidence times whether or not it could be
# seen, so code has nothing to go on and never overrides the model's verdict there.
def _wheelchair_transfer():
    from app.models import Rubric, RubricStep, StepEval

    titles = ["Lock the wheelchair brakes", "Swing the footrests away", "Feet flat on the floor",
              "Put on the gait belt", "Stand in front of the patient", "Assist to stand", "Pivot to the bed",
              "Lower to sit on the bed"]
    ev_ = StepEval(pass_criteria=["seen"], fail_criteria=["not seen"], unverified_when=["out of frame"])
    return Rubric(order_matters=True, steps=[
        RubricStep(step_id=f"s{i}", order=i, title=t, description="", start_s=0, end_s=1, critical=i in (1, 6),
                   order_dependent=i > 1, must_follow=[f"s{i - 1}"] if i > 1 else [], evals=ev_)
        for i, t in enumerate(titles, start=1)])


def _graded_from_the_start(first: "StepJudgement", second=None):
    """Run the timeline and evaluate stages on one reply in the shape the real path produces:
    steps 2 to 8 located from 2 s on, step 1 as given."""
    from app import config

    rubric = _wheelchair_transfer()
    reply = grade_reply(steps=[first] + [judgement(f"s{i}", "passed", 95, start=2 * i - 2, end=2 * i - 1)
                                         for i in range(2, 9)])
    ctx = StubCtx(answer_with(reply, second or (lambda step_id: judgement(step_id, "failed", 90, None, None))),
                  duration=16.0)
    assert not config.FAKE_AI
    tl = timeline.run(ctx, rubric)
    return rubric, tl, evaluate.run(ctx, rubric, tl), ctx


def test_a_first_step_skipped_in_a_recording_that_starts_properly_stays_failed(real_ai):  # noqa: F811
    skipped = judgement("s1", "failed", 90, start=None, end=None)
    skipped.evidence = "The wheelchair brake levers stay up (unlocked) for the whole recording."
    # The second look's clip cannot see the brakes being locked either.
    rubric, tl, out, ctx = _graded_from_the_start(
        skipped, second=lambda step_id: judgement(step_id, "unverified", 90, start=None, end=None))
    assert not tl.steps[0].found and tl.steps[1].start_s == 2.0  # step 2 starts within seconds of 0
    brakes = out.steps[0]
    assert brakes.status == "failed" and brakes.evidence.startswith("The wheelchair brake levers stay up")
    assert "evaluate_double_check:s1" in [c["purpose"] for c in ctx.calls]  # failed and critical: a second look
    sc = scoring.score(rubric, tl, out, [])
    assert sc.overall == "failed"
    assert sc.reasons[0] == 'A critical step was not done correctly: "Lock the wheelchair brakes".'


def test_a_result_in_place_at_the_start_keeps_the_models_pass(real_ai):  # noqa: F811
    in_place = judgement("s1", "passed", 90, start=0, end=2)
    in_place.evidence = "The brakes are already locked when the recording begins."
    rubric, tl, out, _ = _graded_from_the_start(in_place)
    assert tl.steps[0].found and tl.steps[0].start_s == 0.0
    assert out.steps[0].status == "passed" and scoring.score(rubric, tl, out, []).overall == "passed"


def test_a_step_done_before_the_camera_was_on_is_what_the_model_said(real_ai):  # noqa: F811
    unseen = judgement("s1", "unverified", 90, start=None, end=None,
                       feedback="Start recording before you begin, so the brakes can be seen.")
    rubric, tl, out, ctx = _graded_from_the_start(unseen)
    assert out.steps[0].status == "unverified"
    assert out.steps[0].feedback == "Start recording before you begin, so the brakes can be seen."
    assert "evaluate_double_check:s1" not in [c["purpose"] for c in ctx.calls]  # it was sure it could not be seen


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
                              end_s=5.0 * n + 4 if done else None, timing_confidence_pct=90,
                              situation_came_up=None, evidence="",
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


# --- a conditional step is settled by whether its situation came up ------------------------------
CALL_BELL_WHEN = ("the patient looks hurt or cannot get up without help after being lowered, "
                  "or the caregiver cannot manage alone")


def _fall_response():
    """The standard fall-response rubric's shape: the call bell is only needed in some situations."""
    from app.models import Rubric, RubricStep, StepEval

    titles = ["Move to the patient and steady them", "Position yourself closely behind the patient",
              "Support torso under arms or at waist", "Place one leg under patient's buttocks",
              "Lower patient gently down your leg", "Stay with patient and check condition",
              "Use call bell to summon help"]
    ev_ = StepEval(pass_criteria=["seen"], fail_criteria=["not seen"], unverified_when=["out of frame"])
    return Rubric(order_matters=True, steps=[
        RubricStep(step_id=f"s{i}", order=i, title=t, description="", start_s=0, end_s=1, critical=2 < i < 7,
                   order_dependent=i > 2, must_follow=[f"s{i - 1}"] if i > 2 else [], evals=ev_,
                   applies_when=CALL_BELL_WHEN if i == 7 else "")
        for i, t in enumerate(titles, start=1)])


# A 12 s recording that starts part-way in: the patient is lowered and checked, then it ends.
FALL_12S = Timeline(steps=[
    TimelineStep(step_id="s1", found=False), TimelineStep(step_id="s2", found=False),
    TimelineStep(step_id="s3", found=True, start_s=0, end_s=2, confidence=0.8),
    TimelineStep(step_id="s4", found=True, start_s=2, end_s=4, confidence=0.8),
    TimelineStep(step_id="s5", found=True, start_s=4, end_s=8, confidence=0.8),
    TimelineStep(step_id="s6", found=True, start_s=8, end_s=12, confidence=0.8),
    TimelineStep(step_id="s7", found=False),
])


@pytest.mark.parametrize("evidence", [
    "The recording ends at 12 seconds with the caregiver still crouched behind the seated patient without "
    "reaching for a call bell or summoning help.",
    "The recording ends after the patient is lowered to the floor without the caregiver reaching for a call bell "
    "or summoning help.",
])
def test_a_call_bell_not_needed_is_not_failed_when_the_recording_ends(real_ai, evidence):  # noqa: F811
    """From real recordings: the patient ends seated on the floor, visibly fine, and the recording
    stops. The model failed the call bell under "the recording ends before it"."""
    rubric = _fall_response()
    bell = judgement("s7", "failed", 90, start=None, end=None, situation="no")
    bell = bell.model_copy(update={"evidence": evidence, "feedback": "You did not use the call bell."})
    reply = grade_reply(steps=[judgement("s1", "passed", 95, start=None, end=None, performed=False),
                               judgement("s2", "passed", 95, start=None, end=None, performed=False)]
                        + [judgement(f"s{i}", "passed", 95, start=2 * i - 6, end=2 * i - 4) for i in (3, 4, 5, 6)]
                        + [bell])
    ctx = StubCtx(answer_with(reply), duration=12.0)
    out = evaluate.run(ctx, rubric, FALL_12S)
    call_bell = out.steps[6]
    assert call_bell.status == NA and call_bell.evidence_start_s is None
    assert call_bell.feedback == ('Not needed this time: "Use call bell to summon help" is only needed when '
                                  f"{CALL_BELL_WHEN}, and that did not happen.")
    assert call_bell.evidence == evidence + " That situation was not seen to come up, so the step was not needed."
    assert not any(c["purpose"] == "evaluate_double_check:s7" for c in ctx.calls)
    sc = scoring.score(rubric, FALL_12S, out, [])
    assert "1 of 7 steps was not needed in this recording, so it was not counted." in sc.reasons
    assert not any("call bell" in r.lower() for r in sc.reasons)
    assert sc.score_pct == 100.0  # s1 and s2 passed (seen in place at the start), s3-s6 passed, s7 left out


def test_a_conditional_step_takes_its_status_from_its_situation():
    rubric = _fall_response()
    bell, first = rubric.steps[6], rubric.steps[0]
    for model_status in ("passed", "failed", "unverified", NA):
        assert assess.conditional_status(bell, model_status, False, "no") == NA
        assert assess.conditional_status(bell, model_status, False, "yes") == "failed"
        assert assess.conditional_status(bell, model_status, False, "cannot_tell") == "unverified"
        assert assess.conditional_status(bell, model_status, True, "no") == model_status  # done: graded as usual
        assert assess.conditional_status(bell, model_status, False, None) == model_status
        assert assess.conditional_status(first, model_status, False, "no") == model_status  # no condition
    assert assess.not_needed(bell, "failed", False, "no") and not assess.not_needed(bell, "failed", True, "no")
    assert not assess.not_needed(first, NA, False, "no")


def test_code_says_why_when_it_settles_a_conditional_step():
    rubric = _fall_response()
    bell = rubric.steps[6]
    failed = result("s7", "failed", 0.8, evidence="The caregiver does not reach for a bell.")
    needed = evaluate.settle_status(failed, bell, False, "yes")
    assert needed == failed  # already failed: the model's own words are kept
    seen = evaluate.settle_status(result("s7", NA, 0.8, evidence="The patient grimaces."), bell, False, "yes")
    assert seen.status == "failed" and seen.feedback == (
        f'"Use call bell to summon help" was needed this time, because {CALL_BELL_WHEN}, and it was not done.')
    unsure = evaluate.settle_status(failed, bell, False, "cannot_tell")
    assert unsure.status == "unverified"
    assert unsure.evidence.endswith("Whether that situation came up could not be told.")
    assert unsure.feedback == ('We could not tell from this recording whether "Use call bell to summon help" was '
                               "needed, so a nurse will check.")
    upper = bell.model_copy(update={"applies_when": "The patient is hurt."})
    assert evaluate.settled_feedback(upper, NA) == ('Not needed this time: "Use call bell to summon help" is only '
                                                    "needed when the patient is hurt, and that did not happen.")


def test_steps_every_attempt_must_show_are_as_strict_as_before(real_ai):  # noqa: F811
    # The model wrongly answers the situation for an unconditional step: it is ignored, and a
    # step the recording ends before is failed as it always was.
    rubric = _fall_response()
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95, start=2 * i, end=2 * i + 1) for i in (1, 2, 3, 4)]
                        + [judgement("s5", "unverified", 90, start=None, end=None, situation="no"),
                           judgement("s6", NA, 90, start=None, end=None, situation="no"),
                           judgement("s7", "passed", 90, start=None, end=None, situation="yes")])
    tl = Timeline(steps=[TimelineStep(step_id=f"s{i}", found=True, start_s=2 * i, end_s=2 * i + 1, confidence=0.8)
                         for i in (1, 2, 3, 4)] + [TimelineStep(step_id=f"s{i}", found=False) for i in (5, 6, 7)])
    out = evaluate.run(StubCtx(answer_with(reply), duration=10.0), rubric, tl)
    assert [r.status for r in out.steps[4:]] == ["failed", "failed", "failed"]
    assert out.steps[6].feedback.startswith('"Use call bell to summon help" was needed this time')
    sc = scoring.score(rubric, tl, out, [])
    assert sc.overall == "failed"  # the critical s5 and s6 were not done


def test_a_conditional_step_the_recording_ends_before_is_settled_by_its_situation(real_ai):  # noqa: F811
    rubric = _fall_response()
    tl = FALL_12S
    for situation, status in (("no", NA), ("yes", "failed"), ("cannot_tell", "unverified")):
        reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95, start=2 * i - 6, end=2 * i - 4)
                                   for i in range(3, 7)]
                            + [judgement(f"s{i}", "passed", 95, start=None, end=None, performed=False) for i in (1, 2)]
                            + [judgement("s7", "failed", 60, start=None, end=None, situation=situation)])
        ctx = StubCtx(answer_with(reply), duration=12.0)
        out = evaluate.run(ctx, rubric, tl)
        assert out.steps[6].status == status, situation
        # The end of the recording has nothing more to show, so none gets a second look.
        assert not any(c["purpose"] == "evaluate_double_check:s7" for c in ctx.calls), situation


def test_a_critical_conditional_step_not_needed_still_goes_to_a_nurse(real_ai):  # noqa: F811
    rubric = conditional(GLOVE_REMOVAL, "s4", "the caregiver touched something dirty")  # s4 is critical
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 95, start=5 * i, end=5 * i + 3) for i in (1, 2, 3, 5, 6)]
                        + [judgement("s4", "failed", 90, start=None, end=None, situation="no")])
    tl = Timeline(steps=[TimelineStep(step_id=f"s{i}", found=i != 4, start_s=5 * i if i != 4 else None,
                                      end_s=5 * i + 3 if i != 4 else None, confidence=0.8) for i in range(1, 7)])
    out = evaluate.run(StubCtx(answer_with(reply), duration=60.0), rubric, tl)
    assert out.steps[3].status == NA
    sc = scoring.score(rubric, tl, out, [])
    assert (sc.overall, sc.needs_nurse_review) == ("passed", True)
    assert any(r.startswith("A critical step was judged not needed") for r in sc.reasons)


def test_the_timeline_reads_the_situation_too():
    rubric = _fall_response()
    reply = assess.AssessReply(observed=[], people=[], skill_match=True, overall_feedback="", steps=[
        assess.StepAssessment(step_id="s7", performed=False, start_s=None, end_s=None, timing_confidence_pct=90,
                              situation_came_up=situation, evidence="", status="failed", confidence_pct=90,
                              feedback="", note="")
        for situation in ("no",)])
    assert timeline.not_needed_from(rubric, reply) == {"s7"}
    reply.steps[0].situation_came_up = "yes"
    assert timeline.not_needed_from(rubric, reply) == set()


def test_only_a_whole_video_second_look_settles_a_conditional_step_by_its_situation(real_ai):  # noqa: F811
    rubric = conditional(GLOVE_REMOVAL, "s3", "the caregiver drops the glove")
    first = grade_reply(steps=[judgement(f"s{i}", "passed", 95) for i in (1, 2)]
                        + [judgement("s3", "unverified", 40, start=None, end=None, situation="cannot_tell")]
                        + [judgement(f"s{i}", "passed", 95) for i in (4, 5, 6)])
    second = lambda step_id: judgement(step_id, "failed", 95, start=None, end=None, situation="no")  # noqa: E731
    # The located neighbours leave a gap, so the second look is a clip: its situation is ignored.
    out = evaluate.run(StubCtx(answer_with(first, second), duration=70.0), rubric, GLOVE_TIMELINE)
    # A clip that saw nothing of a conditional step cannot fail it: the first look stands.
    assert out.steps[2].status == "unverified" and out.steps[2].double_checked
    nothing = Timeline(steps=[TimelineStep(step_id=s.step_id, found=False) for s in rubric.steps])
    out = evaluate.run(StubCtx(answer_with(first, second), duration=70.0), rubric, nothing)  # the whole video
    assert out.steps[2].status == NA and out.steps[2].feedback.startswith("Not needed this time")


def test_canned_ai_says_why_a_step_was_not_needed():
    class Ctx:
        duration = 60.0
    rb = _fake.rubric(Ctx())
    out = _fake.evaluation(Ctx(), rb, _fake.timeline(Ctx(), rb))
    assert out.steps[3].status == NA
    assert out.steps[3].feedback == ('Not needed this time: "Steady the person" is only needed when the person '
                                     "sways or looks unsteady once standing, and that did not happen.")


# --- a step that can only be heard is not graded ---------------------------------------------------
def _with_heard_step(critical=False):
    """Glove removal with s3 replaced by a step that is only something said, as in a rubric
    written before grading went silent ("Ask about home stair railing")."""
    from app.models import StepEval

    rubric = GLOVE_REMOVAL.model_copy(deep=True)
    rubric.steps[2] = rubric.steps[2].model_copy(update={
        "title": "Ask about home stair railing", "description": "Ask whether the stairs at home have a railing.",
        "critical": critical,
        "evals": StepEval(pass_criteria=["The caregiver asks about the railing.", "The patient answers."],
                          fail_criteria=["No question is asked."], unverified_when=["No audio."],
                          visual_cues=["Caregiver talking"])})
    return rubric


def test_which_steps_can_only_be_heard():
    rubric = _with_heard_step()
    assert prompts.heard_only(rubric.steps[2])
    assert not prompts.heard_only(GLOVE_REMOVAL.steps[2])
    greet = SIT_TO_STAND.steps[0]  # "Greet and explain": its pass criterion is speech too
    assert prompts.heard_only(greet)
    # A title about speech with a criterion that can be seen is graded by that criterion.
    seen = greet.model_copy(deep=True)
    seen.evals.pass_criteria.append("The caregiver faces the patient within arm's reach.")
    assert not prompts.heard_only(seen)
    # Speech in the criteria only: still graded, by title and description.
    rise = SIT_TO_STAND.steps[5].model_copy(deep=True)
    rise.title = "Rise from the chair"
    assert not prompts.heard_only(rise)


def test_a_step_that_can_only_be_heard_is_left_out_and_said_so(real_ai):  # noqa: F811
    rubric = _with_heard_step(critical=True)
    prompt = assess.assess_prompts.assess_prompt(GLOVE_SKILL, rubric, 70)
    assert "Ask about home stair railing" not in prompt and "[s3]" not in prompt
    # Whatever the model says about it anyway, it is not graded.
    reply = grade_reply(steps=[judgement(f"s{i}", "failed" if i == 3 else "passed", 95, start=5 * i, end=5 * i + 3)
                               for i in range(1, 7)])
    ctx = StubCtx(answer_with(reply), duration=70.0)
    tl = timeline.run(ctx, rubric)
    out = evaluate.run(ctx, rubric, tl)
    s3 = out.steps[2]
    assert s3.status == NA and s3.evidence_start_s is None
    assert "about something said" in s3.evidence and "without sound" in s3.evidence
    assert "nurse will hear it" in s3.evidence
    assert s3.feedback == ("This step is about something you say. The automatic check watches without sound, so "
                           "the nurse will listen for it when they review your recording.")
    assert not tl.steps[2].found and tl.steps[2].note == prompts.HEARD_NOTE and "s3" not in tl.missing_step_ids
    assert not any(c["purpose"] == "evaluate_double_check:s3" for c in ctx.calls)
    sc = scoring.score(rubric, tl, out, [])
    assert (sc.overall, sc.score_pct, sc.needs_nurse_review) == ("passed", 100.0, True)
    assert sc.reasons == [
        "All the steps that were checked met the criteria.",
        'A critical step is about something said, which the automatic check does not listen for, so a nurse will '
        'check it: "Ask about home stair railing".',
        "1 of 6 steps is about something said, so it was not counted: the automatic check watches without sound, "
        "and a nurse will listen for it.",
    ]
    assert not any("not needed" in r for r in sc.reasons)


def test_a_step_that_can_only_be_heard_does_not_hide_an_order_problem():
    rubric = _with_heard_step()  # s4 must follow s3, which must follow s2
    steps = [TimelineStep(step_id=f"s{i}", found=i != 3, start_s={1: 1, 2: 20, 4: 5, 5: 30, 6: 40}.get(i),
                          end_s={1: 3, 2: 25, 4: 8, 5: 35, 6: 45}.get(i), confidence=0.9) for i in range(1, 7)]
    tl = timeline.build_timeline(rubric, steps, not_needed={"s3"})
    assert [(v.step_id, v.expected_after) for v in tl.order_violations] == [("s4", "s2")]


def test_scoring_tells_heard_steps_from_steps_not_needed():
    rubric = conditional(_with_heard_step(), "s6")
    sc = scoring.score(rubric, GLOVE_TIMELINE, ev(["passed", "passed", NA, "passed", "passed", NA]), [])
    assert sc.reasons[1:] == [
        "1 of 6 steps was not needed in this recording, so it was not counted.",
        "1 of 6 steps is about something said, so it was not counted: the automatic check watches without sound, "
        "and a nurse will listen for it.",
    ]
    only_heard = Evaluation(people=[], steps=[result("s3", NA)])
    lone = rubric.model_copy(update={"steps": [rubric.steps[2]]})
    assert scoring.score(lone, GLOVE_TIMELINE, only_heard, []).reasons == [
        "No step could be checked by sight, so there was nothing to grade."]


def test_the_rewritten_summary_says_a_heard_step_was_not_checked(real_ai):  # noqa: F811
    rubric = _with_heard_step()
    reply = grade_reply(steps=[judgement("s1", "passed", 40)]
                        + [judgement(f"s{i}", "passed", 95) for i in (2, 4, 5, 6)])
    ctx = StubCtx(answer_with(reply, lambda step_id: judgement(step_id, "failed", 90)), duration=70.0)
    sent = []
    ctx.generate_text = lambda purpose, parts, **kw: sent.append(parts[0]["text"]) or "Summary."
    evaluate.run(ctx, rubric, GLOVE_TIMELINE)
    [text] = sent
    assert ("- Ask about home stair railing: not checked, because it is about something said; a nurse will "
            "listen for it.") in text


def test_canned_ai_leaves_a_heard_step_out_like_the_real_grader():
    class Ctx:
        duration = 60.0
    rubric = _with_heard_step()
    tl = _fake.timeline(Ctx(), rubric)
    out = _fake.evaluation(Ctx(), rubric, tl)
    assert out.steps[2] == evaluate.heard_result(rubric.steps[2])
    assert not tl.steps[2].found and tl.steps[2].note == prompts.HEARD_NOTE


# --- a recording that does not show the skill leaves no step out --------------------------------------
def test_no_step_is_not_needed_when_the_video_shows_another_skill(real_ai):  # noqa: F811
    """From a real upload: glove removal sent as sit to stand. The conditional first step came back
    not needed "because no chair with armrests or patient is present in this recording"."""
    rubric = conditional(SIT_TO_STAND, "s2", "the chair has armrests")
    rubric.steps[0] = rubric.steps[0].model_copy(update={"title": "Face the patient"})  # not about speech
    armrests = judgement("s2", NA, 90, start=None, end=None, situation="no")
    armrests.evidence = ("This step was not needed here because no chair with armrests or patient is present in "
                         "this recording.")
    reply = grade_reply(skill_match=False, skill_match_note="The video shows a person removing gloves.",
                        steps=[armrests] + [judgement(f"s{i}", "failed", 95, start=None, end=None)
                                            for i in (1, 3, 4, 5, 6, 7)])
    ctx = StubCtx(answer_with(reply), duration=30.0)
    tl = timeline.run(ctx, rubric)
    out = evaluate.run(ctx, rubric, tl)
    assert [r.status for r in out.steps] == ["failed"] * 7
    assert out.steps[1].feedback == '"Hands on the armrests" was not seen, because this recording does not show ' \
                                    "this skill."
    assert "s2" in tl.missing_step_ids
    sc = scoring.score(rubric, tl, out, [])
    assert (sc.overall, sc.score_pct) == ("failed", 0.0)
    assert sc.reasons == ["The video does not appear to show this skill. The video shows a person removing gloves."]
    # A step that can only be heard is not left out either.
    heard = _with_heard_step()
    mismatch = grade_reply(skill_match=False, steps=[judgement(f"s{i}", "failed", 95, None, None) for i in range(1, 7)])
    assert evaluate.build_evaluation(mismatch, heard, 30.0).steps[2].status == "failed"


# --- timeouts --------------------------------------------------------------------------------------------
def test_each_call_that_grades_an_attempt_has_a_timeout_that_fits_it(real_ai):  # noqa: F811
    reply = grade_reply(steps=[judgement(f"s{i}", "passed", 40 if i == 1 else 95) for i in range(1, 7)])
    ctx = StubCtx(answer_with(reply, lambda step_id: judgement(step_id, "failed", 90)), duration=70.0)
    texts = []
    ctx.generate_text = lambda purpose, parts, **kw: texts.append(kw) or "Summary."
    evaluate.run(ctx, GLOVE_REMOVAL, GLOVE_TIMELINE)
    by_purpose = {c["purpose"]: c for c in ctx.calls}
    assert by_purpose["assess"]["timeout"] == assess.WHOLE_VIDEO_TIMEOUT_S == 240
    assert by_purpose["evaluate_double_check:s1"]["timeout"] == assess.CLIP_TIMEOUT_S == 90
    assert texts[0]["timeout"] == assess.TEXT_TIMEOUT_S == 60

    nothing = Timeline(steps=[TimelineStep(step_id=s.step_id, found=False) for s in GLOVE_REMOVAL.steps])
    ctx = StubCtx(answer_with(reply), duration=70.0)
    evaluate.run(ctx, GLOVE_REMOVAL, nothing)
    whole = next(c for c in ctx.calls if c["purpose"] == "evaluate_double_check:s1")
    assert whole["video"]["start_s"] == 0.0 and whole["timeout"] == assess.WHOLE_VIDEO_TIMEOUT_S

    flag = SafetyFlag(kind="patient_off_center", severity="high", start_s=10, end_s=12, description="leans",
                      source="pose", counts_toward_score=False)
    from app.stages.evaluate import FlagCheckReply

    ctx = StubCtx(lambda *a: FlagCheckReply(observed=False, description=""), duration=60.0)
    evaluate.confirm_pose_flags(ctx, GLOVE_REMOVAL, [flag])
    assert ctx.calls[0]["timeout"] == assess.CLIP_TIMEOUT_S


def test_the_refine_call_has_the_clip_timeout(monkeypatch):
    from app import config

    monkeypatch.setattr(config, "FAKE_AI", False)
    reply = assess.AssessReply(
        observed=[], people=[], skill_match=True, overall_feedback="",
        steps=[assess.StepAssessment(step_id="s1", performed=True, start_s=20, end_s=40, timing_confidence_pct=50,
                                     situation_came_up=None, evidence="", status="passed", confidence_pct=90,
                                     feedback="", note="")])
    calls = []

    class Ctx:
        duration = 300.0
        skill = GLOVE_SKILL

        def video_part(self, **kw):
            return {}

        def generate_json(self, purpose, parts, schema, **kw):
            calls.append((purpose, kw))
            return reply if purpose == "assess" else timeline._RefineReply(performed=False, start_s=0, end_s=0,
                                                                           confidence=0)

        def log(self, message):
            pass
    timeline.run(Ctx(), GLOVE_REMOVAL)
    assert dict(calls)["timeline_refine:s1"]["timeout"] == assess.CLIP_TIMEOUT_S


def test_a_request_that_times_out_is_retried(migrated, monkeypatch):
    """A hung request ends at its timeout and is tried again, not treated as a final failure."""
    import types

    import httpx
    from google.genai._gaos.lib.compat_errors import APITimeoutError

    from app import gemini

    calls = []

    def create(**body):
        calls.append(body)
        if len(calls) == 1:
            raise APITimeoutError(request=httpx.Request("POST", "https://example.invalid"))
        usage = types.SimpleNamespace(total_input_tokens=10, total_output_tokens=5, total_thought_tokens=5)
        return types.SimpleNamespace(status="completed", output_text="done", usage=usage)
    fake = types.SimpleNamespace(interactions=types.SimpleNamespace(create=create))
    monkeypatch.setattr(gemini, "client", lambda: fake)
    monkeypatch.setattr(gemini.time, "sleep", lambda s: None)
    assert gemini.generate_text("test_timeout", [gemini.text_part("hi")], timeout=60) == "done"
    assert [c["timeout"] for c in calls] == [60, 60]
