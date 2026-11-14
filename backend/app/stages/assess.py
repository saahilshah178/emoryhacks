"""The one whole-video look at a caregiver's attempt.

Locating the steps (timeline) and grading them (evaluate) used to be two Gemini calls that
each sent the whole video. They are now one call: Gemini watches the attempt once and, for
every rubric step, says whether and when it happened and how well it was done, and lists
the people, whether the video shows the skill at all, and patient-safety problems. The video
it watches has no sound, so the prompt grades by sight alone (see sight.py).

timeline.run and evaluate.run both call assess(), which makes that call once per context
and rubric and remembers the reply, so the stage contract (timeline -> Timeline,
evaluate -> Evaluation) is unchanged. When a job resumes between the two stages, the second
call is answered from the call log for free (gemini._replay).

Frames: 2 per second for attempts up to 2 minutes (step boundaries came within about half a
second of hand-labelled truth at that rate), then fewer so a long video costs at most about
MAX_FRAMES frames, never below MIN_FPS.
"""
from __future__ import annotations

import hashlib
from typing import Literal

from pydantic import BaseModel, Field

from .. import gemini
from ..models import NOT_APPLICABLE, FlagKind, PersonObs, Rubric, RubricStep, Severity, StepStatus
from . import assess_prompts

DENSE_FPS = 2.0
MAX_FRAMES = 240
MIN_FPS = 0.5
MAX_OUTPUT_TOKENS = 9000   # thinking plus reply; a typical reply with thinking is 2,000 to 4,000
EXPECTED_OUTPUT_TOKENS = 3500
# Request timeouts for the calls that grade a caregiver's attempt, so a request that hangs is
# retried in minutes rather than after the client's default of ten. The whole-video call
# normally answers in 17 to 26 s for a recording up to 90 s (frames are capped at MAX_FRAMES,
# so a longer one costs little more); clip and text calls in under 10 s. A timeout is retried
# like any network error (gemini._call). Reference-video calls keep the default.
WHOLE_VIDEO_TIMEOUT_S = 240.0
CLIP_TIMEOUT_S = 90.0
TEXT_TIMEOUT_S = 60.0

Situation = Literal["yes", "no", "cannot_tell"]


# Where a step happens is given to a tenth of a second, as the timeline pass did: in whole
# seconds the spans came out a few seconds early and overlapping on a 90 s fall response.
# Everything else is whole seconds: with float fields the grading pass has been seen to emit
# a number with tens of thousands of digits (the output cap bounds what that can cost).
class Observed(BaseModel):
    start_s: float
    end_s: float
    action: str = Field(description="a few words")


class StepAssessment(BaseModel):
    """Where one rubric step happens and how it went. Times come before the verdict, and the
    evidence before the status, so the model describes first."""

    step_id: str
    performed: bool
    # No defaults, so the schema keeps them required; null says the step was not performed.
    start_s: float | None = Field(description="seconds from the start, one decimal; null only when not performed")
    end_s: float | None = Field(description="seconds from the start, one decimal; null only when not performed")
    timing_confidence_pct: int = Field(description="0 to 100: how sure you are it happened at that time")
    # Asked before the status so it is answered first: code, not the model's choice of status,
    # decides a conditional step that was not done (conditional_status).
    situation_came_up: Situation | None = Field(
        description='only for a step with an "Only needed when" line: whether that situation is seen to come up; '
                    "null for every other step")
    evidence: str = Field(description="one sentence: what was actually seen")
    status: StepStatus
    confidence_pct: int = Field(description="0 to 100: how sure you are of the status")
    feedback: str = Field(description="one or two sentences to the caregiver")
    note: str = Field(description="a few words for the nurse when useful, else empty")


class FlagObservation(BaseModel):
    kind: FlagKind
    severity: Severity
    start_s: int = Field(description="whole seconds from the start of the video")
    end_s: int | None = Field(default=None, description="whole seconds from the start of the video")
    person_label: str | None = None
    description: str


class AssessReply(BaseModel):
    observed: list[Observed]
    people: list[PersonObs]
    skill_match: bool
    skill_match_note: str = Field(default="", description="what the video shows instead, when it is not this skill")
    steps: list[StepAssessment]
    safety_flags: list[FlagObservation] = Field(default_factory=list)
    overall_feedback: str


def sample_fps(duration: float) -> float:
    """Frames per second for the whole-video look: dense up to 2 minutes, then at most MAX_FRAMES."""
    if duration <= MAX_FRAMES / DENSE_FPS:
        return DENSE_FPS
    return round(max(MIN_FPS, MAX_FRAMES / duration), 2)


# The status of a step with an applies_when condition that the caregiver did not do, by
# whether its situation was seen to come up (StepAssessment.situation_came_up).
SITUATION_STATUS = {"no": NOT_APPLICABLE, "yes": "failed", "cannot_tell": "unverified"}


def conditional_status(step: RubricStep, status: str, performed: bool, situation: str | None) -> str:
    """The status code gives a step, from the model's status and its situation answer.

    A step with an applies_when condition that the caregiver did not do is settled by its
    situation alone, whatever status the model chose and whether or not the recording ended
    before it: not seen to come up -> not_applicable (not needed), seen -> failed, cannot
    tell -> unverified. Every other step (one with no condition, one that was performed, one
    with no situation answer) keeps the model's status."""
    if not step.applies_when.strip() or performed or situation not in SITUATION_STATUS:
        return status
    return SITUATION_STATUS[situation]


def not_needed(step: RubricStep, status: str, performed: bool, situation: str | None = None) -> bool:
    """Whether the step was not needed: only a step with an applies_when condition that the
    caregiver did not do (a step done anyway is graded as usual) can be. evaluate.settle_status
    replaces any other not_applicable verdict."""
    return (conditional_status(step, status, performed, situation) == NOT_APPLICABLE
            and bool(step.applies_when.strip()) and not performed)


def _key(rubric: Rubric) -> str:
    return hashlib.sha256(rubric.model_dump_json().encode()).hexdigest()[:16]


def assess(ctx, rubric: Rubric) -> AssessReply:
    """Locate and grade every step of rubric in ctx's video: one Gemini call per context and rubric."""
    cache = ctx.__dict__.setdefault("_assessments", {})
    key = _key(rubric)
    if key not in cache:
        duration = ctx.duration
        cache[key] = ctx.generate_json(
            "assess",
            [ctx.video_part(resolution="low", fps=sample_fps(duration)),
             gemini.text_part(assess_prompts.assess_prompt(ctx.skill or {}, rubric, duration))],
            AssessReply, model="main", thinking="medium", max_output_tokens=MAX_OUTPUT_TOKENS,
            expect_output_tokens=EXPECTED_OUTPUT_TOKENS, timeout=WHOLE_VIDEO_TIMEOUT_S,
        )
    return cache[key]
