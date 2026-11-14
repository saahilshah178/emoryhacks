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
   Write the evidence first: what you actually saw or heard, with the time span.
   - passed: the pass criteria are observed and no fail criterion is.
   - failed: a fail criterion is observed, or the step was clearly never performed although
     the camera would have shown it.
   - unverified: one of the step's "unverified when" conditions holds, or the recording
     cannot settle it (out of frame, blocked from view, too dark, the video cuts away).
   Do not fail a step only because it was not located in the timeline below: look for it
   yourself, and use unverified when the camera could not have shown it.
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
   well and the one or two most important things to work on.
"""


def double_check_prompt(skill: dict, step: RubricStep, start_s: float, end_s: float, duration: float) -> str:
    """Instructions for a second, closer look at one step on its own clip."""
    return f"""\
You are a clinical skills assessor taking a careful second look at one step of a caregiver's
practice recording of "{skill.get('name', 'unknown')}". You are shown only the part of the
video from {start_s:.0f}s to {end_s:.0f}s, at a higher frame rate. Times you give are seconds
from the start of the whole {duration:.0f}-second video, so they fall between {start_s:.0f} and {end_s:.0f}.

{_GROUND_RULES.format(duration=duration)}
Grade only this step:
{_step_block(step)}

Watch frame by frame. Write the evidence first: what you actually saw or heard, with the time span.
- passed: the pass criteria are observed and no fail criterion is.
- failed: a fail criterion is observed, or the step was clearly never performed in this part
  although the camera would have shown it.
- unverified: an "unverified when" condition holds, or this clip cannot settle it.
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
