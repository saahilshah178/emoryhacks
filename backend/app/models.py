"""Shared data contracts.

Every AI stage returns one of these models and the pipeline runner persists it, so
these shapes are the interface between stages, the database and the frontend.

Conventions used everywhere:
  * times are float seconds from the start of the video
  * statuses are the lowercase strings "passed", "failed", "unverified"; one step of an
    attempt may also be "not_applicable" (see StepStatus)
  * step_id is a stable id ("s1", "s2", ...) assigned when the rubric is created;
    the timeline and evaluation stages must reuse those ids exactly
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Status = Literal["passed", "failed", "unverified"]
# The result of one step. "not_applicable" is only for a step that has an applies_when
# condition (RubricStep) when the situation it is for did not come up in the recording and the
# caregiver did not do it: the step was not needed, so it is left out of the score. An
# attempt's overall result is always a plain Status.
StepStatus = Literal["passed", "failed", "unverified", "not_applicable"]
NOT_APPLICABLE = "not_applicable"
Role = Literal["caregiver", "patient", "other"]
Severity = Literal["low", "medium", "high"]
FlagKind = Literal[
    "patient_distress",
    "patient_off_center",
    "patient_unsteady",
    "unsafe_caregiver_posture",
    "environment_hazard",
    "other",
]
FlagSource = Literal["gemini", "pose", "pose_confirmed"]


class PersonObs(BaseModel):
    """One person visible in a video."""

    label: str = Field(description="Short stable label such as P1, P2")
    role: Role
    description: str = Field(description="Visual description: clothing, position, what they do")


# --- nurse side -----------------------------------------------------------
class Classification(BaseModel):
    """Which maneuver a video shows (stage: classify)."""

    skill_slug: str = Field(description="snake_case id; a catalog slug when one fits")
    skill_name: str
    category: str = Field(description="transfer, mobility, positioning, hygiene, infection_control, emergency or other")
    confidence: float = Field(description="0 to 1")
    summary: str
    people: list[PersonObs]
    order_matters: bool
    alternatives: list[str] = Field(default_factory=list, description="other plausible slugs, best first")


class StepEval(BaseModel):
    """How to judge one step from video alone. Every item must be a visual cue."""

    pass_criteria: list[str]
    fail_criteria: list[str]
    unverified_when: list[str] = Field(description="conditions where the camera cannot show the step, so it must be unverified")
    visual_cues: list[str] = Field(default_factory=list, description="what to look for to locate the step")


class RubricStep(BaseModel):
    step_id: str
    order: int = Field(description="1-based position in the reference performance")
    title: str
    description: str
    start_s: float
    end_s: float
    critical: bool = Field(description="failing this step fails the whole skill")
    order_dependent: bool = Field(description="must be performed in sequence relative to must_follow")
    must_follow: list[str] = Field(default_factory=list, description="step_ids that must be completed before this one")
    # Empty for a step every attempt must show. Otherwise the situation the step is for, as a
    # condition that can be seen in a recording ("the patient cannot get up unaided after being
    # lowered"); when it does not come up and the step is not done, the step is not_applicable.
    applies_when: str = Field(default="", description="the visible situation this step is needed in; empty when it is always needed")
    evals: StepEval


class Rubric(BaseModel):
    """Timestamped steps and their evals for a skill (stage: rubric)."""

    steps: list[RubricStep]
    safety_criteria: list[str] = Field(default_factory=list, description="skill-level patient-safety points to watch")
    order_matters: bool = True
    notes: str = ""


# --- caregiver side -------------------------------------------------------
class TimelineStep(BaseModel):
    step_id: str
    found: bool
    start_s: float | None = None
    end_s: float | None = None
    performed_index: int | None = Field(default=None, description="1-based order in which the step was actually performed")
    confidence: float = 0.0
    note: str = ""


class OrderViolation(BaseModel):
    step_id: str = Field(description="the step that happened too early or too late")
    expected_after: str = Field(description="step_id that should have been completed first")
    message: str
    at_s: float | None = None


class Timeline(BaseModel):
    """Where each rubric step happens in an attempt (stage: timeline)."""

    steps: list[TimelineStep]
    order_violations: list[OrderViolation] = Field(default_factory=list)
    missing_step_ids: list[str] = Field(default_factory=list)


class StepResult(BaseModel):
    step_id: str
    status: StepStatus
    confidence: float = Field(description="0 to 1")
    feedback: str = Field(description="addressed to the caregiver")
    evidence: str = Field(default="", description="what was actually seen")
    evidence_start_s: float | None = None
    evidence_end_s: float | None = None
    double_checked: bool = False


class SafetyFlag(BaseModel):
    kind: FlagKind
    severity: Severity
    start_s: float
    end_s: float | None = None
    person_label: str | None = None
    description: str
    source: FlagSource = "gemini"
    counts_toward_score: bool = True


class Evaluation(BaseModel):
    """Per-step grading of an attempt (stage: evaluate)."""

    people: list[PersonObs]
    steps: list[StepResult]
    safety_flags: list[SafetyFlag] = Field(default_factory=list)
    overall_feedback: str = ""
    skill_match: bool = True
    skill_match_note: str = ""


class Score(BaseModel):
    overall: Status
    score_pct: float
    reasons: list[str]
    needs_nurse_review: bool


# --- pose -----------------------------------------------------------------
class PoseSummary(BaseModel):
    """Result of pose extraction (stage: pose). Frames go straight to Tiger."""

    frames_written: int = 0
    tracks: int = 0
    segments: int = 0
    sample_fps: float = 0.0
    candidate_flags: list[SafetyFlag] = Field(default_factory=list)
    note: str = ""


# --- API request bodies ---------------------------------------------------
class SkillPatch(BaseModel):
    name: str | None = None
    summary: str | None = None
    order_matters: bool | None = None
    safety_criteria: list[str] | None = None
    guide: dict | None = None


class StepPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    critical: bool | None = None
    order_dependent: bool | None = None
    must_follow: list[str] | None = None
    applies_when: str | None = None   # "" makes the step always needed again
    start_s: float | None = None
    end_s: float | None = None
    evals: StepEval | None = None


class StepReview(BaseModel):
    step_id: str
    status: StepStatus | None = None
    note: str = ""


class ReviewRequest(BaseModel):
    overall: Status | None = None
    note: str = ""
    steps: list[StepReview] = Field(default_factory=list)
