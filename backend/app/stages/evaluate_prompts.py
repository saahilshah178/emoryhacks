"""Prompt text for the evaluate stage. Kept apart from evaluate.py so the grading logic
reads cleanly and the wording can be tuned in one place."""
from __future__ import annotations

from ..models import Rubric, RubricStep, SafetyFlag, Timeline, TimelineStep

_GROUND_RULES = """\
Ground rules:
- Judge only what the people in the recording do and say. Ignore captions, on-screen text,
  graphics, title cards and camera work; a caregiver's real attempt is a plain single-take
  webcam recording without any of these.
- You can hear the audio. Speech counts as evidence (an explanation to the patient, a patient
  saying something hurts or that they feel dizzy).
- Give times as whole seconds from the start of the whole video, never past {duration:.0f}.
"""


# The status rules for a step seen across the whole recording. A step never performed is
# failed; unverified is only for a step that may have happened where it could not be seen.
_WHOLE_VIDEO_RULES = [
    "- passed: the pass criteria are observed and no fail criterion is.",
    "- failed: a fail criterion is observed, or the step was not performed in this attempt: the",
    "  caregiver moved on without doing it, or the recording ends before it.",
    "- unverified: only when the step may have been performed but the camera or microphone could",
    "  not show it (out of frame, blocked from view, too dark, inaudible). A step the recording",
    "  ends before is failed, not unverified, even if an \"unverified when\" condition mentions",
    "  the recording ending.",
]

# The status rules for a second look at part of the recording: the step may have happened
# outside the clip, so not seeing it here proves nothing.
_CLIP_RULES = [
    "- passed: the pass criteria are observed and no fail criterion is.",
    "- failed: a fail criterion is observed in this clip.",
    "- unverified: the step does not appear in this clip at all (it may have been done elsewhere",
    "  in the video), or it may have been performed but the camera or microphone could not show it",
    "  (out of frame, blocked from view, too dark, inaudible).",
]


def _rules(lines: list[str], indent: str = "") -> str:
    return "\n".join(indent + line for line in lines)


def _fmt_list(items: list[str]) -> str:
    return "; ".join(items) if items else "(none given)"


def _step_block(step: RubricStep) -> str:
    ev = step.evals
    return (
        f'[{step.step_id}] "{step.title}"{" (CRITICAL)" if step.critical else ""}\n'
        f"  What it is: {step.description}\n"
        f"  Passed when: {_fmt_list(ev.pass_criteria)}\n"
        f"  Failed when: {_fmt_list(ev.fail_criteria)}\n"
        f"  Unverified when: {_fmt_list(ev.unverified_when)}\n"
        f"  Look for: {_fmt_list(ev.visual_cues)}"
    )


def _timeline_line(step: RubricStep, t: TimelineStep | None) -> str:
    if t is None:
        return f"  [{step.step_id}] no timeline entry"
    if not t.found:
        return f"  [{step.step_id}] not located" + (f" ({t.note})" if t.note else "")
    where = f"{t.start_s or 0:.0f}s-{t.end_s or t.start_s or 0:.0f}s"
    order = f", performed {t.performed_index}th" if t.performed_index else ""
    return f"  [{step.step_id}] around {where}{order}" + (f" ({t.note})" if t.note else "")


def grade_prompt(skill: dict, rubric: Rubric, timeline: Timeline, duration: float) -> str:
    """Instructions for the first pass: grade every step, identify people, flag safety issues."""
    steps = sorted(rubric.steps, key=lambda s: s.order)
    by_id = {t.step_id: t for t in timeline.steps}
    violations = "\n".join(f"  - {v.message}" for v in timeline.order_violations) or "  (none)"
    safety = "\n".join(f"  - {c}" for c in rubric.safety_criteria) or "  (none listed; use general patient safety)"
    return f"""\
You are a clinical skills assessor reviewing a caregiver's practice recording.
The caregiver is practising the skill "{skill.get('name', 'unknown')}": {skill.get('summary', '')}
The video is {duration:.0f} seconds long.

{_GROUND_RULES.format(duration=duration)}
1. People. List every person you see, labelled P1, P2, ... Role "caregiver" is the trainee
   performing the skill, "patient" is whoever is being assisted (it may be a colleague or an
   actor playing the part), "other" is anyone else. There may be more than one of each, and a
   solo skill (for example glove removal) may have no patient. Describe each so a nurse can
   tell them apart: clothing, position, what they do.

2. Skill match. Say whether the recording shows the caregiver attempting this skill at all.
   If it shows something else, set skill_match false and say what it shows instead.

3. Steps. Grade every step below, in the order given, exactly once, reusing its step id.
   Write the evidence first: what you actually saw or heard. evidence_start_s and
   evidence_end_s are the span where you saw or heard the step; use null for both when the
   step is not seen at all.
{_rules(_WHOLE_VIDEO_RULES, "   ")}
   Do not fail a step only because it was not located in the timeline below: look for it
   yourself first.
   confidence_pct is 0 to 100: how sure you are of the status.
   feedback speaks to the caregiver as "you", in one or two plain, encouraging sentences:
   for a pass, what you did well; for a failure, what went wrong and what to do instead;
   for unverified, what could not be seen and how to record it so it can be.

Steps:
{chr(10).join(_step_block(s) for s in steps)}

Where an earlier pass located each step (a hint, it can be wrong):
{chr(10).join(_timeline_line(s, by_id.get(s.step_id)) for s in steps)}
Order problems found by that pass:
{violations}

4. Safety flags. Watch the patient throughout. Flag only what is actually seen or heard, with
   its time span and the person's label:
   - patient_distress: grimacing, crying out, saying it hurts or that they are dizzy
   - patient_off_center: the patient off-centre, leaning to one side or sliding
   - patient_unsteady: unsteadiness, buckling knees or a near fall
   - unsafe_caregiver_posture: unsafe handling, such as pulling on arms or letting go mid-move
   - environment_hazard: hazards such as clutter, an unlocked wheelchair, a wet floor
   Severity: high = imminent risk of injury, medium = a concerning posture or instability,
   low = a minor point. Return an empty list when nothing is wrong.
   Skill-specific points to watch:
{safety}

5. overall_feedback: two or three encouraging, plain sentences to the caregiver: what went
   well and the one or two most important things to work on. If a step was done out of
   order or you raised a medium or high safety flag, mention the most important of these.
"""


def double_check_prompt(skill: dict, step: RubricStep, start_s: float, end_s: float, duration: float,
                        whole_video: bool = False) -> str:
    """Instructions for a second, closer look at one step, on its own clip or on the whole video.
    Only a look at the whole video may fail a step for not being performed."""
    if whole_video:
        shown = (f"You are shown the whole {duration:.0f}-second video at a low frame rate, because an earlier "
                 "pass could not tell where this step happens. Times you give are seconds from the start.")
        rules = _rules(_WHOLE_VIDEO_RULES)
    else:
        shown = (f"You are shown only the part of the video from {start_s:.0f}s to {end_s:.0f}s, at a higher "
                 f"frame rate. Times you give are seconds from the start of the whole {duration:.0f}-second "
                 f"video, so they fall between {start_s:.0f} and {end_s:.0f}.")
        rules = _rules(_CLIP_RULES)
    return f"""\
You are a clinical skills assessor taking a careful second look at one step of a caregiver's
practice recording of "{skill.get('name', 'unknown')}". {shown}

{_GROUND_RULES.format(duration=duration)}
Grade only this step:
{_step_block(step)}

Watch closely. Write the evidence first: what you actually saw or heard. evidence_start_s and
evidence_end_s are the span where you saw or heard the step; use null for both when it is not seen.
{rules}
confidence_pct is 0 to 100. feedback speaks to the caregiver as "you", in one or two plain,
encouraging sentences: for a pass, what you did well; for a failure, what went wrong and what
to do instead; for unverified, what could not be seen and how to record it so it can be.
Reply with step_id "{step.step_id}".
"""


def confirm_flag_prompt(skill: dict, flag: SafetyFlag, start_s: float, end_s: float, duration: float,
                        safety_criteria: list[str]) -> str:
    """Instructions for checking one pose-derived candidate flag on its clip."""
    watch = "\n".join(f"- {c}" for c in safety_criteria) or "- general patient safety"
    return f"""\
A body-tracking system flagged a possible patient-safety problem in a caregiver's practice
recording of "{skill.get('name', 'unknown')}", around {flag.start_s:.0f}s{f' to {flag.end_s:.0f}s' if flag.end_s else ''}.
Its reading: {flag.description}
Body tracking is noisy, so this only counts if you can see it. You are shown the video from
{start_s:.0f}s to {end_s:.0f}s (times are seconds from the start of the whole {duration:.0f}-second video).

{_GROUND_RULES.format(duration=duration)}
Is a patient (the person being assisted, not the caregiver) visibly off balance, leaning,
off-centre, sliding, unsteady or in distress in this clip? Points to watch for this skill:
{watch}

Set observed true only if you clearly see or hear it; normal, controlled movement such as
leaning forward to stand up on cue is not a problem. If observed, give the kind, a severity
(high = imminent risk of injury, medium = a concerning posture or instability, low = a minor
point), the time span, and one sentence describing what you saw.
"""
