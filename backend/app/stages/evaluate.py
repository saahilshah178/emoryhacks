"""Stage: evaluate. Grade each step of an attempt, identify the people, flag patient
safety problems, and double-check unclear steps.
Owned by branch feat/evaluate. Placeholder returns canned data."""
from __future__ import annotations

from ..models import Evaluation, Rubric, SafetyFlag, Timeline
from . import _fake


def run(ctx, rubric: Rubric, timeline: Timeline) -> Evaluation:
    return _fake.evaluation(ctx, rubric, timeline)


def confirm_pose_flags(ctx, rubric: Rubric, flags: list[SafetyFlag]) -> list[SafetyFlag]:
    """Ask Gemini to confirm pose-derived candidate flags on their clips.
    Confirmed flags come back with source="pose_confirmed" and counts_toward_score=True;
    the rest stay advisory. Placeholder leaves every flag advisory."""
    return flags
