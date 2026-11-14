"""Stage: timeline. Locate each rubric step in an attempt and check the order.
Owned by branch feat/timeline. Placeholder returns canned data."""
from __future__ import annotations

from ..models import Rubric, Timeline
from . import _fake


def run(ctx, rubric: Rubric) -> Timeline:
    return _fake.timeline(ctx, rubric)
