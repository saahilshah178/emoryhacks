"""Attempts and their results. Read by the caregiver result screen and the nurse review screen.

GET /api/attempts?skill_id=   list
GET /api/attempts/{id}        attempt with steps (rubric joined to results), order_violations,
                              safety_flags, video, job and final_status
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from .. import repo

router = APIRouter(prefix="/attempts", tags=["attempts"])


@router.get("")
def list_attempts(skill_id: str | None = None):
    return repo.list_attempts(skill_id)


@router.get("/{attempt_id}")
def get_attempt(attempt_id: str):
    try:
        uuid.UUID(attempt_id)
    except ValueError:
        raise HTTPException(404, "Attempt not found") from None
    attempt = repo.get_attempt(attempt_id)
    if not attempt:
        raise HTTPException(404, "Attempt not found")
    return attempt
