"""Stage: classify. Decide which caregiving maneuver a video shows.
Owned by branch feat/classify. Placeholder returns canned data."""
from __future__ import annotations

from ..models import Classification
from . import _fake


def run(ctx) -> Classification:
    return _fake.classification(ctx)
