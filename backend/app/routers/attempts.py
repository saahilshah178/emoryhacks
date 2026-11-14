"""Attempts and their results. Read by the caregiver result screens and the nurse review screens.

GET /api/attempts?skill_id=&caregiver_id=&state=   list, newest first
GET /api/attempts/{id}        attempt with steps (rubric joined to results), order_violations,
                              safety_flags, video, reference_video, job, final_status,
                              review_state and ai_assessment (see app/progress.py)

A nurse sees every attempt in their agency. A caregiver sees only their own.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException

from .. import auth, progress, repo

router = APIRouter(prefix="/attempts", tags=["attempts"])


@router.get("")
def list_attempts(skill_id: str | None = None, caregiver_id: str | None = None, state: str | None = None,
                  user: dict = Depends(auth.current_user)):
    if state and state not in progress.REVIEW_STATES:
        raise HTTPException(400, f"state must be one of: {', '.join(progress.REVIEW_STATES)}")
    for value in (skill_id, caregiver_id):
        if value:
            _uuid_or_404(value)
    if user["role"] == "caregiver":
        caregiver_id = str(user["id"])
    return repo.list_attempts(skill_id, org_id=user["org_id"], caregiver_id=caregiver_id, state=state)


@router.get("/{attempt_id}")
def get_attempt(attempt_id: str, user: dict = Depends(auth.current_user)):
    return repo.public(attempt_or_404(attempt_id, user))


def _uuid_or_404(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(404, "Not found") from None


def attempt_or_404(attempt_id: str, user: dict) -> dict:
    attempt = repo.get_attempt(_uuid_or_404(attempt_id))
    if not attempt or attempt["org_id"] != user["org_id"]:
        raise HTTPException(404, "Attempt not found")
    if user["role"] == "caregiver" and attempt["caregiver_id"] != user["id"]:
        raise HTTPException(404, "Attempt not found")
    return attempt
