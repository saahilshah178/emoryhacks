"""What an attempt means for a nurse's queue and for a caregiver's progress.

Stored facts are the AI result (attempts.status), the nurse's decision (nurse_status,
reviewed_at), the safety flags and the pipeline job. Everything a screen shows as a state
is derived from those here, so the nurse dashboard and the caregiver portal cannot disagree.

review_state of an attempt
  processing  the pipeline is still running
  error       the pipeline failed, so there is nothing to review
  pending     graded and waiting for a nurse (the AI never certifies on its own)
  approved    a nurse reviewed it and the final result is passed
  retraining  a nurse reviewed it and the final result is not passed

ai_assessment of an attempt (None until it is graded)
  passed          the AI found every criterion met
  needs_review    the AI could not verify enough of it
  not_passed      the AI found failed steps, with no safety concern
  safety_concern  the AI failed it and raised a safety flag that counts

state of a skill for one caregiver, from all their attempts at it (any version)
  verified        the nurse's most recent decision was an approval
  in_review       there is an attempt newer than the last decision that is pending or processing
  needs_practice  the nurse's most recent decision asked for retraining, and nothing newer is waiting
  not_started     no attempt that counts
"""
from __future__ import annotations

from typing import Iterable

REVIEW_STATES = ("processing", "error", "pending", "approved", "retraining")
SKILL_STATES = ("not_started", "in_review", "needs_practice", "verified")


def review_state(row: dict) -> str:
    """row needs job_status, reviewed_at, status and nurse_status."""
    if row.get("reviewed_at"):
        return "approved" if (row.get("nurse_status") or row.get("status")) == "passed" else "retraining"
    job = row.get("job_status")
    if job in ("queued", "running"):
        return "processing"
    if job == "error" or row.get("status") is None:
        return "error"
    return "pending"


def ai_assessment(row: dict) -> str | None:
    """row needs status and flag_count (flags that count toward the score)."""
    status = row.get("status")
    if status is None:
        return None
    if status == "passed":
        return "passed"
    if status == "unverified":
        return "needs_review"
    return "safety_concern" if (row.get("flag_count") or 0) > 0 else "not_passed"


def describe(row: dict) -> dict:
    """Add review_state, ai_assessment and final_status to an attempt row, in place."""
    row["review_state"] = review_state(row)
    row["ai_assessment"] = ai_assessment(row)
    row["final_status"] = row.get("nurse_status") or row.get("status")
    return row


def skill_state(attempts: Iterable[dict]) -> dict:
    """The caregiver's standing on one skill. attempts: described rows, oldest first.

    Returns state, attempt_id (the attempt whose result page says why: the approval, the
    attempt waiting for a nurse, or the retraining decision), latest_attempt_id and attempts."""
    rows = list(attempts)
    decided = [a for a in rows if a["review_state"] in ("approved", "retraining")]
    last = max(decided, key=lambda a: a["reviewed_at"]) if decided else None
    latest_id = rows[-1]["id"] if rows else None
    if last and last["review_state"] == "approved":
        return {"state": "verified", "attempt_id": last["id"], "latest_attempt_id": latest_id, "attempts": len(rows)}
    since = [a for a in rows if not last or a["created_at"] > last["created_at"]]
    waiting = [a for a in since if a["review_state"] in ("pending", "processing")]
    if waiting:
        return {"state": "in_review", "attempt_id": waiting[-1]["id"], "latest_attempt_id": latest_id,
                "attempts": len(rows)}
    if last:
        return {"state": "needs_practice", "attempt_id": last["id"], "latest_attempt_id": latest_id,
                "attempts": len(rows)}
    return {"state": "not_started", "attempt_id": latest_id, "latest_attempt_id": latest_id, "attempts": len(rows)}
