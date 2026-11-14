"""Prompt text for the timeline stage. Kept apart from the logic so it can be tuned alone."""
from __future__ import annotations

from ..models import Rubric


def steps_block(rubric: Rubric) -> str:
    """The rubric steps as the model sees them: what to look for, never the reference timing."""
    lines = []
    for s in rubric.steps:
        cues = "; ".join(s.evals.visual_cues) or "none listed"
        lines.append(f"- {s.step_id}: {s.title}. {s.description} Look for: {cues}")
    return "\n".join(lines)


def locate(rubric: Rubric, duration: float) -> str:
    return f"""You are reviewing a recording of a caregiver practising a physical care skill, so that a nurse can
jump straight to each step. The recording is {duration:.1f} seconds long. Timestamps are seconds from the
start of the recording, as plain numbers (for example 12.5), between 0 and {duration:.1f}.

The skill has these steps (the order listed is the correct order; the caregiver may not follow it):
{steps_block(rubric)}

Work in two passes.
1. In "observed", describe in order what actually happens in the recording, one short entry per distinct
   action, with its start and end time. Use what you see and what you hear people say.
2. In "steps", give one entry for every step id above. performed is true only if that action clearly happens
   in this recording. start_s is when the action begins (the first movement or instruction for it) and
   end_s is when it is complete. Use the timing you observed in this recording only.

Rules:
- The people, room and camera angle may differ from any example of this skill. Judge the actions.
- Steps can be done in any order, skipped, or repeated. Report each step where it really happens, even if
  that is out of the listed order. If a step happens more than once, report its first complete performance
  and mention the repeat in note.
- Do not stretch a step to fill a gap, and do not mark a step performed because a related step was.
- If the recording does not show this skill at all, mark every step not performed.
- confidence is 0 to 1: how sure you are that the step happened at the time you gave.
- note: a few words for the nurse when useful (what you saw, why it was not found, or a repeat)."""


def refine(title: str, description: str, cues: list[str], start_s: float, end_s: float,
           clip_start: float, clip_end: float) -> str:
    return f"""This is a clip from {clip_start:.0f} s to {clip_end:.0f} s of a recording of a caregiver practising
a care skill. Timestamps are seconds from the start of the full recording, as plain numbers.

A first pass placed this step at roughly {start_s:.1f} s to {end_s:.1f} s:
"{title}": {description} Look for: {"; ".join(cues) or "none listed"}

Find the exact boundaries of this step within the clip. start_s is the first movement or spoken instruction
that belongs to it; end_s is when it is complete and the next action begins. If the step is not in this
clip at all, set performed to false."""
