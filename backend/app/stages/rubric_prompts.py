"""Prompt text for the rubric stage (see rubric.py for how the passes fit together).

The rubric is written from an edited instructional video with sound, but is used to grade
a plain, single-take webcam recording of a caregiver with its sound removed. Every prompt
therefore insists that steps and criteria describe only what a viewer can see a person do
or handle, never anything said or heard, and never how the video was produced.
"""
from __future__ import annotations

import json

from .. import catalog
from ..models import Classification

_GRADING_TARGET = """\
How the rubric will be used: a caregiver will later film themselves performing this skill
with a single fixed webcam, in one continuous take, in an ordinary room, and that recording
is graded WITHOUT SOUND. It has no captions, no title cards, no narrator, no close-ups and
no camera cuts, and the caregiver and patient will be different people wearing different
clothes. Each step will be graded from those silent pictures alone. So every title,
description, criterion, cue, condition and safety point must be something a viewer can
see: where people are, how their bodies move, what their hands do, what they handle. Never
mention captions, on-screen text, the narrator, the instructor's identity or clothing, the
camera, close-ups or editing.

Use the narration of this video to understand what is being demonstrated and why, and to
notice when a step is only sometimes needed, but never make anything said or heard into a
step or a criterion: nothing about asking, telling, explaining, greeting, instructing,
reassuring, counting aloud, calling out, or what can be heard. When the demonstration does
something by talking:
- if it has a visible counterpart, write only what is seen: the patient's hands on the
  armrests (not the instruction to hold them), the caregiver crouching to look at the
  patient's face (not asking how they feel), a hand placed on the patient's shoulder;
- if nothing about it can be seen (greeting, explaining the procedure, asking about pain),
  leave it out and say so in notes."""


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
  usually 4 to 10 steps. A step is one thing the caregiver visibly does that a grader can
  check with the sound off, such as "Lock the wheelchair brakes" or "Place the patient's
  feet flat under the knees".
- Give each safety-critical action (locking brakes, applying a gait belt, supporting the
  head) a step of its own: write "Lock the wheelchair brakes" as one step, never
  "Position the wheelchair, lock brakes and clear footrests". To stay within 10 steps,
  merge only routine preparation (hand hygiene, privacy curtain) or routine finishing
  actions (call light, hand hygiene).
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
- pass_criteria: 2 to 4 things that must be seen for the step to pass (body positions,
  hand placement, objects used, how the patient moves).
- fail_criteria: 2 to 4 visible errors, including the unsafe ways to do the step.
- unverified_when: 1 to 3 situations in which a webcam recording cannot show whether
  the step was done (the relevant hands, feet, equipment or face are out of frame or
  blocked). Never list the recording ending or stopping: a step the recording does not
  reach was not performed, and is failed.
- visual_cues: 1 to 3 things that show where in a recording this step happens.

CRITICAL
- critical is true when doing the step wrong or skipping it could injure the patient or
  caregiver or defeats the purpose of the skill (locking brakes, securing a gait belt,
  never touching the outside of a used glove with bare skin, keeping the patient's head
  supported). Expect roughly a third to a half of steps to be critical. Courtesy and
  preparation steps are usually not critical.

APPLIES_WHEN
- Leave applies_when empty for almost every step: empty means every attempt must show
  the step. A core action of the maneuver is never conditional, and a critical step
  almost never is. A wrongly conditional step lets a caregiver skip something that matters.
- Fill it only for a step that is needed depending on how things turn out (pressing the
  call bell after a fall is needed when the patient is hurt or cannot get up unaided), on
  equipment or a setting an ordinary practice room may not have (a call light, bed brakes,
  wheelchair footrests), or on something that may already be in place (non-skid footwear
  the patient may already be wearing). The narration often reveals this ("if she can't get
  up, call for help"), and then the step is conditional even though the demonstration
  performs it.
- Write the situation in which the step IS needed as one short clause that reads well
  after "Only needed when" and that can be seen in a silent recording: "the patient cannot
  get up unaided", "the wheelchair has footrests", "the patient is not wearing non-skid
  footwear". Never a condition about what anyone says, hears or feels.

PREREQUISITES
- prerequisites lists the numbers of the earlier steps that must be completed before
  this step for safety or correctness (for example "stand up" requires "lock the
  brakes"). List only direct, real dependencies and only earlier step numbers. Leave it
  empty for a step that could be done at any time (such as closing the privacy curtain).

ALSO
- safety_criteria: 3 to 6 points about the patient's safety that can be seen throughout
  the whole skill (the patient stays centred over their base of support, no grimacing or
  sagging at the knees, the caregiver keeps a straight back and wide stance, and so on).
- order_matters: true when performing the steps out of sequence would be unsafe or wrong.
- notes: one or two sentences on what you left out (intro, wrong-way demonstration,
  anything that was only said).
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
caregiver begins the action (first movement toward it). end_s is the moment it is
complete, before the next step begins. If an action is
shown more than once, choose the main demonstration and ignore replays, close-up repeats
and "wrong way" demonstrations. Answer in numeric seconds from the start of the full
video, between {clip[0]:.0f} and {clip[1]:.0f}. Return one entry per listed step number;
set found to false for a step that is not performed in this clip.
"""


def sight_prompt(skill_name: str, steps: list, pieces: list[dict]) -> str:
    """Repair pass: rewrite the pieces of a draft rubric that depend on speech. steps are the
    draft steps (for context); pieces are {id, where, text, words}, where says which step and
    field the text comes from."""
    listed = "\n".join(
        f'  {s.number}. "{s.title}": {s.description}'
        + (f" Only needed when {s.applies_when}." if s.applies_when.strip() else "")
        for s in steps
    )
    parts = "\n".join(
        f"  {p['id']}, {p['where']}, flagged {', '.join(p['words'])}: {json.dumps(p['text'])}"
        for p in pieces
    )
    return f"""\
You are a nursing educator fixing a grading rubric for the caregiving skill: {skill_name}.

Caregivers' recordings of this skill are graded with the sound removed, so every part of
the rubric must be something a viewer can see in a silent video. The parts listed below
depend on speech or sound; the flagged words show why.

The rubric's steps, for context:
{listed}

Parts to fix (id, where it is, flagged words, text):
{parts}

For each part, return its id with a rewrite that can be judged with the sound off, or with
empty text to delete it:
- When what is said has a visible counterpart, write that instead: the patient's hands on
  the armrests rather than the caregiver telling them to hold the armrests, the caregiver
  crouching to look at the patient's face rather than asking how they feel, the patient
  leaning forward and rising rather than a count of three.
- When nothing about it can be seen, return empty text.
- Keep the part's form: a title is a short imperative phrase of at most 7 words, a
  description or criterion is one short sentence, and a condition (applies_when) is one
  short clause that reads well after "Only needed when".
- A rewrite must not use the flagged words or any other word about speech or hearing
  (ask, tell, say, explain, instruct, cue, count, call out, hear, listen, words).

remove_steps: the numbers of the steps that are only something said, with nothing a viewer
could see (such as greeting the patient or explaining the procedure), and of steps whose
condition cannot be seen. Those steps are removed whole, so leave their parts out of fixes.
"""
