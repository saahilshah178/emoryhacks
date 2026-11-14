"""Prompt text for the whole-video look at an attempt (see assess.py). It joins what the
timeline prompt asked (where each step happens) and what the grading prompt asked (how
well, who is there, safety), so the video is sent once."""
from __future__ import annotations

from ..models import Rubric
from .evaluate_prompts import (
    _GROUND_RULES, _PURPOSE_RULE, _WHOLE_VIDEO_RULES, _bullet, _feedback_rule, _rules, _step_block, heard_only,
    sight_only,
)


def assess_prompt(skill: dict, rubric: Rubric, duration: float) -> str:
    # A step that can only be heard is not graded by the model (evaluate.heard_result).
    steps = [s for s in sorted(rubric.steps, key=lambda s: s.order) if not heard_only(s)]
    safety = ("\n".join(f"  - {c}" for c in sight_only(rubric.safety_criteria))
              or "  (none listed; use general patient safety)")
    return f"""\
You are a clinical skills assessor reviewing a caregiver's practice recording. A nurse will use
your answer to jump straight to each step and to see how it went.
The caregiver is practising the skill "{skill.get('name', 'unknown')}": {skill.get('summary', '')}
The recording is {duration:.0f} seconds long.

{_GROUND_RULES.format(duration=duration)}{_PURPOSE_RULE}
Work through these in order.

1. observed: what actually happens in the recording, in order, one entry per distinct action
   (a few words each) with its start and end time. Start a new entry whenever the caregiver
   moves on to a different action, even when it flows straight on from the last one.

2. people: every person you see, labelled P1, P2, ... Role "caregiver" is the trainee
   performing the skill, "patient" is whoever is being assisted (it may be a colleague or an
   actor playing the part), "other" is anyone else. There may be more than one of each, and a
   solo skill (for example glove removal) may have no patient. Describe each so a nurse can
   tell them apart: clothing, position, what they do.

3. skill_match: whether the recording shows the caregiver attempting this skill at all. If it
   shows something else, set it false and describe in skill_match_note what it shows instead.

4. steps: one entry for every step below, in the order given, exactly once, reusing its step id.
   Where it happens:
   - performed is true only if that action clearly happens in this recording. start_s is when
     the caregiver begins doing it (its first movement) and end_s is when it is complete; null
     for both when it is not performed or not needed. A step whose result is already in place
     when the recording begins is performed, from 0 to when the next action begins.
   - Steps can be done in any order, skipped, or repeated. Report each step where it really
     happens, even out of the listed order. If a step happens more than once, report its first
     complete performance and mention the repeat in note.
   - Give each step the span of its own action only. Where one step flows into the next, the
     first ends where the next begins, so the spans of different steps rarely overlap. Do not
     stretch a step to fill a gap, and do not mark a step performed because a related step
     was. If the recording does not show this skill at all, no step is performed.
   - The people, room and camera angle may differ from any example of this skill. Judge the actions.
   - timing_confidence_pct (0 to 100): how sure you are that it happened at the time you gave.
   How well it was done:
   - evidence: one sentence on what you actually saw, written before the status.
{_rules(_WHOLE_VIDEO_RULES, "   ")}
   - confidence_pct (0 to 100): how sure you are of the status.
{_rules(_bullet(_feedback_rule()), "   ")}
   - note: a few words for the nurse only when useful (a repeat, why a step was not found),
     otherwise empty. Refer to other steps by their title, never by their id.

Steps:
{chr(10).join(_step_block(s) for s in steps)}

5. safety_flags. Watch the patient throughout. Flag only what is actually seen, with its time
   span and the person's label:
   - patient_distress: visible signs such as grimacing, flinching, clutching a body part,
     pulling away or raising a hand to stop
   - patient_off_center: the patient off-centre, leaning to one side or sliding
   - patient_unsteady: unsteadiness, buckling knees or a near fall
   - unsafe_caregiver_posture: unsafe handling, such as pulling on arms or letting go mid-move
   - environment_hazard: hazards such as clutter, an unlocked wheelchair, a wet floor
   Severity: high = imminent risk of injury, medium = a concerning posture or instability,
   low = a minor point. Return an empty list when nothing is wrong.
   Judge against what this skill expects. When the skill is a response to the patient's
   instability (in a fall-response drill the patient losing balance and being lowered to the
   floor is the scenario), do not flag that instability itself; flag only what the caregiver's
   handling adds to it, such as the patient dropping hard, twisting or hitting their head.
   Skill-specific points to watch:
{safety}

6. overall_feedback: two or three encouraging, plain sentences to the caregiver: what went
   well and the one or two most important things to work on. If a step was done out of the
   listed order or you raised a medium or high safety flag, mention the most important of these.
"""
