"""Prompt text for the rubric stage (see rubric.py for how the two passes fit together).

The rubric is written from an edited instructional video but is used to grade a plain,
single-take webcam recording of a caregiver. Every prompt therefore insists that steps
and criteria describe only what a person does, says or handles, never how the video
was produced.
"""
from __future__ import annotations

from .. import catalog
from ..models import Classification

_GRADING_TARGET = """\
How the rubric will be used: a caregiver will later film themselves performing this skill
with a single fixed webcam, in one continuous take, with sound, in an ordinary room. That
recording has no captions, no title cards, no narrator, no close-ups and no camera cuts,
and the caregiver and patient will be different people wearing different clothes. Each
step will be graded passed, failed or unverified from that recording alone. So every
title, description and criterion must describe what a person physically does, says, or
handles, and must be judgeable from such a recording. Never mention captions, on-screen
text, the narrator, the instructor's identity or clothing, the camera, close-ups or
editing. Spoken actions (explaining the procedure, asking about pain or dizziness,
counting "1, 2, 3") are allowed because the grader hears the audio."""


def skill_context(classification: Classification) -> str:
    """One paragraph naming the skill, with the catalog hint when the slug is known."""
    known = catalog.BY_SLUG.get(classification.skill_slug)
    lines = [f"The video demonstrates the caregiving skill: {classification.skill_name}"
             f" (category: {classification.category})."]
    if known:
        lines.append(f"This skill covers {known['hint']}.")
    if classification.summary and "placeholder" not in classification.summary.lower():
        lines.append(f"Summary of the video: {classification.summary}")
    return " ".join(lines)


def outline_prompt(classification: Classification, duration: float) -> str:
    """Pass 1: list the steps with rough times, evals, criticality and prerequisites."""
    return f"""\
You are a nursing educator turning a reference video into a grading rubric.

{skill_context(classification)}

The video is {duration:.0f} seconds long. It is an edited instructional video: it may
contain intro and outro cards, narration-only stretches, captions, camera cuts, close-ups,
advertising, demonstrations repeated from another angle, and "wrong way" demonstrations of
mistakes to avoid.

{_GRADING_TARGET}

Produce the rubric:

STEPS
- List the distinct actions of the maneuver in the order the demonstration performs them,
  usually 4 to 10 steps. A step is one thing the caregiver does (or says) that a grader
  can check, such as "Lock the wheelchair brakes" or "Ask the patient about dizziness".
- Give each safety-critical action (locking brakes, applying a gait belt, supporting the
  head) a step of its own: write "Lock the wheelchair brakes" as one step, never
  "Position the wheelchair, lock brakes and clear footrests". To stay within 10 steps,
  merge only routine preparation (hand hygiene, privacy, introductions) or routine
  finishing actions (call light, hand hygiene).
- Leave out intro and outro cards, narration over still images, talk about the product
  or channel, advertising, and anything not performed on screen.
- Leave out repeated demonstrations and "wrong way" demonstrations. A wrong-way
  demonstration is not a step, but use what it shows to write fail_criteria.
- If the whole procedure is shown more than once, take every timestamp from the one
  complete demonstration that shows each step most clearly, so the steps stay in order.
- title: short imperative phrase, at most 7 words. description: one sentence saying what
  the caregiver does and why.

TIMESTAMPS
- start_s and end_s are numeric seconds from the start of the video (0 to {duration:.0f}),
  marking where the demonstration performs this step: start_s when the caregiver begins
  the action, end_s when it is complete. Do not use mm:ss strings.

EVALS for each step, each item one short concrete sentence:
- pass_criteria: 2 to 4 things that must be observed for the step to pass (body
  positions, hand placement, objects used, words spoken).
- fail_criteria: 2 to 4 observable errors, including the unsafe ways to do the step.
- unverified_when: 1 to 3 situations in which a webcam recording cannot show whether
  the step was done (the relevant hands, feet, equipment or face are out of frame or
  blocked; for a spoken step, the recording has no audio or the speech is inaudible).
- visual_cues: 1 to 3 things that show where in a recording this step happens.

CRITICAL
- critical is true when doing the step wrong or skipping it could injure the patient or
  caregiver or defeats the purpose of the skill (locking brakes, securing a gait belt,
  never touching the outside of a used glove with bare skin, keeping the patient's head
  supported). Expect roughly a third to a half of steps to be critical. Courtesy and
  preparation steps are usually not critical.

PREREQUISITES
- prerequisites lists the numbers of the earlier steps that must be completed before
  this step for safety or correctness (for example "stand up" requires "lock the
  brakes"). List only direct, real dependencies and only earlier step numbers. Leave it
  empty for a step that could be done at any time (such as talking to the patient).

ALSO
- safety_criteria: 3 to 6 points about the patient's safety to watch for throughout the
  whole skill (the patient stays centred over their base of support, no signs of pain or
  distress, the caregiver keeps a straight back and wide stance, and so on).
- order_matters: true when performing the steps out of sequence would be unsafe or wrong.
- notes: one or two sentences on what you left out (intro, wrong-way demonstration...).
"""


def bounds_prompt(steps: list, clip: tuple[float, float], duration: float,
                  before: str | None, after: str | None) -> str:
    """Pass 2: pin the start and end of each listed step (draft steps with number, title,
    description, visual_cues and rough times) inside a clip sampled at a higher frame rate.
    before/after name the steps just outside the clip, to anchor the first and last boundary."""
    listed = "\n".join(
        f'  {s.number}. "{s.title}": {s.description} Cues: {"; ".join(s.visual_cues) or "none given"}. '
        f"Rough time {s.start_s:.0f}-{s.end_s:.0f} s."
        for s in steps
    )
    context = []
    if before:
        context.append(f'The step performed just before these is "{before}".')
    if after:
        context.append(f'The step performed just after these is "{after}".')
    return f"""\
This clip covers {clip[0]:.0f} to {clip[1]:.0f} seconds of a {duration:.0f}-second
instructional video demonstrating a caregiving skill. Timestamps in the clip are the
video's own timestamps, measured from the start of the full video.

These steps are performed in this clip, in this order. The rough times came from a quick
first look and may be off by several seconds:
{listed}
{" ".join(context)}

For each listed step, find exactly when it is performed. start_s is the moment the
caregiver begins the action (first movement toward it, or first words of it for a spoken
step). end_s is the moment it is complete, before the next step begins. If an action is
shown more than once, choose the main demonstration and ignore replays, close-up repeats
and "wrong way" demonstrations. Answer in numeric seconds from the start of the full
video, between {clip[0]:.0f} and {clip[1]:.0f}. Return one entry per listed step number;
set found to false for a step that is not performed in this clip.
"""
