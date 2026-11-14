"""Prompt text for the evaluate stage. Kept apart from evaluate.py so the grading logic
reads cleanly and the wording can be tuned in one place.

A caregiver's recording is sent to Gemini without its sound (see sight.py for why), so every
prompt here grades by sight alone, and _step_block leaves out any criterion that depends on
speech before the model sees it."""
from __future__ import annotations

from ..models import RubricStep, SafetyFlag
from . import sight

CLIP_START_SLACK_S = 1.0   # a second-look clip starting this close to 0 starts where the recording does

_GROUND_RULES = """\
Ground rules:
- The recording has no sound. Judge only what the people in it can be seen to do.
  Never fail a step or mark it unverified for something only sound could show; judge every
  step by what can be seen.
- Ignore captions, on-screen text, graphics, title cards and camera work; a caregiver's real
  attempt is a plain single-take webcam recording without any of these.
- Give times as whole seconds from the start of the whole video, never past {duration:.0f}.
"""

# The criteria come from one demonstration video, so they can carry details of that video that
# do not matter. Only for the prompts that grade steps.
_PURPOSE_RULE = """\
- The criteria were written from one demonstration of this skill. What they describe must be
  achieved, but details incidental to that demonstration (which side or hand, the exact
  furniture or equipment, the people) are not requirements: an equally safe way of achieving
  the same thing passes. Nothing else is loosened: a fail criterion that is seen is still a
  failure.
"""

# Caregivers often start recording part-way in. A step before the first thing the recording
# shows is judged on its result when that is in view, and is unverified (not failed) when
# nothing of it can be seen. This is the model's call alone: a step failed as not done has no
# evidence times whether or not it could be seen, so code has nothing to tell them apart by.
_START_RULES = [
    "- A step that comes before the first thing the recording shows: if its result is already in",
    "  place when the recording begins (the caregiver is already holding the patient the way the",
    "  step requires, the gloves are already on), judge the step on that result; it passes when",
    "  what can be seen meets the step's purpose, and is not failed because the movement into",
    "  that position happened before the recording began. If neither the action nor its result",
    "  can be seen (hand hygiene done before the camera was on), it is unverified, not failed,",
    "  and the feedback tells the caregiver to start recording before they begin. This is only",
    "  about the start: a step skipped later on is still failed.",
]

# A step with an "Only needed when" line may not have been needed in this attempt. The model
# answers situation_came_up first; for such a step that was not done, code sets the status
# from that answer (assess.conditional_status), so the rules here and the code agree.
_NOT_NEEDED_RULES = [
    "- A step with an \"Only needed when\" line depends on that situation. situation_came_up,",
    "  answered before the status, is whether it is seen to come up in the recording: \"yes\",",
    "  \"no\", or \"cannot_tell\" when what is shown cannot settle it; null for every other step.",
    "  If the caregiver does such a step, grade it as usual. If not, it is not_applicable when the",
    "  situation does not come up (the evidence describes what shows it did not), failed when it",
    "  does, and unverified when you cannot tell. The recording ending before such a step is not",
    "  a failure: what matters is whether its situation had come up by then.",
    "- not_applicable is only for such a step.",
]

# The status rules for a step seen across the whole recording. A step never performed is
# failed; unverified is only for a step that may have happened where it could not be seen.
_WHOLE_VIDEO_RULES = [
    "- passed: the pass criteria are observed and no fail criterion is.",
    "- failed: a fail criterion is observed, or the step was not performed in this attempt: the",
    "  caregiver moved on without doing it, or the recording ends before it. Not doing a step is",
    "  a failure only for a step every attempt must show; one with an \"Only needed when\" line",
    "  follows the rule below.",
    "- unverified: when the step may have been performed but the camera could not show it",
    "  (out of frame, blocked from view, too dark). A step every attempt must show that the",
    "  recording ends before is failed, not unverified, even if an \"unverified when\" condition",
    "  mentions the recording ending.",
    *_NOT_NEEDED_RULES,
    *_START_RULES,
]

# The status rules for a second look at part of the recording: the step may have happened
# outside the clip, so not seeing it here proves nothing, and neither can the clip show that a
# situation never came up.
_CLIP_RULES = [
    "- passed: the pass criteria are observed and no fail criterion is.",
    "- failed: a fail criterion is observed in this clip.",
    "- unverified: the step does not appear in this clip at all (it may have been done elsewhere",
    "  in the video), or it may have been performed but the camera could not show it (out of",
    "  frame, blocked from view, too dark). This includes a step with an \"Only needed when\"",
    "  line that is not done in this clip: the clip cannot show whether that situation came up.",
]

def _feedback_rule(not_needed: bool = True) -> list[str]:
    """The feedback instructions; not_needed adds the not_applicable case (not on a partial clip)."""
    return [
        "feedback is to the caregiver as \"you\", in one or two plain, encouraging sentences:",
        "for a pass, what you did well; for a failure, what went wrong and what to do instead;",
        "for unverified, what could not be seen and how to record it so it can be"
        + ("; for" if not_needed else "."),
        *(["not_applicable, one plain sentence on why the step was not needed this time."] if not_needed else []),
    ]


def _rules(lines: list[str], indent: str = "") -> str:
    return "\n".join(indent + line for line in lines)


def _bullet(lines: list[str]) -> list[str]:
    """lines as one bullet point: "- " before the first, the rest indented to match."""
    return ["- " + lines[0], *("  " + line for line in lines[1:])]


def _fmt_list(items: list[str]) -> str:
    return "; ".join(items) if items else "(none given)"


def sight_only(items: list[str]) -> list[str]:
    """The items that can be judged by sight: any that sight.spoken_words finds speech in are
    left out, so a rubric written before grading went silent never asks the model to listen."""
    return [t for t in items if not sight.spoken_words(t)]


# The timeline note for a step that can only be heard: it was not looked for.
HEARD_NOTE = "Not checked: this step is about something said, and the check watches without sound."


def heard_only(step: RubricStep) -> bool:
    """A step the check cannot see: its title depends on speech and none of its pass criteria
    can be judged by sight ("Ask about home stair railing" in a rubric written before grading
    went silent, or typed in by a nurse). Such a step is never sent to the model; it is left
    out of the score for a nurse to hear (evaluate.heard_result)."""
    return bool(sight.spoken_words(step.title)) and not sight_only(step.evals.pass_criteria)


def _step_block(step: RubricStep) -> str:
    ev = step.evals
    passes = sight_only(ev.pass_criteria)
    when = step.applies_when.strip()
    return (
        f'[{step.step_id}] "{step.title}"{" (CRITICAL)" if step.critical else ""}\n'
        f"  What it is: {step.description}\n"
        + (f"  Only needed when: {when}\n" if when else "")
        + f"  Passed when: {_fmt_list(passes) if passes else 'what the step describes can be seen to be done.'}\n"
        f"  Failed when: {_fmt_list(sight_only(ev.fail_criteria))}\n"
        f"  Unverified when: {_fmt_list(sight_only(ev.unverified_when))}\n"
        f"  Look for: {_fmt_list(sight_only(ev.visual_cues))}"
    )


def double_check_prompt(skill: dict, step: RubricStep, start_s: float, end_s: float, duration: float,
                        whole_video: bool = False) -> str:
    """Instructions for a second, closer look at one step, on its own clip or on the whole video.
    Only a look at the whole video may fail a step for not being performed, or find that a
    step was not needed."""
    if whole_video:
        shown = (f"You are shown the whole {duration:.0f}-second video at a low frame rate, because an earlier "
                 "pass could not tell where this step happens. Times you give are seconds from the start.")
        rules = _rules(_WHOLE_VIDEO_RULES)
    else:
        shown = (f"You are shown only the part of the video from {start_s:.0f}s to {end_s:.0f}s, at a higher "
                 f"frame rate. Times you give are seconds from the start of the whole {duration:.0f}-second "
                 f"video, so they fall between {start_s:.0f} and {end_s:.0f}.")
        # The rule for a step done before the recording began only fits a clip that starts
        # where the recording does; mid-video it would read as "before this clip".
        rules = _rules(_CLIP_RULES + (_START_RULES if start_s <= CLIP_START_SLACK_S else []))
    # A clip cannot show whether a situation came up, so only the whole video answers it.
    situation = "" if whole_video else "\nsituation_came_up is null: this clip cannot show whether a situation came up."
    return f"""\
You are a clinical skills assessor taking a careful second look at one step of a caregiver's
practice recording of "{skill.get('name', 'unknown')}". {shown}

{_GROUND_RULES.format(duration=duration)}{_PURPOSE_RULE}
Grade only this step:
{_step_block(step)}

Watch closely. performed is true only if the caregiver does this step in what you are shown.{situation}
Write the evidence first: what you actually saw. evidence_start_s and evidence_end_s are the
span where you saw the step; use null for both when it is not seen or not needed.
{rules}
confidence_pct is 0 to 100.
{_rules(_feedback_rule(whole_video))}
Reply with step_id "{step.step_id}".
"""


def confirm_flag_prompt(skill: dict, flag: SafetyFlag, start_s: float, end_s: float, duration: float,
                        safety_criteria: list[str]) -> str:
    """Instructions for checking one pose-derived candidate flag on its clip."""
    watch = "\n".join(f"- {c}" for c in sight_only(safety_criteria)) or "- general patient safety"
    return f"""\
A body-tracking system flagged a possible patient-safety problem in a caregiver's practice
recording of "{skill.get('name', 'unknown')}", around {flag.start_s:.0f}s{f' to {flag.end_s:.0f}s' if flag.end_s else ''}.
Its reading: {flag.description}
Body tracking is noisy, so this only counts if you can see it. You are shown the video from
{start_s:.0f}s to {end_s:.0f}s (times are seconds from the start of the whole {duration:.0f}-second video).

{_GROUND_RULES.format(duration=duration)}
Is a patient (the person being assisted, not the caregiver) visibly off balance, leaning,
off-centre, sliding, unsteady or in distress (grimacing, flinching, clutching a body part,
pulling away) in this clip? Points to watch for this skill:
{watch}

Set observed true only if you clearly see it; normal, controlled movement such as leaning
forward to stand up is not a problem, and neither is the loss of balance a drill is about (in
a fall-response drill the patient is meant to start falling) unless the caregiver's handling
makes it worse. If observed, give the kind, a severity
(high = imminent risk of injury, medium = a concerning posture or instability, low = a minor
point), the time span, and one sentence describing what you saw.
"""
