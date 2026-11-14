"""Nurse review of an attempt. Owned by branch feat/timeline.

POST /api/attempts/{id}/review   body: ReviewRequest {overall, note, steps:[{step_id, status, note}]}
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import repo
from ..models import ReviewRequest

router = APIRouter(prefix="/attempts", tags=["review"])


@router.post("/{attempt_id}/review")
def review_attempt(attempt_id: str, body: ReviewRequest):
    if not repo.get_attempt(attempt_id):
        raise HTTPException(404, "Attempt not found")
    repo.review_attempt(attempt_id, body.overall, body.note, [s.model_dump() for s in body.steps])
    return repo.get_attempt(attempt_id)
