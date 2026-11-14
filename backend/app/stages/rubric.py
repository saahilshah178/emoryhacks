"""Stage: rubric. Split a reference video into timestamped steps and write evals.
Owned by branch feat/rubric. Placeholder returns canned data."""
from __future__ import annotations

from ..models import Classification, Rubric
from . import _fake


def run(ctx, classification: Classification) -> Rubric:
    return _fake.rubric(ctx, classification)
