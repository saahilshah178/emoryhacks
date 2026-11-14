"""The agency's people and the numbers on the nurse's overview, all derived from attempts.

GET   /api/caregivers            roster with progress, open flags and status (nurses)
GET   /api/caregivers/{id}       one caregiver: per-skill standing and attempt history (nurses)
PATCH /api/caregivers/{id}       {employment, title, location} (nurses)
GET   /api/overview              counts, safety patterns, recent activity, notifications (nurses)
POST  /api/notifications/seen    mark the nurse's notifications as read
GET   /api/my/skills             the signed-in caregiver's skills with their standing on each

Nothing here is stored separately: a caregiver's standing on a skill, the roster's
"restricted" status, the activity feed and the notifications are all computed from the
attempts, reviews and safety flags in the database (rules in app/progress.py).
"""
from __future__ import annotations

import datetime as dt
import uuid
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import auth, db, progress, repo

router = APIRouter(tags=["people"])

PATTERN_DAYS = 30  # "safety patterns" look at this many days of attempts
ACTIVITY_LIMIT = 8


class CaregiverPatch(BaseModel):
    employment: str | None = None
    title: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=80)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _skills_by_slug(org_id) -> dict[str, dict]:
    return {s["slug"]: s for s in repo.list_skills(org_id=org_id)}


def _standing(attempts: list[dict]) -> dict[tuple, dict]:
    """(caregiver_id, skill_slug) -> progress.skill_state, for attempts made under an account."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for a in sorted(attempts, key=lambda a: a["created_at"]):
        if a["caregiver_id"]:
            groups[(a["caregiver_id"], a["skill_slug"])].append(a)
    return {key: progress.skill_state(rows) for key, rows in groups.items()}


def _caregiver_rows(org_id, attempts: list[dict], skills: dict[str, dict]) -> list[dict]:
    people = db.fetch_all(
        """SELECT id, name, email, title, location, hire_date, employment, next_shift, created_at
           FROM users WHERE org_id=%s AND role='caregiver' ORDER BY name""", (org_id,))
    standing = _standing(attempts)
    by_person: dict = defaultdict(list)
    for a in attempts:
        if a["caregiver_id"]:
            by_person[a["caregiver_id"]].append(a)  # newest first, as listed
    for person in people:
        mine = by_person.get(person["id"], [])
        pending = [a for a in mine if a["review_state"] == "pending"]
        person["skills_total"] = len(skills)
        person["skills_verified"] = sum(
            1 for slug in skills if standing.get((person["id"], slug), {}).get("state") == "verified")
        person["skills_in_review"] = sum(
            1 for slug in skills if standing.get((person["id"], slug), {}).get("state") == "in_review")
        person["open_flags"] = sum(a["flag_count"] for a in pending)
        person["last_submission_at"] = mine[0]["created_at"] if mine else None
        person["pending_attempt_id"] = pending[0]["id"] if pending else None
        person["attempt_count"] = len(mine)
        restricted = any(a["ai_assessment"] == "safety_concern" for a in pending)
        person["status"] = "restricted" if restricted else person["employment"]
    return people


@router.get("/caregivers")
def list_caregivers(user: dict = Depends(auth.nurse)):
    attempts = repo.list_attempts(org_id=user["org_id"])
    return _caregiver_rows(user["org_id"], attempts, _skills_by_slug(user["org_id"]))


@router.get("/caregivers/{caregiver_id}")
def get_caregiver(caregiver_id: str, user: dict = Depends(auth.nurse)):
    person_id = _caregiver_id_or_404(caregiver_id, user)
    attempts = repo.list_attempts(org_id=user["org_id"])
    skills = _skills_by_slug(user["org_id"])
    person = next(p for p in _caregiver_rows(user["org_id"], attempts, skills) if p["id"] == person_id)
    standing = _standing(attempts)
    person["skills"] = [
        {"skill_id": s["id"], "slug": slug, "name": s["name"], "category": s["category"],
         **standing.get((person_id, slug), progress.skill_state([]))}
        for slug, s in sorted(skills.items(), key=lambda kv: kv[1]["name"])]
    person["attempts"] = [a for a in attempts if a["caregiver_id"] == person_id]
    return person


@router.patch("/caregivers/{caregiver_id}")
def patch_caregiver(caregiver_id: str, body: CaregiverPatch, user: dict = Depends(auth.nurse)):
    person_id = _caregiver_id_or_404(caregiver_id, user)
    if body.employment is not None and body.employment not in ("onboarding", "active"):
        raise HTTPException(422, "employment must be 'onboarding' or 'active'")
    fields = body.model_dump(exclude_none=True)
    if fields:
        db.execute(f"UPDATE users SET {', '.join(f'{k}=%s' for k in fields)} WHERE id=%s",
                   (*[v.strip() if isinstance(v, str) else v for v in fields.values()], person_id))
        auth.forget_cached(person_id)
    return get_caregiver(caregiver_id, user)


def _caregiver_id_or_404(caregiver_id: str, user: dict) -> uuid.UUID:
    try:
        person_id = uuid.UUID(caregiver_id)
    except ValueError:
        raise HTTPException(404, "Caregiver not found") from None
    if not db.fetch_one("SELECT 1 FROM users WHERE id=%s AND org_id=%s AND role='caregiver'",
                        (person_id, user["org_id"])):
        raise HTTPException(404, "Caregiver not found")
    return person_id


# --- overview ---------------------------------------------------------------
def _flag_heading(flags: list[dict]) -> str:
    """The heading of an attempt's most serious counting flag."""
    if not flags:
        return "a safety concern"
    worst = sorted(flags, key=lambda f: (f["severity"] != "high", f["start_s"]))[0]
    heading = (worst.get("title") or "").strip() or worst["description"]
    return heading if len(heading) <= 90 else heading[:87].rstrip() + "..."


def _activity(attempts: list[dict]) -> list[dict]:
    """Recent events, newest first. Each attempt gives one event when it arrives (a safety
    concern if the AI raised one, a first assessment if it is that caregiver's first, a
    submission otherwise) and one more when a nurse decides."""
    events = []
    first_seen: set = set()
    for a in reversed(attempts):  # oldest first, to spot each caregiver's first attempt
        who, skill = a["caregiver_name"] or "A caregiver", a["skill_name"]
        base = {"attempt_id": a["id"], "caregiver_id": a["caregiver_id"]}
        first = bool(a["caregiver_id"]) and a["caregiver_id"] not in first_seen
        first_seen.add(a["caregiver_id"])
        if a["review_state"] in ("processing", "error"):
            continue
        if a["flag_count"]:
            events.append({**base, "id": f"flag-{a['id']}", "type": "safety", "time": a["created_at"],
                           "message": "AI detected a safety concern",
                           "detail": f"{who}, {skill}: {_flag_heading(a.get('flags') or [])}"})
        elif first:
            events.append({**base, "id": f"first-{a['id']}", "type": "first_assessment", "time": a["created_at"],
                           "message": "New caregiver completed their first assessment",
                           "detail": f"{who} finished {skill}."})
        else:
            events.append({**base, "id": f"sub-{a['id']}", "type": "submission", "time": a["created_at"],
                           "message": f"{who} submitted a skill demonstration",
                           "detail": f"{skill} is waiting for nurse review." if a["review_state"] == "pending"
                           else f"{skill} was sent for nurse review."})
        if a["review_state"] in ("approved", "retraining"):
            nurse = a["reviewer_name"] or "A nurse"
            approved = a["review_state"] == "approved"
            events.append({**base, "id": f"dec-{a['id']}", "type": "approval" if approved else "retraining",
                           "time": a["reviewed_at"],
                           "message": "Nurse approved a caregiver's competency" if approved
                           else "Nurse requested retraining",
                           "detail": f"{nurse} approved {who} for {skill}." if approved
                           else f"{nurse} asked {who} to practise {skill} again."})
    events.sort(key=lambda e: e["time"], reverse=True)
    return events[:ACTIVITY_LIMIT]


def _notifications(user: dict, attempts: list[dict]) -> list[dict]:
    """What is waiting for this nurse, honouring their notification preferences."""
    prefs = auth.public(user)["prefs"]
    seen = user["notifications_seen_at"]
    items = []
    for a in attempts:
        if a["review_state"] != "pending":
            continue
        who, skill = a["caregiver_name"] or "A caregiver", a["skill_name"]
        if a["flag_count"] and prefs["safety"]:
            n = a["flag_count"]
            items.append({"id": f"safety-{a['id']}", "kind": "safety", "attempt_id": a["id"], "time": a["created_at"],
                          "title": "Safety concern needs review",
                          "body": f"{who}, {skill}. {n} safety flag{'' if n == 1 else 's'}."})
        elif not a["flag_count"] and prefs["submissions"]:
            items.append({"id": f"sub-{a['id']}", "kind": "submission", "attempt_id": a["id"],
                          "time": a["created_at"], "title": f"New submission from {who}",
                          "body": f"{skill} is ready for clinical review."})
    if prefs["digest"]:
        week_ago = _now() - dt.timedelta(days=7)
        approved = sum(1 for a in attempts if a["review_state"] == "approved" and a["reviewed_at"] >= week_ago)
        waiting = sum(1 for a in attempts if a["review_state"] == "pending")
        items.append({"id": "digest", "kind": "digest", "attempt_id": None,
                      "time": _now().replace(hour=7, minute=0, second=0, microsecond=0) - (
                          dt.timedelta(days=1) if _now().hour < 7 else dt.timedelta()),
                      "title": "Weekly verification digest",
                      "body": f"{approved} skill{'' if approved == 1 else 's'} approved this week. "
                              f"{waiting} still waiting on nurse sign-off."})
    for item in items:
        item["unread"] = seen is None or item["time"] > seen
    items.sort(key=lambda i: i["time"], reverse=True)
    return items[:12]


@router.get("/overview")
def overview(user: dict = Depends(auth.nurse)):
    org = user["org_id"]
    attempts = repo.list_attempts(org_id=org)
    skills = _skills_by_slug(org)
    people = _caregiver_rows(org, attempts, skills)
    pending = [a for a in attempts if a["review_state"] == "pending"]
    verified = sum(p["skills_verified"] for p in people)
    possible = sum(p["skills_total"] for p in people)
    since = _now() - dt.timedelta(days=PATTERN_DAYS)
    missed = db.fetch_all(
        """SELECT st.title AS label, s.name AS skill_name, count(*) AS count
           FROM attempt_steps x JOIN attempts a ON a.id = x.attempt_id JOIN skills s ON s.id = a.skill_id
           JOIN skill_steps st ON st.skill_id = s.id AND st.step_id = x.step_id
           WHERE s.org_id=%s AND a.created_at >= %s AND coalesce(x.nurse_status, x.status) = 'failed'
           GROUP BY st.title, s.name ORDER BY count(*) DESC, st.title LIMIT 5""", (org, since))
    flagged = db.fetch_all(
        """SELECT s.slug, max(s.name) AS name, count(*) AS flags
           FROM safety_flags f JOIN attempts a ON a.id = f.attempt_id JOIN skills s ON s.id = a.skill_id
           WHERE s.org_id=%s AND a.created_at >= %s AND f.counts_toward_score
           GROUP BY s.slug ORDER BY count(*) DESC, s.slug LIMIT 4""", (org, since))
    for row in flagged:
        row["skill_id"] = skills[row["slug"]]["id"] if row["slug"] in skills else None
    notifications = _notifications(user, attempts)
    return {
        "agency": user["org_name"],
        "counts": {"caregivers": len(people), "skills": len(skills), "pending": len(pending),
                   "verified": verified, "safety_flags": sum(1 for a in pending if a["flag_count"]),
                   "processing": sum(1 for a in attempts if a["review_state"] == "processing")},
        "verification_rate": round(verified / possible, 3) if possible else None,
        "pattern_days": PATTERN_DAYS,
        "missed_steps": missed,
        "flagged_skills": flagged,
        "activity": _activity(attempts),
        "notifications": notifications,
        "unread": sum(1 for n in notifications if n["unread"]),
    }


@router.post("/notifications/seen")
def notifications_seen(user: dict = Depends(auth.current_user)):
    db.execute("UPDATE users SET notifications_seen_at=now() WHERE id=%s", (user["id"],))
    auth.forget_cached(user["id"])
    return {"ok": True}


# --- caregiver ----------------------------------------------------------------
@router.get("/my/skills")
def my_skills(user: dict = Depends(auth.current_user)):
    """The agency's skills with the signed-in caregiver's standing on each one."""
    if user["role"] != "caregiver":
        raise HTTPException(403, "This list is for caregivers.")
    skills = repo.list_skills(org_id=user["org_id"])
    standing = _standing(repo.list_attempts(org_id=user["org_id"], caregiver_id=user["id"]))
    for s in skills:
        s.update(standing.get((user["id"], s["slug"]), progress.skill_state([])))
    counts = {state: sum(1 for s in skills if s["state"] == state) for state in progress.SKILL_STATES}
    return {"skills": skills, "counts": {**counts, "total": len(skills)}}
