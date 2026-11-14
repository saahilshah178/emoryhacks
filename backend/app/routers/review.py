"""Nurse review of an attempt.

POST /api/attempts/{id}/review   body: ReviewRequest {overall, note, steps:[{step_id, status, note}]}

overall "passed" approves the skill for that caregiver; "failed" or "unverified" asks for
retraining. The nurse who decided is recorded on the attempt.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import auth, repo
from ..models import ReviewRequest
from .attempts import attempt_or_404

router = APIRouter(prefix="/attempts", tags=["review"])


@router.post("/{attempt_id}/review")
def review_attempt(attempt_id: str, body: ReviewRequest, user: dict = Depends(auth.nurse)):
    attempt = attempt_or_404(attempt_id, user)
    repo.review_attempt(attempt["id"], body.overall, body.note, [s.model_dump() for s in body.steps],
                        reviewed_by=user["id"])
    return repo.public(repo.get_attempt(attempt["id"]))
