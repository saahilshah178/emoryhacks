"""Attempts and their results. Read by the caregiver result screens and the nurse review screens.

GET  /api/attempts?skill_id=&caregiver_id=&state=&all=   list, newest first
GET  /api/attempts/{id}         attempt with steps (rubric joined to results), order_violations,
                                safety_flags, video, reference_video, job, final_status,
                                review_state, ai_assessment, submitted_at, submit_kind,
                                submit_note, submission, policy, attempts {used, allowed, left}
                                and history (see app/progress.py)
POST /api/attempts/{id}/submit  body {force: false, note: ""}: the caregiver sends their attempt
                                to a nurse; returns the attempt

A caregiver sees only their own attempts, all of them. A nurse sees every attempt in their
agency, but a list holds only attempts sent to a nurse (pending, superseded, approved,
retraining, and anything uploaded by a nurse) unless ?all=1 asks for the caregivers' unsent
practice runs and failed recordings too. So ?state=pending is the queue: the latest waiting
submission of each caregiver for each skill. A nurse may open any one attempt by id.

Sending an attempt (rules in app/progress.py, submission):
  score at or above the skill's submit_pct   sent as "standard"
  between force_pct and submit_pct           only with force=true and a note of at least 10
                                             characters saying why the automatic check is wrong;
                                             sent as "forced"
  below force_pct, or not the skill          refused
Refusals are 409 with a sentence for the caregiver (422 for a note that is too short). Sending
an attempt that was already sent changes nothing and returns it. A newer submission makes the
caregiver's earlier unreviewed one "superseded".
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import auth, progress, repo

router = APIRouter(prefix="/attempts", tags=["attempts"])


class SubmitRequest(BaseModel):
    force: bool = False
    note: str = Field(default="", max_length=2000)


@router.get("")
def list_attempts(skill_id: str | None = None, caregiver_id: str | None = None, state: str | None = None,
                  all: bool = False, user: dict = Depends(auth.current_user)):
    if state and state not in progress.REVIEW_STATES:
        raise HTTPException(400, f"state must be one of: {', '.join(progress.REVIEW_STATES)}")
    for value in (skill_id, caregiver_id):
        if value:
            _uuid_or_404(value)
    if user["role"] == "caregiver":
        return repo.list_attempts(skill_id, org_id=user["org_id"], caregiver_id=str(user["id"]), state=state)
    return repo.list_attempts(skill_id, org_id=user["org_id"], caregiver_id=caregiver_id, state=state,
                              submitted_only=not all)


@router.get("/{attempt_id}")
def get_attempt(attempt_id: str, user: dict = Depends(auth.current_user)):
    return repo.public(attempt_or_404(attempt_id, user))


@router.post("/{attempt_id}/submit")
def submit_attempt(attempt_id: str, body: SubmitRequest | None = None, user: dict = Depends(auth.current_user)):
    body = body or SubmitRequest()
    if user["role"] != "caregiver":
        raise HTTPException(403, "Only the caregiver who recorded an attempt can send it for review.")
    attempt = attempt_or_404(attempt_id, user)
    if attempt["submitted_at"]:
        return repo.public(attempt)
    if attempt["skill_slug"] not in repo.assigned_slugs(user["org_id"], user["id"]):
        raise HTTPException(403, "This skill is no longer assigned to you, so its recordings cannot be sent.")
    sub = attempt["submission"]
    note = body.note.strip()
    if sub["can_submit"]:
        kind = "standard"
    elif sub["can_force"]:
        if not body.force:
            raise HTTPException(409, sub["reason"])
        if len(note) < progress.FORCE_NOTE_MIN:
            raise HTTPException(422, "Write a short note (at least 10 characters) saying why you think the "
                                     "automatic check got it wrong.")
        kind = "forced"
    else:
        raise HTTPException(409, sub["reason"])
    repo.submit_attempt(attempt["id"], kind, note)
    return repo.public(repo.get_attempt(attempt["id"]))


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
