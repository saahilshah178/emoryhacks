"""Nurse review of an attempt.

POST /api/attempts/{id}/review   body: ReviewRequest {overall, note, steps:[{step_id, status, note}]}

overall "passed" approves the skill for that caregiver; "failed" or "unverified" asks for
retraining, which also gives the caregiver a fresh set of attempts (app/progress.py). A step's
status may also be "not_applicable" (not needed in this recording), for any step: the nurse
decides, whether or not the rubric gives the step an applies_when condition. The
nurse who decided is recorded on the attempt. Only an attempt that was sent to a nurse can be
reviewed (409 otherwise); an older submission the caregiver has since replaced still can.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, repo
from ..models import ReviewRequest
from .attempts import attempt_or_404

router = APIRouter(prefix="/attempts", tags=["review"])


@router.post("/{attempt_id}/review")
def review_attempt(attempt_id: str, body: ReviewRequest, user: dict = Depends(auth.nurse)):
    attempt = attempt_or_404(attempt_id, user)
    if not attempt["submitted_at"]:
        raise HTTPException(409, "The caregiver has not sent this recording for review yet, so there is "
                                 "nothing to decide on.")
    repo.review_attempt(attempt["id"], body.overall, body.note, [s.model_dump() for s in body.steps],
                        reviewed_by=user["id"])
    return repo.public(repo.get_attempt(attempt["id"]))
