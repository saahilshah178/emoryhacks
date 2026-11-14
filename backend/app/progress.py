"""What an attempt means for a nurse's queue and for a caregiver's progress.

Stored facts are the AI result (attempts.status, score_pct, skill_match), when and how the
caregiver sent it (submitted_at, submit_kind, submit_note), the nurse's decision
(nurse_status, reviewed_at), the safety flags, the pipeline job, and the nurse's policy for
the skill (skill_policies, skill_assignments). Everything a screen shows as a state is
derived from those here, so the nurse dashboard and the caregiver portal cannot disagree.

review_state of an attempt, checked in this order
  approved     a nurse reviewed it and the final result is passed
  retraining   a nurse reviewed it and the final result is not passed
  processing   the pipeline is still running
  error        the pipeline failed, so there is nothing to review
  unsubmitted  graded, and the caregiver has not sent it to a nurse (yet)
  superseded   sent and not reviewed, but the same caregiver has sent a newer attempt at the
               same skill (any version, matched by slug), so this one is history
  pending      sent, waiting for a nurse, and the caregiver's latest submission for the skill
An attempt uploaded by a nurse (no caregiver account) counts as sent when it is created.

ai_assessment of an attempt (None until it is graded)
  passed          the AI found every criterion met
  needs_review    the AI could not verify enough of it
  not_passed      the AI found failed steps, with no safety concern
  safety_concern  the AI failed it and raised a safety flag that counts

submission of an attempt: whether the caregiver may send it, and a sentence saying why
  score_pct >= submit_pct (default 80)               can_submit: sent normally
  force_pct (default 50) <= score_pct < submit_pct   can_force: "send anyway" with a note of
                                                     at least FORCE_NOTE_MIN characters
  below force_pct, or skill_match false              neither: record it again
  Both flags are false once it is sent, and while it is processing or failed.

state of a skill for one caregiver, from all their attempts at it (any version)
  verified        the nurse's most recent decision was an approval
  in_review       their latest submission is waiting for a nurse and was sent after the
                  attempt behind the last decision
  practicing      they have recorded (not failed processing) since the last decision, or ever
                  when there is none, but nothing of it is waiting for a nurse
  needs_practice  the nurse's most recent decision asked for retraining, and nothing since
  not_started     no attempt that counts

Attempts allowed (per caregiver and skill)
  allowed  the caregiver's own limit when the nurse set one ('limited' or 'unlimited'),
           otherwise the skill's max_attempts; None means unlimited
  used     attempts that did not fail processing, made after the nurse's most recent
           retraining decision for that caregiver and skill (all of them if there is none).
           An attempt still processing counts.
  left     allowed - used, never below 0; None when unlimited
"""
from __future__ import annotations

from typing import Iterable

REVIEW_STATES = ("processing", "error", "unsubmitted", "pending", "superseded", "approved", "retraining")
SUBMITTED_STATES = ("pending", "superseded", "approved", "retraining")
SKILL_STATES = ("not_started", "practicing", "in_review", "needs_practice", "verified")
LIMIT_MODES = ("inherit", "limited", "unlimited")

DEFAULT_POLICY = {"max_attempts": None, "submit_pct": 80.0, "force_pct": 50.0, "assign_all": True}
FORCE_NOTE_MIN = 10
MAX_ATTEMPTS = 50


def review_state(row: dict) -> str:
    """row needs job_status, reviewed_at, status, nurse_status, submitted_at and
    newer_submission (whether the same caregiver sent a later attempt at the same skill)."""
    if row.get("reviewed_at"):
        return "approved" if (row.get("nurse_status") or row.get("status")) == "passed" else "retraining"
    job = row.get("job_status")
    if job in ("queued", "running"):
        return "processing"
    if job == "error" or row.get("status") is None:
        return "error"
    if not row.get("submitted_at"):
        return "unsubmitted"
    return "superseded" if row.get("newer_submission") else "pending"


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


# --- policy -----------------------------------------------------------------------------
def policy(row: dict | None) -> dict:
    """A skill's policy with the defaults filled in. row: a skill_policies row or None."""
    out = dict(DEFAULT_POLICY)
    if row:
        out.update({k: row[k] for k in DEFAULT_POLICY})
    out["submit_pct"], out["force_pct"] = float(out["submit_pct"]), float(out["force_pct"])
    return out


def is_assigned(pol: dict, assignment: dict | None) -> bool:
    """A skill is every caregiver's while assign_all is set; otherwise only the caregivers
    with an assignment row that says assigned."""
    return bool(pol["assign_all"] or (assignment and assignment["assigned"]))


def limit_mode(assignment: dict | None) -> str:
    return (assignment or {}).get("limit_mode") or "inherit"


def attempts_allowed(pol: dict, assignment: dict | None) -> int | None:
    mode = limit_mode(assignment)
    if mode == "unlimited":
        return None
    if mode == "limited":
        return assignment["max_attempts"]
    return pol["max_attempts"]


def attempts_used(attempts: Iterable[dict]) -> int:
    """attempts: one caregiver's described rows for one skill (any version, any order)."""
    rows = list(attempts)
    retrained = [a["reviewed_at"] for a in rows if a["review_state"] == "retraining"]
    since = max(retrained) if retrained else None
    return sum(1 for a in rows if a["review_state"] != "error" and (since is None or a["created_at"] > since))


def allowance(pol: dict, assignment: dict | None, attempts: Iterable[dict]) -> dict:
    """{used, allowed, left} for one caregiver and skill; allowed and left are None when unlimited."""
    used = attempts_used(attempts)
    allowed = attempts_allowed(pol, assignment)
    return {"used": used, "allowed": allowed, "left": None if allowed is None else max(allowed - used, 0)}


def no_attempts_left(allowed: int) -> str:
    """What a caregiver reads when they try to record past their limit."""
    used = "your only attempt" if allowed == 1 else f"all {allowed} attempts"
    return f"You have used {used} for this skill. Ask your nurse for more."


def pct(value: float | None) -> str:
    """64 -> "64%", 79.6 -> "79.6%": never rounded across a threshold."""
    value = float(value or 0)
    return f"{value:.0f}%" if value == round(value) else f"{value:.1f}%"


def submission(row: dict, pol: dict) -> dict:
    """Whether the caregiver may send this attempt to a nurse, and a sentence saying why.
    row: a described attempt row with score_pct, skill_match and submitted_at. The sentence
    says why, not what to do next: whether they can record again depends on the attempts
    they have left, which the screens show beside it."""
    out = {"can_submit": False, "can_force": False, "submit_pct": pol["submit_pct"], "force_pct": pol["force_pct"]}
    state = row["review_state"]
    score = float(row.get("score_pct") or 0)
    if state == "processing":
        reason = "This recording is still being checked. You can send it once the check has finished."
    elif state == "error":
        reason = "This recording could not be checked, so it cannot be sent."
    elif state in ("approved", "retraining"):
        reason = "Your nurse has reviewed this recording."
    elif state == "superseded":
        reason = "You sent a newer recording of this skill, so your nurse will review that one instead."
    elif row.get("submitted_at"):
        reason = "This recording has been sent to your nurse."
    elif row.get("skill_match") is False:
        reason = "The automatic check could not find this skill in the video, so it cannot be sent."
    elif score >= pol["submit_pct"]:
        out["can_submit"] = True
        reason = (f"You scored {pct(score)}, which meets the {pct(pol['submit_pct'])} your nurse asks for. "
                  "You can send it for review.")
    elif score >= pol["force_pct"]:
        out["can_force"] = True
        reason = (f"You scored {pct(score)}. Your nurse asks for {pct(pol['submit_pct'])} before a recording is "
                  "sent. If you think the automatic check got it wrong, you can send it anyway with a note.")
    else:
        reason = f"You scored {pct(score)}, which is under the {pct(pol['force_pct'])} needed to send it."
    out["reason"] = reason
    return out


# --- a caregiver's standing on a skill -----------------------------------------------------
def _sent_at(a: dict):
    return a.get("submitted_at") or a["created_at"]


def skill_state(attempts: Iterable[dict]) -> dict:
    """The caregiver's standing on one skill. attempts: described rows, oldest first.

    Returns state, attempt_id (the attempt whose result page says why: the approval, the
    submission waiting for a nurse, the latest practice run, or the retraining decision),
    latest_attempt_id and attempts."""
    rows = list(attempts)
    decided = [a for a in rows if a["review_state"] in ("approved", "retraining")]
    last = max(decided, key=lambda a: a["reviewed_at"]) if decided else None
    latest_id = rows[-1]["id"] if rows else None

    def result(state: str, attempt_id) -> dict:
        return {"state": state, "attempt_id": attempt_id, "latest_attempt_id": latest_id, "attempts": len(rows)}

    if last and last["review_state"] == "approved":
        return result("verified", last["id"])
    waiting = [a for a in rows if a["review_state"] == "pending" and (not last or _sent_at(a) > _sent_at(last))]
    if waiting:
        return result("in_review", waiting[-1]["id"])
    since = [a for a in rows if a["review_state"] not in ("error", "approved", "retraining")
             and (not last or a["created_at"] > last["reviewed_at"])]
    if since:
        return result("practicing", since[-1]["id"])
    if last:
        return result("needs_practice", last["id"])
    return result("not_started", latest_id)


def caregiver_skill(pol: dict, assignment: dict | None, attempts: Iterable[dict]) -> dict:
    """Everything about one caregiver and one skill that the nurse's screens show: assignment,
    limit (max_attempts is the caregiver's own, set only when limit_mode is 'limited'),
    attempts used / allowed / left, and the skill_state fields. attempts: oldest first."""
    rows = list(attempts)
    mode = limit_mode(assignment)
    allow = allowance(pol, assignment, rows)
    return {"assigned": is_assigned(pol, assignment), "limit_mode": mode,
            "max_attempts": assignment["max_attempts"] if mode == "limited" else None,
            "attempts_used": allow["used"], "attempts_allowed": allow["allowed"], "attempts_left": allow["left"],
            **skill_state(rows)}


def ready_attempt_id(attempts: Iterable[dict]):
    """The caregiver's best-scoring attempt made since the nurse's last decision that is not
    sent yet and can be sent normally (rows carry submission). None if there is none."""
    rows = list(attempts)
    decisions = [a["reviewed_at"] for a in rows if a["review_state"] in ("approved", "retraining")]
    since = max(decisions) if decisions else None
    ready = [a for a in rows if a["review_state"] == "unsubmitted" and a["submission"]["can_submit"]
             and (since is None or a["created_at"] > since)]
    if not ready:
        return None
    return max(ready, key=lambda a: (a.get("score_pct") or 0, a["created_at"]))["id"]
