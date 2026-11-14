"""Prompt text for the timeline stage's refine pass. Kept apart from the logic so it can be
tuned alone. Where each step happens is asked in the whole-video prompt (assess_prompts.py).
The clip has no sound, like every look at a caregiver's recording, and cues that depend on
speech are left out before they reach here (timeline._refine)."""
from __future__ import annotations


def refine(title: str, description: str, cues: list[str], start_s: float, end_s: float,
           clip_start: float, clip_end: float) -> str:
    return f"""This is a clip from {clip_start:.0f} s to {clip_end:.0f} s of a recording of a caregiver practising
a care skill. It has no sound: go by what can be seen. Timestamps are seconds from the start of
the full recording, as plain numbers.

A first pass placed this step at roughly {start_s:.1f} s to {end_s:.1f} s:
"{title}": {description} Look for: {"; ".join(cues) or "none listed"}

Find the exact boundaries of this step within the clip. start_s is the first movement of the action itself;
end_s is when it is complete and the next action begins. If the step is not in this clip at all, set
performed to false."""
