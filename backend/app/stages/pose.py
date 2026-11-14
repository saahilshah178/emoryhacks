"""Stage: pose. Per-frame joint angles and balance readings into Tiger Data.
Owned by branch feat/pose-tiger. Placeholder writes synthetic data in fake AI mode
and nothing otherwise."""
from __future__ import annotations

from .. import config
from ..models import PersonObs, PoseSummary
from . import _fake


def extract(ctx) -> PoseSummary:
    if config.FAKE_AI:
        return _fake.pose(ctx)
    return PoseSummary(note="pose stage not implemented yet")


def assign_roles(ctx, people: list[PersonObs]) -> None:
    """Label pose tracks as caregiver/patient using the people Gemini identified."""
    return None
