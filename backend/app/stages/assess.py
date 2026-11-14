"""The one whole-video look at a caregiver's attempt.

Locating the steps (timeline) and grading them (evaluate) used to be two Gemini calls that
each sent the whole video. They are now one call: Gemini watches the attempt once and, for
every rubric step, says whether and when it happened and how well it was done, and lists
the people, whether the video shows the skill at all, and patient-safety problems.

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

from pydantic import BaseModel, Field

from .. import gemini
from ..models import FlagKind, PersonObs, Rubric, Severity, Status
from . import assess_prompts

DENSE_FPS = 2.0
MAX_FRAMES = 240
MIN_FPS = 0.5
MAX_OUTPUT_TOKENS = 9000   # thinking plus reply; a typical reply with thinking is 2,000 to 4,000
EXPECTED_OUTPUT_TOKENS = 3500


# Times are whole seconds: with float fields the model has been seen to emit a number with
# tens of thousands of digits, which costs a lot and fails to parse.
class Observed(BaseModel):
    start_s: int
    end_s: int
    action: str = Field(description="a few words")


class StepAssessment(BaseModel):
    """Where one rubric step happens and how it went. Times come before the verdict, and the
    evidence before the status, so the model describes first."""

    step_id: str
    performed: bool
    # No defaults, so the schema keeps them required; null says the step was not performed.
    start_s: int | None = Field(description="whole seconds from the start; null only when not performed")
    end_s: int | None = Field(description="whole seconds from the start; null only when not performed")
    timing_confidence_pct: int = Field(description="0 to 100: how sure you are it happened at that time")
    evidence: str = Field(description="one sentence: what was actually seen or heard")
    status: Status
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
            expect_output_tokens=EXPECTED_OUTPUT_TOKENS,
        )
    return cache[key]
