"""Load the sample agency, Harbor Home Care, from scripts/sample_data.py.

  uv run python -m scripts.seed_sample

A full reset every time: the sample org and everything it owns is deleted (pose data
first, then the org; foreign keys cascade to users, sessions, videos, skills, steps,
attempts and flags) and inserted again. Ids are uuid5 of a stable key, so URLs survive a
re-seed; every mock time is shifted by (now - MOCK_NOW), so the data always looks current.
Signed-in sample sessions end on a re-seed.

Nobody here can log in until scripts/logins.py (make logins) has given some of these people
a username and a password. A re-seed keeps the logins it finds. The script ends by checking
what the API derives from the rows and exits non-zero if anything differs from the targets
in sample_data.
"""
from __future__ import annotations

import datetime as dt
import sys

from app import auth, config, db, media, repo
from app.routers import people
from scripts import sample_data as S
from scripts.sample_data import uid

ORG = auth.SAMPLE_ORG
# Tables with rows owned by the sample org, and how to find them.
OWNED = {
    "users": "SELECT id FROM users WHERE org_id=%(org)s",
    "videos": "SELECT id FROM videos WHERE org_id=%(org)s",
    "skills": "SELECT id FROM skills WHERE org_id=%(org)s",
    "skill_steps": "SELECT st.id FROM skill_steps st JOIN skills s ON s.id = st.skill_id WHERE s.org_id=%(org)s",
    "attempts": "SELECT a.id FROM attempts a JOIN skills s ON s.id = a.skill_id WHERE s.org_id=%(org)s",
    "attempt_steps": """SELECT x.id FROM attempt_steps x JOIN attempts a ON a.id = x.attempt_id
                        JOIN skills s ON s.id = a.skill_id WHERE s.org_id=%(org)s""",
    "safety_flags": "SELECT f.id FROM safety_flags f JOIN videos v ON v.id = f.video_id WHERE v.org_id=%(org)s",
    "pose_tracks": """SELECT t.video_id::text || ':' || t.person_idx AS id FROM pose_tracks t
                      JOIN videos v ON v.id = t.video_id WHERE v.org_id=%(org)s""",
}


class Clock:
    """Mock wall-clock time -> real UTC time, keeping every age the mock showed."""

    def __init__(self, now: dt.datetime):
        self.now = now
        self.shift = now - S.MOCK_NOW.replace(tzinfo=dt.timezone.utc)

    def at(self, value) -> dt.datetime:
        when = S.mock_time(value) if isinstance(value, str) else value
        return when.replace(tzinfo=dt.timezone.utc) + self.shift

    def date(self, text: str) -> dt.date:
        return self.at(text + "T00:00").date()


# --- snapshot / reset -----------------------------------------------------------------
def snapshot() -> dict[str, set]:
    return {table: {str(r["id"]) for r in db.fetch_all(sql, {"org": ORG})} for table, sql in OWNED.items()}


def pose_frame_count() -> int:
    return db.fetch_one(
        "SELECT count(*) AS n FROM pose_frames WHERE video_id IN (SELECT id FROM videos WHERE org_id=%s)",
        (ORG,))["n"]


def delete_sample(conn) -> None:
    videos = "SELECT id FROM videos WHERE org_id=%s"
    conn.execute(f"DELETE FROM pose_frames WHERE video_id IN ({videos})", (ORG,))
    conn.execute(f"DELETE FROM pose_tracks WHERE video_id IN ({videos})", (ORG,))
    conn.execute("DELETE FROM orgs WHERE id=%s", (ORG,))


def refresh_rollup(start: dt.datetime | None, end: dt.datetime | None) -> None:
    """Re-materialise pose_1s over a window whose frames were deleted, so no stale buckets remain."""
    if not start:
        return
    try:
        db.execute("CALL refresh_continuous_aggregate('pose_1s', %s, %s)",
                   (start - dt.timedelta(seconds=5), end + dt.timedelta(seconds=5)))
    except Exception as exc:  # the rollup is a cache; a failed refresh is not fatal
        print(f"note: could not refresh pose_1s over the old window: {exc}")


# --- inserts ------------------------------------------------------------------------------
def insert_user(conn, clock: Clock, key: str, role: str, name: str, email: str, created: str, **profile) -> None:
    if "prefs" in profile:
        profile["prefs"] = db.J(profile["prefs"])
    columns = {"id": uid(f"user:{key}"), "org_id": ORG, "role": role, "name": name, "email": email.lower(),
               "created_at": clock.at(created), **profile}
    conn.execute(f"INSERT INTO users ({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))})",
                 tuple(columns.values()))


def insert_people(conn, clock: Clock) -> None:
    conn.execute("INSERT INTO orgs (id, name, is_sample, created_at) VALUES (%s,%s,true,%s)",
                 (ORG, S.ORG_NAME, clock.at(S.ORG_CREATED)))
    for n in S.NURSES:
        insert_user(conn, clock, n["key"], "nurse", n["name"], n["email"], n["created"],
                    credentials=n["credentials"], title=n["title"], prefs=n["prefs"], employment="active")
    c = S.SARAH_CHEN
    insert_user(conn, clock, c["key"], "caregiver", c["name"], c["email"], c["hire_date"] + "T09:00",
                title=c["title"], next_shift=c["next_shift"], employment=c["employment"],
                hire_date=clock.date(c["hire_date"]), location=c["location"])
    for c in S.ROSTER:
        insert_user(conn, clock, c["key"], "caregiver", c["name"], S.email_for(c["name"]),
                    c["hire_date"] + "T09:00", title=c["title"], location=c["location"],
                    hire_date=clock.date(c["hire_date"]), employment=c["employment"])


def reference_info(filename: str) -> dict:
    path = config.REFERENCE_DIR / filename
    if path.is_file():
        try:
            return media.probe(path)
        except Exception as exc:
            print(f"note: could not probe {filename}: {exc}")
    return {"duration_s": 0, "width": 0, "height": 0, "fps": 0}


def insert_skills(conn, clock: Clock) -> None:
    created = clock.at(S.SKILLS_CREATED)
    for skill in S.SKILLS:
        video_id = None
        if skill["reference_file"]:
            video_id = uid(f"video:ref:{skill['slug']}")
            info = reference_info(skill["reference_file"])
            conn.execute(
                """INSERT INTO videos (id, kind, original_name, path, duration_s, width, height, fps, recorded_at,
                                       org_id, uploaded_by)
                   VALUES (%s,'reference',%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (video_id, skill["reference_file"], repo.NO_FILE, info["duration_s"], info["width"],
                 info["height"], info["fps"], created, ORG, uid("user:p.chen")))
        conn.execute(
            """INSERT INTO skills (id, slug, name, category, summary, version, order_matters, safety_criteria, people,
                                   classification, notes, reference_video_id, created_at, updated_at, org_id, guide)
               VALUES (%s,%s,%s,%s,%s,1,true,%s,'[]','{}','',%s,%s,%s,%s,%s)""",
            (uid(f"skill:{skill['slug']}"), skill["slug"], skill["name"], skill["category"], skill["summary"],
             db.J(S.safety_criteria(skill)), video_id, created, created, ORG, db.J(skill["guide"])))
        for i, step in enumerate(skill["steps"], start=1):
            conn.execute(
                """INSERT INTO skill_steps (id, skill_id, step_id, ord, title, description, start_s, end_s, critical,
                                            order_dependent, must_follow, evals)
                   VALUES (%s,%s,%s,%s,%s,%s,0,0,%s,true,'[]',%s)""",
                (uid(f"step:{skill['slug']}:s{i}"), uid(f"skill:{skill['slug']}"), f"s{i}", i, step["title"],
                 step["description"], step["critical"], db.J(step["evals"])))


def step_rows(skill: dict, duration: float, located: list[tuple]) -> list[dict]:
    """located: (step_id, at_s, mock status, feedback, evidence|None), one per canonical step.
    Each step runs until the next one starts; the last one until the end of the video."""
    ids = [f"s{i}" for i in range(1, len(skill["steps"]) + 1)]
    got = sorted(located, key=lambda r: r[1])
    if sorted(r[0] for r in got) != sorted(ids):
        raise ValueError(f"{skill['name']}: attempt rows {[r[0] for r in got]} do not cover steps {ids}")
    rows = []
    for i, (step_id, start, mock_status, feedback, evidence) in enumerate(got):
        end = got[i + 1][1] if i + 1 < len(got) else duration
        if not 0 <= start < end <= duration:
            raise ValueError(f"{skill['name']} {step_id}: bad span {start}-{end} in a {duration}s video")
        status = S.STATUS[mock_status]
        rows.append({"step_id": step_id, "start_s": start, "end_s": end, "performed_index": i + 1, "status": status,
                     "confidence": S.CONFIDENCE[status], "feedback": feedback, "evidence": evidence or feedback})
    return rows


def even_rows(skill: dict, duration: float, failed=(), unverified: dict | None = None) -> list[dict]:
    """Every step in order, evenly spaced: failed ones get the skill's 'missed' text, the rest 'seen'."""
    n = len(skill["steps"])
    located = []
    for i, step in enumerate(skill["steps"], start=1):
        sid = f"s{i}"
        at = round(1 + (i - 1) * (duration - 6) / n, 1)
        if sid in failed:
            located.append((sid, at, "failed", step["missed"], None))
        elif unverified and sid in unverified:
            located.append((sid, at, "needs_review", *unverified[sid]))
        else:
            located.append((sid, at, "passed", step["seen"], None))
    return step_rows(skill, duration, located)


def insert_attempt(conn, *, key: str, skill: dict, caregiver: tuple, created: dt.datetime, duration: float,
                   steps: list[dict], status: str, overall_feedback: str, reasons: list[str],
                   review: dict | None = None, flags: list[dict] = (), extras: dict | None = None) -> dict:
    """review: {by, at, outcome ('passed' approves, 'failed' asks for retraining), note}."""
    video_id, attempt_id = uid(f"video:{key}"), uid(f"attempt:{key}")
    caregiver_id, caregiver_name = caregiver
    conn.execute(
        """INSERT INTO videos (id, kind, original_name, path, duration_s, recorded_at, org_id, uploaded_by)
           VALUES (%s,'attempt','',%s,%s,%s,%s,%s)""",
        (video_id, repo.NO_FILE, duration, created, ORG, caregiver_id))
    passed = sum(1 for s in steps if s["status"] == "passed")
    conn.execute(
        """INSERT INTO attempts (id, skill_id, video_id, caregiver_name, caregiver_id, status, score_pct, reasons,
                                 needs_review, people, overall_feedback, skill_match, nurse_status, nurse_note,
                                 reviewed_at, reviewed_by, created_at, extras)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'[]',%s,true,%s,%s,%s,%s,%s,%s)""",
        (attempt_id, uid(f"skill:{skill['slug']}"), video_id, caregiver_name, caregiver_id, status,
         round(100 * passed / len(steps)), db.J(reasons), review is None, overall_feedback,
         review and review["outcome"], review["note"] if review else "", review and review["at"],
         review and uid(f"user:{review['by']}"), created, db.J(extras or {})))
    for s in steps:
        conn.execute(
            """INSERT INTO attempt_steps (id, attempt_id, step_id, found, start_s, end_s, performed_index,
                                          timeline_confidence, status, confidence, feedback, evidence,
                                          evidence_start_s, evidence_end_s)
               VALUES (%s,%s,%s,true,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (uid(f"astep:{key}:{s['step_id']}"), attempt_id, s["step_id"], s["start_s"], s["end_s"],
             s["performed_index"], s["confidence"], s["status"], s["confidence"], s["feedback"], s["evidence"],
             s["start_s"], s["end_s"]))
    for i, f in enumerate(flags):
        if not 0 <= f["t"] < duration:
            raise ValueError(f"{key}: flag at {f['t']}s is outside the {duration}s video")
        conn.execute(
            """INSERT INTO safety_flags (id, video_id, attempt_id, kind, severity, start_s, end_s, person_label,
                                         description, source, counts_toward_score, created_at, title)
               VALUES (%s,%s,%s,%s,%s,%s,%s,NULL,%s,'gemini',true,%s,%s)""",
            (uid(f"flag:{key}:{i}"), video_id, attempt_id, f["kind"], S.SEVERITY[f["severity"]], f["t"],
             min(f["t"] + 3, duration), f["detail"], created, f["title"]))
    return {"video_id": video_id, "created": created, "duration": duration}


def insert_attempts(conn, clock: Clock) -> list[tuple]:
    """All attempts. Returns (video_id, recorded_at, duration, balance points) for pose data."""
    roster = {c["key"]: (uid(f"user:{c['key']}"), c["name"]) for c in S.ROSTER}
    pose = []

    for p in S.PENDING:  # 1. the nurse mock's pending submissions
        skill = S.SKILL_BY_KEY[p["skill"]]
        movement = [{**m, "status": S.STATUS[m["status"]]} for m in p["movement"]]
        made = insert_attempt(
            conn, key=p["id"], skill=skill, caregiver=roster[p["caregiver"]], created=clock.at(p["submitted_at"]),
            duration=p["duration"], steps=step_rows(skill, p["duration"], p["steps"]),
            status=S.AI_STATUS[p["ai_assessment"]], overall_feedback=p["summary"], reasons=[p["recommendation"]],
            flags=p["flags"], extras={"movement": movement})
        pose.append((made["video_id"], made["created"], p["duration"], p["balance"]))

    for v in S.VERIFIED_RECORDS:  # 2. the nurse mock's verified records
        skill = S.SKILL_BY_KEY[v["skill"]]
        insert_attempt(
            conn, key=v["id"], skill=skill, caregiver=roster[v["caregiver"]], created=clock.at(v["submitted_at"]),
            duration=v["duration"], steps=even_rows(skill, v["duration"], unverified=v.get("unverified")),
            status=S.AI_STATUS[v["ai_assessment"]], overall_feedback=v["summary"], reasons=[],
            review={"by": S.APPROVERS[v["approver"]], "at": clock.at(v["approved_at"]), "outcome": "passed",
                    "note": v["notes"]})

    sarah = (uid(f"user:{S.SARAH_CHEN['key']}"), S.SARAH_CHEN["name"])
    for a in S.SARAH_CHEN_ATTEMPTS:  # 3. the caregiver mock
        skill = S.SKILL_BY_KEY[a["skill"]]
        steps = step_rows(skill, a["duration"], a["steps"])
        status = "passed" if all(s["status"] == "passed" for s in steps) else "unverified"
        review = a["review"] and {**a["review"], "at": clock.at(a["review"]["at"])}
        insert_attempt(conn, key=a["id"], skill=skill, caregiver=sarah, created=clock.at(a["created"]),
                       duration=a["duration"], steps=steps, status=status, overall_feedback=a["summary"],
                       reasons=a["reasons"], review=review)

    history = [S.MARCUS_BATHING]  # 4. older approvals, so verified counts match skillsCompleted
    for c in S.ROSTER:
        history += S.historical_schedule(c["key"], c["hire_date"], S.HISTORICAL_VERIFIED[c["key"]])
    for h in history:
        skill = S.SKILL_BY_KEY[h["skill"]]
        insert_attempt(conn, key=h["id"], skill=skill, caregiver=roster[h["caregiver"]], created=clock.at(h["created"]),
                       duration=h["duration"], steps=even_rows(skill, h["duration"]), status="passed",
                       overall_feedback="Every step matched the reference.", reasons=[],
                       review={"by": h["approver"], "at": clock.at(h["reviewed"]), "outcome": "passed",
                               "note": h["note"]})

    for i, r in enumerate(S.RETRAINING):  # 5. retraining requests behind the 30-day safety patterns
        skill = S.SKILL_BY_KEY[r["skill"]]
        duration = 36 + (i * 5) % 15
        steps = even_rows(skill, duration, failed=r["failed"])
        missed = [skill["steps"][int(sid[1:]) - 1] for sid in r["failed"]]
        created = clock.at(r["created"])
        insert_attempt(
            conn, key=r["id"], skill=skill, caregiver=roster[r["caregiver"]], created=created, duration=duration,
            steps=steps, status="failed", overall_feedback=" ".join(m["missed"] for m in missed),
            reasons=[f"Failed: {', '.join(m['title'] for m in missed)}."],
            flags=[{**f, "t": t} for t, f in r["flags"]],
            review={"by": "p.chen", "at": created + dt.timedelta(hours=S.RETRAINING_REVIEW_HOURS), "outcome": "failed",
                    "note": f"Please practise: {', '.join(m['title'].lower() for m in missed)}. "
                            "Record again when you are ready."})
    return pose


def insert_pose(pose: list[tuple]) -> int:
    """One patient track per attempt with balance points; one frame per second, interpolated."""
    total = 0
    for video_id, recorded_at, duration, points in pose:
        rows = []
        for t in range(int(duration) + 1):
            score = interpolate(points, t) / 100
            rows.append({"person_idx": 0, "t_offset": t, "valid": True, "balance_score": score,
                         "com_offset": 1 - score})
        tracks = [{"person_idx": 0, "segment_id": 0, "role": "patient", "first_t": 0, "last_t": rows[-1]["t_offset"],
                   "n_frames": len(rows), "mean_visibility": None}]
        total += repo.replace_pose(video_id, recorded_at, rows, tracks)
    return total


def interpolate(points: list[tuple], t: float) -> float:
    if t <= points[0][0]:
        return points[0][1]
    for (t0, v0), (t1, v1) in zip(points, points[1:]):
        if t0 <= t <= t1:
            return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
    return points[-1][1]


# --- checks -----------------------------------------------------------------------------
def checks(clock: Clock, logins: list[dict], before: dict[str, set], after: dict[str, set]) -> list[str]:
    failures: list[str] = []

    def check(ok: bool, label: str) -> None:
        print(f"  [{'ok' if ok else 'FAIL'}] {label}")
        if not ok:
            failures.append(label)

    nurse = auth.get_user(uid("user:p.chen"))
    sarah = auth.get_user(uid("user:s.chen"))
    attempts = repo.list_attempts(org_id=ORG)
    skills = people._skills_by_slug(ORG)
    roster = {p["name"]: p for p in people._caregiver_rows(ORG, attempts, skills)}
    overview = people.overview(user=nurse)
    mine = people.my_skills(user=sarah)

    pending = [a for a in attempts if a["review_state"] == "pending"]
    check(len(pending) == S.EXPECTED_PENDING, f"pending attempts: {len(pending)} (expect {S.EXPECTED_PENDING})")
    newest = max(a["created_at"] for a in pending)
    age_min = (clock.now - newest).total_seconds() / 60
    check(abs(age_min - S.NEWEST_PENDING_MINUTES) < 2, f"newest pending submission is {age_min:.1f} min old "
                                                       f"(expect ~{S.NEWEST_PENDING_MINUTES})")
    latest = max(max(a["created_at"], a["reviewed_at"] or a["created_at"]) for a in attempts)
    check(latest <= dt.datetime.now(dt.timezone.utc), "no attempt or review is in the future")

    print("  roster (skills_verified / expected, in review, open flags, status):")
    for c in S.ROSTER:
        row = roster[c["name"]]
        ok = row["skills_verified"] == c["skills_completed"]
        print(f"    {'ok  ' if ok else 'FAIL'} {c['name']:<16} {row['skills_verified']}/{c['skills_completed']}  "
              f"in_review={row['skills_in_review']}  open_flags={row['open_flags']}  {row['status']}")
        if not ok:
            failures.append(f"{c['name']} verified {row['skills_verified']} != {c['skills_completed']}")
    early = db.fetch_all(
        """SELECT u.name, a.created_at, u.hire_date FROM attempts a JOIN users u ON u.id = a.caregiver_id
           WHERE u.org_id=%s AND u.hire_date IS NOT NULL AND a.created_at::date < u.hire_date""", (ORG,))
    check(not early, f"no attempt before the caregiver's hire date ({len(early)} found)")

    restricted = {name for name, row in roster.items() if row["status"] == "restricted"}
    check(restricted == S.EXPECTED_RESTRICTED, f"restricted: {sorted(restricted)}")

    counts = {k: mine["counts"][k] for k in S.EXPECTED_SARAH_CHEN}
    check(counts == S.EXPECTED_SARAH_CHEN, f"Sarah Chen's skills: {counts}")
    print("    " + "; ".join(f"{s['name']}={s['state']}" for s in mine["skills"]))

    missed = [(m["label"], m["skill_name"], m["count"]) for m in overview["missed_steps"]]
    print("  missed steps (30 days):")
    for m in missed:
        print(f"    {m[2]:>3}  {m[0]}  ({m[1]})")
    check(missed == S.TARGET_MISSED_STEPS, "missed steps match the mock's order and counts")
    flagged = [(f["name"], f["flags"]) for f in overview["flagged_skills"]]
    print("  flagged skills (30 days):")
    for f in flagged:
        print(f"    {f[1]:>3}  {f[0]}")
    check(flagged == S.TARGET_FLAGGED_SKILLS, "flagged skills match the mock's order and counts")
    others = db.fetch_all(
        """SELECT s.name, count(*) AS n FROM safety_flags f JOIN attempts a ON a.id = f.attempt_id
           JOIN skills s ON s.id = a.skill_id
           WHERE s.org_id=%s AND a.created_at >= %s AND f.counts_toward_score GROUP BY s.name""",
        (ORG, clock.now - dt.timedelta(days=people.PATTERN_DAYS)))
    top = {name for name, _ in S.TARGET_FLAGGED_SKILLS}
    check(all(r["n"] <= 1 for r in others if r["name"] not in top), "no other skill has more than 1 flag")
    sixth = db.fetch_all(
        """SELECT st.title, s.name, count(*) AS n
           FROM attempt_steps x JOIN attempts a ON a.id = x.attempt_id JOIN skills s ON s.id = a.skill_id
           JOIN skill_steps st ON st.skill_id = s.id AND st.step_id = x.step_id
           WHERE s.org_id=%s AND a.created_at >= %s AND coalesce(x.nurse_status, x.status) = 'failed'
           GROUP BY st.title, s.name ORDER BY count(*) DESC OFFSET 5 LIMIT 1""",
        (ORG, clock.now - dt.timedelta(days=people.PATTERN_DAYS)))
    worst = sixth[0]["n"] if sixth else 0
    check(worst < 4, f"no other (step, skill) failed 4+ times (next highest: {worst})")
    print(f"  overview counts: {overview['counts']}  verification_rate={overview['verification_rate']}")
    print(f"  notifications: {len(overview['notifications'])} ({overview['unread']} unread); activity:")
    for e in overview["activity"]:
        print(f"    {e['time']:%m-%d %H:%M}  {e['type']:<16} {e['detail']}")

    for kept in logins:
        now = db.fetch_one("SELECT username, password_hash FROM users WHERE id=%s", (kept["id"],))
        check(bool(now) and (now["username"], now["password_hash"]) == (kept["username"], kept["password_hash"]),
              f"login {kept['username']} kept its password")

    if before["users"]:
        same = before == after
        print(f"  [info] same ids as the previous seed: {'yes' if same else 'no'}")
        if not same:
            for table in OWNED:
                if before[table] != after[table]:
                    print(f"         {table}: {len(before[table] - after[table])} gone, "
                          f"{len(after[table] - before[table])} new")
    else:
        print("  [info] first seed (nothing to compare ids with)")
    return failures


def main() -> int:
    db.migrate()
    clash = db.fetch_all("SELECT email FROM users WHERE org_id<>%s AND email = ANY(%s)",
                         (ORG, [n["email"] for n in S.NURSES] + [S.SARAH_CHEN["email"]]
                          + [S.email_for(c["name"]) for c in S.ROSTER]))
    if clash:
        print(f"Cannot seed: these emails belong to another agency: {[r['email'] for r in clash]}")
        return 1

    before = snapshot()
    before_frames = pose_frame_count()
    old_window = db.fetch_one(
        "SELECT min(ts) AS lo, max(ts) AS hi FROM pose_frames WHERE video_id IN (SELECT id FROM videos WHERE org_id=%s)",
        (ORG,))
    # The logins scripts/logins.py gave to people of this agency, to put back after the reset.
    logins = db.fetch_all("SELECT id, username, password_hash FROM users WHERE org_id=%s AND username IS NOT NULL",
                          (ORG,))
    clock = Clock(dt.datetime.now(dt.timezone.utc))
    with db.tx() as conn:  # one transaction: a failed seed leaves the previous one in place
        delete_sample(conn)
        insert_people(conn, clock)
        for kept in logins:
            conn.execute("UPDATE users SET username=%s, password_hash=%s WHERE id=%s",
                         (kept["username"], kept["password_hash"], kept["id"]))
        insert_skills(conn, clock)
        pose = insert_attempts(conn, clock)
    frames = insert_pose(pose)
    refresh_rollup(old_window["lo"], old_window["hi"])
    auth.forget_cached()

    after = snapshot()
    print(f"Seeded {S.ORG_NAME} (org {ORG}); mock time shifted by {clock.shift}")
    for table in OWNED:
        print(f"  {table:<14} {len(after[table]):>5}" + (f"   (was {len(before[table])})" if before["users"] else ""))
    print(f"  {'pose_frames':<14} {frames:>5}" + (f"   (was {before_frames})" if before["users"] else ""))
    if logins:
        print(f"Logins kept: {', '.join(sorted(kept['username'] for kept in logins))} (passwords are in LOGINS.md)")
    else:
        print("Nobody in this agency can log in yet. Run `make logins` to make the logins.")
    print("Checks:")
    failures = checks(clock, logins, before, after)
    if failures:
        print(f"{len(failures)} check(s) failed")
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        db.close()
