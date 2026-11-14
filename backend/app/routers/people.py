"""The agency's people and the numbers on the nurse's overview, all derived from attempts.

GET   /api/caregivers                       roster with progress, open flags and status (nurses)
GET   /api/caregivers/{id}                  one caregiver: standing, limits and attempts used on each
                                            assigned skill, the skills not assigned to them, and every
                                            attempt they made (nurses)
PATCH /api/caregivers/{id}                  {employment, title, location} (nurses)
PATCH /api/caregivers/{id}/skills/{skill_id}
                                            {assigned?, limit_mode?, max_attempts?, grant?}: assign or
                                            unassign the skill, set this caregiver's own attempt limit,
                                            or grant more attempts (nurses). Returns the caregiver.
GET   /api/overview                         counts, safety patterns, recent activity, notifications (nurses)
POST  /api/notifications/seen               mark the nurse's notifications as read
GET   /api/my/skills                        the signed-in caregiver's assigned skills with their standing,
                                            attempts left and the best attempt ready to send

Nothing here is stored separately: a caregiver's standing on a skill, the roster's
"restricted" status, the activity feed and the notifications are all computed from the
attempts, reviews, safety flags and skill policies in the database (rules in app/progress.py).

What the nurse's pages count is what caregivers sent: "pending" is each caregiver's latest
waiting submission per skill, and activity, notifications and safety patterns are built from
submissions, timed by when they were sent. Practice runs a caregiver has not sent never show
up there; they are part of the caregiver's history (GET /api/caregivers/{id}, attempts).

Skills count toward a caregiver (skills_total, verification rate) only while assigned to them.

PATCH .../skills/{skill_id} rules:
  assigned     true or false. Unassigning one caregiver from a skill assigned to everyone
               switches the skill to picked caregivers, with everyone else still assigned.
  limit_mode   'inherit' (the skill's limit), 'limited' (max_attempts, 1..50) or 'unlimited'.
               Sending max_attempts alone means 'limited'.
  grant        k (1..50) more attempts: 'limited' with max_attempts = max(allowed, used) + k.
               Does nothing for a caregiver whose attempts are unlimited.
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
NOTE_QUOTE_CHARS = 200


class CaregiverPatch(BaseModel):
    employment: str | None = None
    title: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=80)


class CaregiverSkillPatch(BaseModel):
    assigned: bool | None = None
    limit_mode: str | None = None
    max_attempts: int | None = None
    grant: int | None = None


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _skills_by_slug(org_id) -> dict[str, dict]:
    return {s["slug"]: s for s in repo.list_skills(org_id=org_id)}


def _groups(attempts: list[dict]) -> dict[tuple, list[dict]]:
    """(caregiver_id, skill_slug) -> that caregiver's attempts at the skill, oldest first."""
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for a in sorted(attempts, key=lambda a: a["created_at"]):
        if a["caregiver_id"]:
            groups[(a["caregiver_id"], a["skill_slug"])].append(a)
    return groups


def _sent_at(a: dict):
    return a["submitted_at"] or a["created_at"]


def _caregiver_rows(org_id, attempts: list[dict], skills: dict[str, dict],
                    assignments: dict[tuple, dict] | None = None) -> list[dict]:
    people = repo.list_caregivers(org_id)
    assignments = repo.get_assignments(org_id) if assignments is None else assignments
    groups = _groups(attempts)
    by_person: dict = defaultdict(list)
    for a in attempts:
        if a["caregiver_id"]:
            by_person[a["caregiver_id"]].append(a)  # newest first, as listed
    for person in people:
        pid = person["id"]
        mine = by_person.get(pid, [])
        assigned = [slug for slug, s in skills.items() if progress.is_assigned(s["policy"], assignments.get((slug, pid)))]
        states = [progress.skill_state(groups.get((pid, slug), []))["state"] for slug in assigned]
        pending = sorted((a for a in mine if a["review_state"] == "pending"), key=_sent_at, reverse=True)
        sent = [a["submitted_at"] for a in mine if a["submitted_at"]]
        person["skills_total"] = len(assigned)
        person["skills_verified"] = states.count("verified")
        person["skills_in_review"] = states.count("in_review")
        person["open_flags"] = sum(a["flag_count"] for a in pending)
        person["last_submission_at"] = max(sent) if sent else None
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
    org = user["org_id"]
    attempts = repo.list_attempts(org_id=org)
    skills = _skills_by_slug(org)
    assignments = repo.get_assignments(org)
    person = next(p for p in _caregiver_rows(org, attempts, skills, assignments) if p["id"] == person_id)
    groups = _groups(attempts)
    rows, unassigned = [], []
    for slug, s in sorted(skills.items(), key=lambda kv: kv[1]["name"]):
        base = {"skill_id": s["id"], "slug": slug, "name": s["name"], "category": s["category"]}
        standing = progress.caregiver_skill(s["policy"], assignments.get((slug, person_id)),
                                            groups.get((person_id, slug), []))
        if standing["assigned"]:
            rows.append({**base, **standing})
        else:
            unassigned.append(base)
    person["skills"] = rows
    person["unassigned_skills"] = unassigned
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


@router.patch("/caregivers/{caregiver_id}/skills/{skill_id}")
def patch_caregiver_skill(caregiver_id: str, skill_id: str, body: CaregiverSkillPatch,
                          user: dict = Depends(auth.nurse)):
    """Assign or unassign one skill for one caregiver, set their own limit, or grant attempts."""
    person_id = _caregiver_id_or_404(caregiver_id, user)
    org = user["org_id"]
    try:
        skill = repo.get_skill(uuid.UUID(skill_id))
    except ValueError:
        skill = None
    if not skill or skill["org_id"] != org:
        raise HTTPException(404, "Skill not found")
    slug = skill["slug"]
    if body.limit_mode is not None and body.limit_mode not in progress.LIMIT_MODES:
        raise HTTPException(422, "The limit must be 'inherit' (the skill's own), 'limited' or 'unlimited'.")
    if body.max_attempts is not None and not 1 <= body.max_attempts <= progress.MAX_ATTEMPTS:
        raise HTTPException(422, f"Attempts allowed must be a whole number from 1 to {progress.MAX_ATTEMPTS}.")
    if body.grant is not None and not 1 <= body.grant <= progress.MAX_ATTEMPTS:
        raise HTTPException(422, f"Grant from 1 to {progress.MAX_ATTEMPTS} more attempts at a time.")

    pol = repo.get_policy(org, slug)
    if body.assigned is not None:
        if pol["assign_all"] and not body.assigned:
            # The skill was everyone's: it becomes a picked list of everyone but this caregiver.
            for person in repo.list_caregivers(org):
                repo.set_assignment(org, slug, person["id"], assigned=person["id"] != person_id)
            pol = {**pol, "assign_all": False}
            repo.save_policy(org, slug, pol, updated_by=user["id"])
        else:
            repo.set_assignment(org, slug, person_id, assigned=body.assigned)

    def current() -> dict | None:
        return repo.get_assignments(org, slug=slug, caregiver_id=person_id).get((slug, person_id))

    # A limit change never changes the assignment, so a new row keeps the caregiver's present one.
    assigned_now = progress.is_assigned(pol, current())
    mode = body.limit_mode or ("limited" if body.max_attempts is not None else None)
    if mode == "limited":
        n = body.max_attempts if body.max_attempts is not None else (current() or {}).get("max_attempts")
        if n is None:
            raise HTTPException(422, "Say how many attempts this caregiver gets.")
        repo.set_assignment(org, slug, person_id, assigned=assigned_now, limit_mode="limited", max_attempts=n)
    elif mode:
        repo.set_assignment(org, slug, person_id, assigned=assigned_now, limit_mode=mode, max_attempts=None)

    if body.grant:
        allowance = repo.allowance(org, slug, person_id)
        if allowance["allowed"] is not None:
            repo.set_assignment(org, slug, person_id, assigned=assigned_now, limit_mode="limited",
                                max_attempts=max(allowance["allowed"], allowance["used"]) + body.grant)
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


def _quote(note: str) -> str:
    note = " ".join((note or "").split())
    return note if len(note) <= NOTE_QUOTE_CHARS else note[:NOTE_QUOTE_CHARS - 3].rstrip() + "..."


def _activity(attempts: list[dict]) -> list[dict]:
    """Recent events, newest first, from what caregivers sent. Each submission that is not
    superseded gives one event when it is sent (a safety concern if the AI raised one, a
    disagreement with the automatic check if it was forced, a first assessment if it is that
    caregiver's first submission, a submission otherwise) and one more when a nurse decides."""
    events = []
    first_seen: set = set()
    sent = sorted((a for a in attempts if a["submitted_at"]), key=_sent_at)  # oldest first
    for a in sent:
        who, skill = a["caregiver_name"] or "A caregiver", a["skill_name"]
        base = {"attempt_id": a["id"], "caregiver_id": a["caregiver_id"], "forced": a["submit_kind"] == "forced"}
        first = bool(a["caregiver_id"]) and a["caregiver_id"] not in first_seen
        first_seen.add(a["caregiver_id"])
        if a["review_state"] not in ("pending", "approved", "retraining"):
            continue  # still processing, failed, or replaced by a newer submission
        time = _sent_at(a)
        if a["flag_count"]:
            events.append({**base, "id": f"flag-{a['id']}", "type": "safety", "time": time,
                           "message": "AI detected a safety concern",
                           "detail": f"{who}, {skill}: {_flag_heading(a.get('flags') or [])}"})
        elif base["forced"]:
            events.append({**base, "id": f"sub-{a['id']}", "type": "submission", "time": time,
                           "message": f"{who} disagreed with the automatic check",
                           "detail": f"{who} sent {skill} for review anyway at {progress.pct(a['score_pct'])}: "
                                     f"\"{_quote(a['submit_note'])}\""})
        elif first:
            events.append({**base, "id": f"first-{a['id']}", "type": "first_assessment", "time": time,
                           "message": "New caregiver completed their first assessment",
                           "detail": f"{who} finished {skill}."})
        else:
            events.append({**base, "id": f"sub-{a['id']}", "type": "submission", "time": time,
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
    """What is waiting for this nurse, honouring their notification preferences. Only each
    caregiver's latest submission per skill (review_state pending) is listed."""
    prefs = auth.public(user)["prefs"]
    seen = user["notifications_seen_at"]
    items = []
    for a in attempts:
        if a["review_state"] != "pending":
            continue
        who, skill = a["caregiver_name"] or "A caregiver", a["skill_name"]
        forced = a["submit_kind"] == "forced"
        base = {"attempt_id": a["id"], "time": _sent_at(a), "forced": forced}
        if a["flag_count"] and prefs["safety"]:
            n = a["flag_count"]
            items.append({**base, "id": f"safety-{a['id']}", "kind": "safety",
                          "title": "Safety concern needs review",
                          "body": f"{who}, {skill}. {n} safety flag{'' if n == 1 else 's'}."})
        elif not a["flag_count"] and prefs["submissions"] and forced:
            items.append({**base, "id": f"sub-{a['id']}", "kind": "submission",
                          "title": f"{who} disagrees with the automatic check",
                          "body": f"{skill} scored {progress.pct(a['score_pct'])} and was sent anyway: "
                                  f"\"{_quote(a['submit_note'])}\""})
        elif not a["flag_count"] and prefs["submissions"]:
            items.append({**base, "id": f"sub-{a['id']}", "kind": "submission",
                          "title": f"New submission from {who}",
                          "body": f"{skill} is ready for clinical review."})
    if prefs["digest"]:
        week_ago = _now() - dt.timedelta(days=7)
        approved = sum(1 for a in attempts if a["review_state"] == "approved" and a["reviewed_at"] >= week_ago)
        waiting = sum(1 for a in attempts if a["review_state"] == "pending")
        items.append({"id": "digest", "kind": "digest", "attempt_id": None, "forced": False,
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
           WHERE s.org_id=%s AND a.created_at >= %s AND a.submitted_at IS NOT NULL
             AND coalesce(x.nurse_status, x.status) = 'failed'
           GROUP BY st.title, s.name ORDER BY count(*) DESC, st.title LIMIT 5""", (org, since))
    flagged = db.fetch_all(
        """SELECT s.slug, max(s.name) AS name, count(*) AS flags
           FROM safety_flags f JOIN attempts a ON a.id = f.attempt_id JOIN skills s ON s.id = a.skill_id
           WHERE s.org_id=%s AND a.created_at >= %s AND a.submitted_at IS NOT NULL AND f.counts_toward_score
           GROUP BY s.slug ORDER BY count(*) DESC, s.slug LIMIT 4""", (org, since))
    for row in flagged:
        row["skill_id"] = skills[row["slug"]]["id"] if row["slug"] in skills else None
    notifications = _notifications(user, attempts)
    return {
        "agency": user["org_name"],
        "counts": {"caregivers": len(people), "skills": len(skills), "pending": len(pending),
                   "verified": verified, "safety_flags": sum(1 for a in pending if a["flag_count"]),
                   # attempts sent to a nurse that are still being graded: a nurse's own uploads
                   "processing": sum(1 for a in attempts if a["review_state"] == "processing" and a["submitted_at"])},
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
    """The skills assigned to the signed-in caregiver, with their standing on each one, their
    attempts used / allowed / left, the score bars for sending, ready_attempt_id: the
    best-scoring attempt since the nurse's last decision that is not sent yet and can be sent
    normally (null if none), and checking_attempt_id: the newest attempt while it is still
    being checked (null otherwise)."""
    if user["role"] != "caregiver":
        raise HTTPException(403, "This list is for caregivers.")
    org, me = user["org_id"], user["id"]
    assigned = repo.assigned_slugs(org, me)
    skills = [s for s in repo.list_skills(org_id=org) if s["slug"] in assigned]
    groups = _groups(repo.list_attempts(org_id=org, caregiver_id=me))
    assignments = repo.get_assignments(org, caregiver_id=me)
    for s in skills:
        rows = groups.get((me, s["slug"]), [])
        allow = progress.allowance(s["policy"], assignments.get((s["slug"], me)), rows)
        s.update(progress.skill_state(rows))
        s.update({"attempts_used": allow["used"], "attempts_allowed": allow["allowed"],
                  "attempts_left": allow["left"], "ready_attempt_id": progress.ready_attempt_id(rows),
                  # The newest recording while it is still being checked, so the portal can say so.
                  "checking_attempt_id": rows[-1]["id"] if rows and rows[-1]["review_state"] == "processing" else None,
                  "policy": {"submit_pct": s["policy"]["submit_pct"], "force_pct": s["policy"]["force_pct"]}})
    counts = {state: sum(1 for s in skills if s["state"] == state) for state in progress.SKILL_STATES}
    return {"skills": skills, "counts": {**counts, "total": len(skills)}}
