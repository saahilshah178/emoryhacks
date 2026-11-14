"""Persistence for the shared contracts in models.py.

Stages return pydantic models; the pipeline runner calls these functions to store
them. Each save replaces what a previous run of the same stage wrote, so stages
can be re-run safely.
"""
from __future__ import annotations

import datetime as dt
import os
import socket
import threading
import uuid
from pathlib import Path
from typing import Any, Iterable

from . import config, db, media, progress
from .models import (
    Classification, Evaluation, PersonObs, Rubric, RubricStep, SafetyFlag, Score, StepEval, Timeline,
)

POSE_COLUMNS = [
    "ts", "video_id", "person_idx", "t_offset", "segment_id", "valid", "visibility",
    "bbox_x0", "bbox_y0", "bbox_x1", "bbox_y1",
    "l_elbow", "r_elbow", "l_shoulder", "r_shoulder", "l_hip", "r_hip", "l_knee", "r_knee",
    "l_ankle", "r_ankle", "trunk_tilt", "trunk_lateral",
    "com_x", "com_y", "bos_center_x", "bos_width", "com_offset", "sway_velocity", "balance_score",
]
# Columns a pose stage supplies per row; ts and video_id are filled in here.
POSE_ROW_KEYS = [c for c in POSE_COLUMNS if c not in ("ts", "video_id")]


# --- videos ---------------------------------------------------------------
DEFAULT_ORG = uuid.UUID("00000000-0000-0000-0000-000000000001")
# Stored as the path of a video row that has no file (sample data).
NO_FILE = "none://no-file"


def create_video(kind: str, path: str, original_name: str, info: dict, video_id: uuid.UUID | None = None,
                 org_id=None, uploaded_by=None) -> dict:
    video_id = video_id or uuid.uuid4()
    db.execute(
        """INSERT INTO videos (id, kind, original_name, path, duration_s, width, height, fps, org_id, uploaded_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (video_id, kind, original_name, path, info.get("duration_s", 0), info.get("width", 0),
         info.get("height", 0), info.get("fps", 0), org_id or DEFAULT_ORG, uploaded_by),
    )
    return get_video(video_id)


def video_available(video: dict | None) -> bool:
    """Whether this machine can play the video: its file is here, or can be rebuilt from reference_vids/."""
    if not video:
        return False
    if video["path"] != NO_FILE and Path(video["path"]).is_file():
        return True
    if media.video_path(video["id"]).is_file():
        return True
    name = video.get("original_name") or ""
    return bool(name) and (config.REFERENCE_DIR / name).is_file()


def _with_availability(video: dict | None) -> dict | None:
    if video is not None:
        video["available"] = video_available(video)
    return video


_PRIVATE_VIDEO_KEYS = ("path", "gemini_file_name", "gemini_file_uri", "gemini_file_expires")


def public(payload):
    """A skill, attempt or video as the API returns it: without the server's file paths and
    Gemini file handles. Returns the same object, changed in place."""
    if isinstance(payload, dict):
        for key in ("video", "reference_video"):
            if isinstance(payload.get(key), dict):
                payload[key] = {k: v for k, v in payload[key].items() if k not in _PRIVATE_VIDEO_KEYS}
        if "kind" in payload and "path" in payload:  # a video row itself
            for key in _PRIVATE_VIDEO_KEYS:
                payload.pop(key, None)
    return payload


def get_video(video_id) -> dict | None:
    return db.fetch_one("SELECT * FROM videos WHERE id=%s", (video_id,))


_file_locks: dict[str, threading.Lock] = {}
_file_locks_guard = threading.Lock()


def ensure_video_file(video: dict) -> dict:
    """Make sure the video's MP4 exists on this machine and return the row with a usable path.

    The database is shared (Tiger Cloud) but video files live on the machine that ingested
    them. A teammate's checkout therefore has the rows without the files. Reference videos
    can be rebuilt from reference_vids/, which is in the repository; anything else recorded
    on another machine cannot, and raises media.MediaError saying so."""
    if video["path"] != NO_FILE and Path(video["path"]).is_file():
        return video
    with _file_locks_guard:
        lock = _file_locks.setdefault(str(video["id"]), threading.Lock())
    with lock:
        local = media.video_path(video["id"])
        if not local.exists():
            source = config.REFERENCE_DIR / (video.get("original_name") or "")
            if not (video.get("original_name") and source.is_file()):
                raise media.MediaError(
                    "This video was recorded on another machine and its file is not on this one.")
            config.ensure_dirs()
            media.normalize(source, local)
        db.execute("UPDATE videos SET path=%s WHERE id=%s", (str(local), video["id"]))
        video["path"] = str(local)
    return video


# --- skills ---------------------------------------------------------------
def create_skill(classification: Classification, rubric: Rubric, video_id, slug: str | None = None,
                 name: str | None = None, org_id=None) -> uuid.UUID:
    """Store a new skill version with its steps. slug/name override the classifier's."""
    slug = slug or classification.skill_slug
    skill_id = uuid.uuid4()
    with db.tx() as conn:
        # The skill belongs to the agency that owns its reference video. A new version of a
        # skill keeps the caregiver-facing copy a nurse wrote for the previous one.
        owner = conn.execute("SELECT org_id FROM videos WHERE id=%s", (video_id,)).fetchone() if video_id else None
        org_id = org_id or (owner["org_id"] if owner else DEFAULT_ORG)
        row = conn.execute(
            """SELECT coalesce(max(version), 0) AS v,
                      (SELECT guide FROM skills WHERE org_id=%s AND slug=%s ORDER BY version DESC LIMIT 1) AS guide
               FROM skills WHERE org_id=%s AND slug=%s""", (org_id, slug, org_id, slug)).fetchone()
        conn.execute(
            """INSERT INTO skills (id, slug, name, category, summary, version, order_matters, safety_criteria,
                                   people, classification, notes, reference_video_id, org_id, guide)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (skill_id, slug, name or classification.skill_name, classification.category, classification.summary,
             row["v"] + 1, rubric.order_matters, db.J(rubric.safety_criteria),
             db.J([p.model_dump() for p in classification.people]), db.J(classification.model_dump()),
             rubric.notes, video_id, org_id, db.J(row["guide"] or {})),
        )
        _insert_steps(conn, skill_id, rubric.steps)
    return skill_id


def _insert_steps(conn, skill_id, steps: list[RubricStep]) -> None:
    for s in steps:
        conn.execute(
            """INSERT INTO skill_steps (id, skill_id, step_id, ord, title, description, start_s, end_s,
                                        critical, order_dependent, must_follow, evals)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (uuid.uuid4(), skill_id, s.step_id, s.order, s.title, s.description, s.start_s, s.end_s,
             s.critical, s.order_dependent, db.J(s.must_follow), db.J(s.evals.model_dump())),
        )


def replace_rubric(skill_id, rubric: Rubric) -> None:
    with db.tx() as conn:
        conn.execute("DELETE FROM skill_steps WHERE skill_id=%s", (skill_id,))
        conn.execute(
            "UPDATE skills SET order_matters=%s, safety_criteria=%s, notes=%s, updated_at=now() WHERE id=%s",
            (rubric.order_matters, db.J(rubric.safety_criteria), rubric.notes, skill_id),
        )
        _insert_steps(conn, skill_id, rubric.steps)


def list_skills(all_versions: bool = False, org_id=None) -> list[dict]:
    """Skills, newest version of each by default. Rebuilding a rubric adds a version.
    org_id limits the list to one agency; scripts leave it out to see every agency's."""
    where, params = [], []
    if not all_versions:
        where.append("s.version = (SELECT max(version) FROM skills x WHERE x.slug = s.slug AND x.org_id = s.org_id)")
    if org_id:
        where.append("s.org_id = %s")
        params.append(org_id)
    rows = db.fetch_all(
        f"""SELECT s.id, s.org_id, s.slug, s.name, s.category, s.summary, s.version, s.order_matters, s.guide,
                  s.reference_video_id, s.created_at, s.updated_at, v.duration_s,
                  (SELECT count(*) FROM skill_steps st WHERE st.skill_id = s.id) AS step_count,
                  (SELECT coalesce(sum(greatest(st.end_s - st.start_s, 0)), 0) FROM skill_steps st
                    WHERE st.skill_id = s.id) AS steps_s,
                  (SELECT count(*) FROM attempts a WHERE a.skill_id = s.id) AS attempt_count,
                  (SELECT count(*) FROM attempts a WHERE a.skill_id = s.id AND a.submitted_at IS NOT NULL)
                    AS submission_count
           FROM skills s LEFT JOIN videos v ON v.id = s.reference_video_id
           {"WHERE " + " AND ".join(where) if where else ""}
           ORDER BY s.name, s.version DESC""",
        params,
    )
    for row in rows:
        row["guide"] = skill_guide(row, steps=None, steps_s=row.pop("steps_s"))
    _attach_policies(rows)
    return rows


def _attach_policies(skills: list[dict]) -> None:
    """Add policy {max_attempts, submit_pct, force_pct, assign_all, assigned_count} to skill rows."""
    for org_id in {s["org_id"] for s in skills}:
        policies = all_policies(org_id)
        caregiver_count = db.fetch_one("SELECT count(*) AS n FROM users WHERE org_id=%s AND role='caregiver'",
                                       (org_id,))["n"]
        picked = {r["slug"]: r["n"] for r in db.fetch_all(
            """SELECT x.slug, count(*) AS n FROM skill_assignments x JOIN users u ON u.id = x.caregiver_id
               WHERE x.org_id=%s AND x.assigned AND u.role='caregiver' AND u.org_id = x.org_id
               GROUP BY x.slug""", (org_id,))}
        for s in skills:
            if s["org_id"] != org_id:
                continue
            pol = policies.get((org_id, s["slug"])) or progress.policy(None)
            s["policy"] = {**pol, "assigned_count": caregiver_count if pol["assign_all"] else picked.get(s["slug"], 0)}


def get_skill(skill_id) -> dict | None:
    skill = db.fetch_one("SELECT * FROM skills WHERE id=%s", (skill_id,))
    if not skill:
        return None
    skill["steps"] = db.fetch_all("SELECT * FROM skill_steps WHERE skill_id=%s ORDER BY ord", (skill_id,))
    skill["video"] = _with_availability(get_video(skill["reference_video_id"])) if skill["reference_video_id"] else None
    newest = db.fetch_one("SELECT id FROM skills WHERE slug=%s AND org_id=%s ORDER BY version DESC LIMIT 1",
                          (skill["slug"], skill["org_id"]))
    skill["latest_id"] = newest["id"]
    skill["versions"] = db.fetch_all(
        """SELECT s.id, s.version, s.created_at,
                  (SELECT count(*) FROM skill_steps st WHERE st.skill_id = s.id) AS step_count,
                  (SELECT count(*) FROM attempts a WHERE a.skill_id = s.id) AS attempt_count
           FROM skills s WHERE s.slug=%s AND s.org_id=%s ORDER BY s.version DESC""", (skill["slug"], skill["org_id"]))
    skill["guide"] = skill_guide(skill, steps=skill["steps"])
    return skill


def skill_guide(skill: dict, steps: list[dict] | None, steps_s: float | None = None) -> dict:
    """What a caregiver reads before recording: the nurse's own copy where it was written
    (skills.guide), and otherwise text and timings taken from the rubric.

    cues are prompts shown while recording, at the time each step starts in the reference."""
    own = skill.get("guide") or {}
    summary = (skill.get("summary") or "").strip()
    first_sentence = summary.split(". ")[0].rstrip(".") + "." if summary else ""
    if steps is not None:
        steps_s = sum(max((s["end_s"] or 0) - (s["start_s"] or 0), 0) for s in steps)
    guide = {
        "description": own.get("description") or first_sentence,
        "explanation": own.get("explanation") or summary,
        "safety_reminder": own.get("safety_reminder") or next(iter(skill.get("safety_criteria") or []), ""),
        "estimated_minutes": own.get("estimated_minutes") or max(1, round((steps_s or 0) / 60)),
    }
    if steps is not None:
        guide["cues"] = own.get("cues") or [
            {"at_s": round(s["start_s"], 1), "message": s["title"]}
            for s in steps if (s["end_s"] or 0) > (s["start_s"] or 0)]
    return guide


def get_rubric(skill_id) -> Rubric:
    skill = get_skill(skill_id)
    if not skill:
        raise KeyError(f"skill {skill_id} not found")
    steps = [
        RubricStep(
            step_id=s["step_id"], order=s["ord"], title=s["title"], description=s["description"],
            start_s=s["start_s"], end_s=s["end_s"], critical=s["critical"], order_dependent=s["order_dependent"],
            must_follow=s["must_follow"] or [], evals=StepEval(**(s["evals"] or {"pass_criteria": [], "fail_criteria": [], "unverified_when": []})),
        )
        for s in skill["steps"]
    ]
    return Rubric(steps=steps, safety_criteria=skill["safety_criteria"] or [], order_matters=skill["order_matters"],
                  notes=skill["notes"])


def patch_skill(skill_id, fields: dict[str, Any]) -> None:
    allowed = {"name", "summary", "order_matters", "safety_criteria", "guide"}
    sets, params = [], []
    for key, value in fields.items():
        if key in allowed and value is not None:
            sets.append(f"{key}=%s")
            params.append(db.J(value) if key in ("safety_criteria", "guide") else value)
    if sets:
        db.execute(f"UPDATE skills SET {', '.join(sets)}, updated_at=now() WHERE id=%s", (*params, skill_id))


def patch_step(skill_id, step_id: str, fields: dict[str, Any]) -> int:
    allowed = {"title", "description", "critical", "order_dependent", "must_follow", "start_s", "end_s", "evals"}
    sets, params = [], []
    for key, value in fields.items():
        if key in allowed and value is not None:  # an empty must_follow list clears the prerequisites
            sets.append(f"{key}=%s")
            params.append(db.J(value) if key in ("evals", "must_follow") else value)
    if not sets:
        return 0
    n = db.execute(f"UPDATE skill_steps SET {', '.join(sets)} WHERE skill_id=%s AND step_id=%s",
                   (*params, skill_id, step_id))
    db.execute("UPDATE skills SET updated_at=now() WHERE id=%s", (skill_id,))
    return n


def delete_skill(skill_id) -> int:
    return db.execute("DELETE FROM skills WHERE id=%s", (skill_id,))


# --- attempts -------------------------------------------------------------
def create_attempt(skill_id, video_id, caregiver_name: str = "", caregiver_id=None) -> uuid.UUID:
    """A caregiver's attempt stays with them until they send it (submit_attempt). One with no
    caregiver account, uploaded by a nurse or a script, counts as sent when it is created."""
    attempt_id = uuid.uuid4()
    with db.tx() as conn:
        conn.execute(
            """INSERT INTO attempts (id, skill_id, video_id, caregiver_name, caregiver_id, submitted_at, submit_kind)
               VALUES (%s,%s,%s,%s,%s, CASE WHEN %s THEN NULL ELSE now() END,
                       CASE WHEN %s THEN NULL ELSE 'standard' END)""",
            (attempt_id, skill_id, video_id, caregiver_name, caregiver_id,
             caregiver_id is not None, caregiver_id is not None))
        steps = conn.execute("SELECT step_id FROM skill_steps WHERE skill_id=%s ORDER BY ord", (skill_id,)).fetchall()
        for s in steps:
            conn.execute("INSERT INTO attempt_steps (id, attempt_id, step_id) VALUES (%s,%s,%s)",
                         (uuid.uuid4(), attempt_id, s["step_id"]))
    return attempt_id


def _ensure_attempt_step(conn, attempt_id, step_id: str) -> None:
    conn.execute(
        "INSERT INTO attempt_steps (id, attempt_id, step_id) VALUES (%s,%s,%s) ON CONFLICT (attempt_id, step_id) DO NOTHING",
        (uuid.uuid4(), attempt_id, step_id),
    )


def save_timeline(attempt_id, timeline: Timeline) -> None:
    with db.tx() as conn:
        for s in timeline.steps:
            _ensure_attempt_step(conn, attempt_id, s.step_id)
            conn.execute(
                """UPDATE attempt_steps SET found=%s, start_s=%s, end_s=%s, performed_index=%s,
                          timeline_confidence=%s, timeline_note=%s
                   WHERE attempt_id=%s AND step_id=%s""",
                (s.found, s.start_s, s.end_s, s.performed_index, s.confidence, s.note, attempt_id, s.step_id),
            )
        conn.execute("DELETE FROM order_violations WHERE attempt_id=%s", (attempt_id,))
        for v in timeline.order_violations:
            conn.execute(
                "INSERT INTO order_violations (id, attempt_id, step_id, expected_after, message, at_s) VALUES (%s,%s,%s,%s,%s,%s)",
                (uuid.uuid4(), attempt_id, v.step_id, v.expected_after, v.message, v.at_s),
            )


def save_evaluation(attempt_id, video_id, evaluation: Evaluation) -> None:
    with db.tx() as conn:
        for s in evaluation.steps:
            _ensure_attempt_step(conn, attempt_id, s.step_id)
            conn.execute(
                """UPDATE attempt_steps SET status=%s, confidence=%s, feedback=%s, evidence=%s,
                          evidence_start_s=%s, evidence_end_s=%s, double_checked=%s
                   WHERE attempt_id=%s AND step_id=%s""",
                (s.status, s.confidence, s.feedback, s.evidence, s.evidence_start_s, s.evidence_end_s,
                 s.double_checked, attempt_id, s.step_id),
            )
        conn.execute(
            "UPDATE attempts SET people=%s, overall_feedback=%s, skill_match=%s, skill_match_note=%s WHERE id=%s",
            (db.J([p.model_dump() for p in evaluation.people]), evaluation.overall_feedback,
             evaluation.skill_match, evaluation.skill_match_note, attempt_id),
        )
    save_flags(video_id, attempt_id, evaluation.safety_flags, sources=("gemini",))


def save_flags(video_id, attempt_id, flags: list[SafetyFlag], sources: tuple[str, ...]) -> None:
    """Replace the flags from the given sources for this video/attempt."""
    with db.tx() as conn:
        if attempt_id is not None:
            conn.execute("DELETE FROM safety_flags WHERE attempt_id=%s AND source = ANY(%s)", (attempt_id, list(sources)))
        else:
            conn.execute("DELETE FROM safety_flags WHERE video_id=%s AND attempt_id IS NULL AND source = ANY(%s)",
                         (video_id, list(sources)))
        for f in flags:
            conn.execute(
                """INSERT INTO safety_flags (id, video_id, attempt_id, kind, severity, start_s, end_s, person_label,
                                             description, source, counts_toward_score)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (uuid.uuid4(), video_id, attempt_id, f.kind, f.severity, f.start_s, f.end_s, f.person_label,
                 f.description, f.source, f.counts_toward_score),
            )


def get_flags(attempt_id) -> list[SafetyFlag]:
    rows = db.fetch_all("SELECT * FROM safety_flags WHERE attempt_id=%s ORDER BY start_s", (attempt_id,))
    return [SafetyFlag(**{k: r[k] for k in SafetyFlag.model_fields}) for r in rows]


def save_score(attempt_id, score: Score) -> None:
    """Store the AI result. A nurse who reviewed while the job was still running keeps the last word."""
    db.execute(
        "UPDATE attempts SET status=%s, score_pct=%s, reasons=%s, "
        "needs_review = (%s AND reviewed_at IS NULL) WHERE id=%s",
        (score.overall, score.score_pct, db.J(score.reasons), score.needs_nurse_review, attempt_id),
    )


# Whether the same caregiver sent a later attempt at the same skill (any version), which makes
# an unreviewed submission "superseded" (progress.review_state). Needs a (attempts) and s (skills).
_NEWER_SUBMISSION = """(a.caregiver_id IS NOT NULL AND a.submitted_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM attempts b JOIN skills bs ON bs.id = b.skill_id
    WHERE b.caregiver_id = a.caregiver_id AND bs.org_id = s.org_id AND bs.slug = s.slug
      AND b.submitted_at IS NOT NULL AND b.id <> a.id
      AND (b.submitted_at, b.created_at, b.id) > (a.submitted_at, a.created_at, a.id))) AS newer_submission"""


def list_attempts(skill_id=None, org_id=None, caregiver_id=None, state: str | None = None,
                  slug: str | None = None, submitted_only: bool = False) -> list[dict]:
    """Attempts, newest first, each with review_state, ai_assessment and submission (see
    progress.py). org_id limits the list to one agency; slug to one skill across its versions;
    submitted_only to attempts sent to a nurse (or uploaded by one); state keeps one review_state."""
    where, params = [], []
    for column, value in (("a.skill_id", skill_id), ("s.org_id", org_id), ("a.caregiver_id", caregiver_id),
                          ("s.slug", slug)):
        if value:
            where.append(f"{column}=%s")
            params.append(value)
    if submitted_only:
        where.append("a.submitted_at IS NOT NULL")
    rows = db.fetch_all(
        f"""SELECT a.id, a.skill_id, a.video_id, a.caregiver_id, a.status, a.score_pct, a.needs_review,
                   a.skill_match, a.nurse_status, a.nurse_note, a.reviewed_at, a.reviewed_by, a.created_at,
                   a.submitted_at, a.submit_kind, a.submit_note, a.overall_feedback,
                   coalesce(nullif(u.name, ''), a.caregiver_name) AS caregiver_name, u.title AS caregiver_title,
                   r.name AS reviewer_name, r.credentials AS reviewer_credentials,
                   s.name AS skill_name, s.slug AS skill_slug, s.version AS skill_version, s.org_id,
                   v.duration_s,
                   (SELECT count(*) FROM safety_flags f WHERE f.attempt_id = a.id AND f.counts_toward_score) AS flag_count,
                   (SELECT coalesce(jsonb_agg(jsonb_build_object(
                             'id', f.id, 'kind', f.kind, 'title', f.title, 'description', f.description,
                             'severity', f.severity, 'start_s', f.start_s, 'end_s', f.end_s) ORDER BY f.start_s), '[]')
                      FROM safety_flags f WHERE f.attempt_id = a.id AND f.counts_toward_score) AS flags,
                   (SELECT j.status FROM jobs j WHERE j.attempt_id = a.id ORDER BY j.created_at DESC LIMIT 1) AS job_status,
                   {_NEWER_SUBMISSION}
            FROM attempts a JOIN skills s ON s.id = a.skill_id JOIN videos v ON v.id = a.video_id
            LEFT JOIN users u ON u.id = a.caregiver_id LEFT JOIN users r ON r.id = a.reviewed_by
            {"WHERE " + " AND ".join(where) if where else ""} ORDER BY a.created_at DESC""",
        params,
    )
    policies = all_policies(org_id)
    for r in rows:
        progress.describe(r)
        r["submission"] = progress.submission(r, policies.get((r["org_id"], r["skill_slug"])) or progress.policy(None))
    return [r for r in rows if r["review_state"] == state] if state else rows


HISTORY_KEYS = ("id", "created_at", "submitted_at", "submit_kind", "score_pct", "status", "final_status",
                "review_state", "skill_id", "skill_version")


def get_attempt(attempt_id) -> dict | None:
    """The attempt with its rubric steps joined to their results, violations and flags; whether
    and how it can be sent (submission); the skill's policy; the caregiver's attempts used and
    left on the skill; and their other attempts at it (history, newest first)."""
    attempt = db.fetch_one(
        f"""SELECT a.*, s.name AS skill_name, s.slug AS skill_slug, s.version AS skill_version, s.order_matters,
                  s.reference_video_id, s.org_id,
                  u.title AS caregiver_title, u.name AS caregiver_account_name,
                  r.name AS reviewer_name, r.credentials AS reviewer_credentials,
                  {_NEWER_SUBMISSION}
           FROM attempts a JOIN skills s ON s.id = a.skill_id
           LEFT JOIN users u ON u.id = a.caregiver_id LEFT JOIN users r ON r.id = a.reviewed_by
           WHERE a.id=%s""",
        (attempt_id,),
    )
    if not attempt:
        return None
    attempt["caregiver_name"] = attempt.pop("caregiver_account_name") or attempt["caregiver_name"]
    attempt["steps"] = db.fetch_all(
        """SELECT st.step_id, st.ord, st.title, st.description, st.critical, st.order_dependent, st.must_follow,
                  st.evals, st.start_s AS ref_start_s, st.end_s AS ref_end_s,
                  x.found, x.start_s, x.end_s, x.performed_index, x.timeline_confidence, x.timeline_note,
                  x.status, x.confidence, x.feedback, x.evidence, x.evidence_start_s, x.evidence_end_s,
                  x.double_checked, x.nurse_status, x.nurse_note
           FROM skill_steps st LEFT JOIN attempt_steps x ON x.step_id = st.step_id AND x.attempt_id = %s
           WHERE st.skill_id = %s ORDER BY st.ord""",
        (attempt_id, attempt["skill_id"]),
    )
    attempt["order_violations"] = db.fetch_all(
        "SELECT step_id, expected_after, message, at_s FROM order_violations WHERE attempt_id=%s ORDER BY at_s NULLS LAST",
        (attempt_id,),
    )
    attempt["safety_flags"] = db.fetch_all(
        "SELECT * FROM safety_flags WHERE attempt_id=%s ORDER BY start_s", (attempt_id,))
    attempt["video"] = _with_availability(get_video(attempt["video_id"]))
    attempt["reference_video"] = (
        _with_availability(get_video(attempt["reference_video_id"])) if attempt["reference_video_id"] else None)
    attempt["job"] = db.fetch_one(
        "SELECT id, status, stage, stages, error FROM jobs WHERE attempt_id=%s ORDER BY created_at DESC LIMIT 1",
        (attempt_id,),
    )
    attempt["job_status"] = attempt["job"]["status"] if attempt["job"] else None
    attempt["flag_count"] = sum(1 for f in attempt["safety_flags"] if f["counts_toward_score"])
    progress.describe(attempt)

    pol = get_policy(attempt["org_id"], attempt["skill_slug"])
    attempt["submission"] = progress.submission(attempt, pol)
    attempt["policy"] = {k: pol[k] for k in ("max_attempts", "submit_pct", "force_pct")}
    if attempt["caregiver_id"]:
        mine = list_attempts(org_id=attempt["org_id"], caregiver_id=attempt["caregiver_id"], slug=attempt["skill_slug"])
        assignment = get_assignments(attempt["org_id"], slug=attempt["skill_slug"],
                                     caregiver_id=attempt["caregiver_id"]).get(
                                         (attempt["skill_slug"], attempt["caregiver_id"]))
        attempt["attempts"] = progress.allowance(pol, assignment, mine)
        attempt["history"] = [{k: a[k] for k in HISTORY_KEYS} for a in mine if a["id"] != attempt["id"]]
    else:
        attempt["attempts"] = {"used": None, "allowed": None, "left": None}
        attempt["history"] = []
    return attempt


def submit_attempt(attempt_id, kind: str, note: str) -> bool:
    """Send a graded attempt to the nurse. Returns False if it had already been sent."""
    return bool(db.execute(
        "UPDATE attempts SET submitted_at=now(), submit_kind=%s, submit_note=%s WHERE id=%s AND submitted_at IS NULL",
        (kind, note, attempt_id)))


def review_attempt(attempt_id, overall: str | None, note: str, steps: list[dict], reviewed_by=None) -> None:
    with db.tx() as conn:
        conn.execute(
            "UPDATE attempts SET nurse_status=coalesce(%s, nurse_status), nurse_note=%s, reviewed_at=now(), "
            "needs_review=false, reviewed_by=coalesce(%s, reviewed_by) WHERE id=%s",
            (overall, note, reviewed_by, attempt_id),
        )
        for s in steps:
            conn.execute(
                "UPDATE attempt_steps SET nurse_status=%s, nurse_note=%s WHERE attempt_id=%s AND step_id=%s",
                (s.get("status"), s.get("note", ""), attempt_id, s["step_id"]),
            )


# --- skill policies and assignments ------------------------------------------
def all_policies(org_id=None) -> dict[tuple, dict]:
    """(org_id, slug) -> the policy a nurse saved (progress.policy shape). Skills without a
    row are not listed: use progress.policy(None) for the defaults."""
    rows = db.fetch_all("SELECT * FROM skill_policies" + (" WHERE org_id=%s" if org_id else ""),
                        (org_id,) if org_id else None)
    return {(r["org_id"], r["slug"]): progress.policy(r) for r in rows}


def get_policy(org_id, slug: str) -> dict:
    """The skill's policy, with the defaults when the nurse has not set one."""
    return progress.policy(db.fetch_one("SELECT * FROM skill_policies WHERE org_id=%s AND slug=%s", (org_id, slug)))


def save_policy(org_id, slug: str, pol: dict, updated_by=None) -> None:
    db.execute(
        """INSERT INTO skill_policies (org_id, slug, max_attempts, submit_pct, force_pct, assign_all, updated_by)
           VALUES (%s,%s,%s,%s,%s,%s,%s)
           ON CONFLICT (org_id, slug) DO UPDATE SET max_attempts=EXCLUDED.max_attempts,
             submit_pct=EXCLUDED.submit_pct, force_pct=EXCLUDED.force_pct, assign_all=EXCLUDED.assign_all,
             updated_by=EXCLUDED.updated_by, updated_at=now()""",
        (org_id, slug, pol["max_attempts"], pol["submit_pct"], pol["force_pct"], pol["assign_all"], updated_by))


def get_assignments(org_id, slug: str | None = None, caregiver_id=None) -> dict[tuple, dict]:
    """(slug, caregiver_id) -> skill_assignments row, for one agency."""
    where, params = ["org_id=%s"], [org_id]
    if slug:
        where.append("slug=%s")
        params.append(slug)
    if caregiver_id:
        where.append("caregiver_id=%s")
        params.append(caregiver_id)
    rows = db.fetch_all(f"SELECT * FROM skill_assignments WHERE {' AND '.join(where)}", params)
    return {(r["slug"], r["caregiver_id"]): r for r in rows}


def set_assignment(org_id, slug: str, caregiver_id, **fields) -> None:
    """Create or change one caregiver's assignment row. fields: assigned, limit_mode, max_attempts."""
    fields = {k: v for k, v in fields.items() if k in ("assigned", "limit_mode", "max_attempts")}
    columns = ["org_id", "slug", "caregiver_id", *fields]
    updates = ", ".join([f"{k}=EXCLUDED.{k}" for k in fields] + ["updated_at=now()"])
    db.execute(
        f"""INSERT INTO skill_assignments ({', '.join(columns)}) VALUES ({', '.join(['%s'] * len(columns))})
            ON CONFLICT (org_id, slug, caregiver_id) DO UPDATE SET {updates}""",
        (org_id, slug, caregiver_id, *fields.values()))


def allowance(org_id, slug: str, caregiver_id) -> dict:
    """{used, allowed, left} for one caregiver on one skill (see progress.allowance)."""
    assignment = get_assignments(org_id, slug=slug, caregiver_id=caregiver_id).get((slug, caregiver_id))
    mine = list_attempts(org_id=org_id, caregiver_id=caregiver_id, slug=slug)
    return progress.allowance(get_policy(org_id, slug), assignment, mine)


def list_caregivers(org_id) -> list[dict]:
    """The agency's caregivers, by name."""
    return db.fetch_all(
        """SELECT id, name, email, title, location, hire_date, employment, next_shift, created_at
           FROM users WHERE org_id=%s AND role='caregiver' ORDER BY name""", (org_id,))


def assigned_slugs(org_id, caregiver_id) -> set[str]:
    """The slugs of the agency's skills assigned to one caregiver (see progress.is_assigned)."""
    rows = db.fetch_all(
        """SELECT DISTINCT s.slug FROM skills s
           LEFT JOIN skill_policies p ON p.org_id = s.org_id AND p.slug = s.slug
           LEFT JOIN skill_assignments x ON x.org_id = s.org_id AND x.slug = s.slug AND x.caregiver_id = %s
           WHERE s.org_id = %s AND (coalesce(p.assign_all, true) OR coalesce(x.assigned, false))""",
        (caregiver_id, org_id))
    return {r["slug"] for r in rows}


# --- pose -----------------------------------------------------------------
def replace_pose(video_id, recorded_at: dt.datetime, rows: Iterable[dict], tracks: list[dict]) -> int:
    """Replace all pose data for a video.

    rows: dicts with the POSE_ROW_KEYS (missing keys are stored as NULL); t_offset is required.
    tracks: dicts with person_idx, segment_id, first_t, last_t, n_frames, mean_visibility, and optionally role."""
    n = 0
    with db.tx() as conn:  # one transaction: readers never see a video with half its frames
        conn.execute("DELETE FROM pose_frames WHERE video_id=%s", (video_id,))
        conn.execute("DELETE FROM pose_tracks WHERE video_id=%s", (video_id,))
        with conn.cursor() as cur:
            with cur.copy(f"COPY pose_frames ({', '.join(POSE_COLUMNS)}) FROM STDIN") as copy:
                for r in rows:
                    ts = recorded_at + dt.timedelta(seconds=float(r["t_offset"]))
                    copy.write_row([ts, video_id] + [_pose_value(k, r.get(k)) for k in POSE_ROW_KEYS])
                    n += 1
        for t in tracks:
            conn.execute(
                """INSERT INTO pose_tracks (video_id, person_idx, segment_id, role, first_t, last_t, n_frames, mean_visibility)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
                (video_id, t["person_idx"], t.get("segment_id", 0), t.get("role", "unknown"), t.get("first_t", 0),
                 t.get("last_t", 0), t.get("n_frames", 0), t.get("mean_visibility")),
            )
    refresh_pose_rollup(recorded_at, n)
    return n


def _pose_value(key: str, value):
    if value is None:
        return 0 if key in ("person_idx", "segment_id") else (True if key == "valid" else None)
    if key in ("person_idx", "segment_id"):
        return int(value)
    if key == "valid":
        return bool(value)
    value = float(value)
    return None if value != value else value  # NaN -> NULL


def refresh_pose_rollup(recorded_at: dt.datetime, n_rows: int = 1) -> None:
    """Materialise the pose_1s rollup for the window a video occupies."""
    if not n_rows:
        return
    try:
        db.execute("CALL refresh_continuous_aggregate('pose_1s', %s, %s)",
                   (recorded_at - dt.timedelta(seconds=5), recorded_at + dt.timedelta(hours=2)))
    except Exception:
        pass  # real-time aggregation still returns the rows


def set_track_roles(video_id, roles: dict[int, str]) -> None:
    with db.tx() as conn:
        for person_idx, role in roles.items():
            conn.execute("UPDATE pose_tracks SET role=%s WHERE video_id=%s AND person_idx=%s",
                         (role, video_id, person_idx))


def get_tracks(video_id) -> list[dict]:
    return db.fetch_all("SELECT * FROM pose_tracks WHERE video_id=%s ORDER BY person_idx", (video_id,))


# --- jobs -----------------------------------------------------------------
_boot: str | None = None


def _boot_id() -> str:
    """Changes every time the machine boots, so a job recorded under the same host and pid
    before a reboot is recognised as dead even if that pid now belongs to something else."""
    global _boot
    if _boot is None:
        try:
            _boot = Path("/proc/sys/kernel/random/boot_id").read_text().strip().replace("-", "")[:8]
        except OSError:
            import re
            import subprocess

            try:
                out = subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True,
                                     timeout=3).stdout
                match = re.search(r"sec = (\d+)", out)
                _boot = match.group(1) if match else ""
            except Exception:
                _boot = ""
    return _boot


def _runner() -> str:
    """Which process runs a job: "host:pid:boot" ("host:pid" when the boot id is unknown)."""
    boot = _boot_id()
    return f"{socket.gethostname()}:{os.getpid()}" + (f":{boot}" if boot else "")


def create_job(kind: str, video_id, skill_id=None, attempt_id=None) -> uuid.UUID:
    job_id = uuid.uuid4()
    db.execute("INSERT INTO jobs (id, kind, video_id, skill_id, attempt_id, runner) VALUES (%s,%s,%s,%s,%s,%s)",
               (job_id, kind, video_id, skill_id, attempt_id, _runner()))
    return job_id


def get_job(job_id) -> dict | None:
    return db.fetch_one("SELECT * FROM jobs WHERE id=%s", (job_id,))


def update_job(job_id, **fields) -> None:
    sets, params = [], []
    for key, value in fields.items():
        sets.append(f"{key}=%s")
        params.append(db.J(value) if key in ("stages", "checkpoint") else value)
    db.execute(f"UPDATE jobs SET {', '.join(sets)}, updated_at=now() WHERE id=%s", (*params, job_id))


def save_checkpoint(job_id, **values) -> None:
    """Merge values (JSON-able) into the job's checkpoint, which a resumed job reads back."""
    db.execute("UPDATE jobs SET checkpoint = checkpoint || %s, updated_at=now() WHERE id=%s",
               (db.J(values), job_id))


def _process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def interrupted_jobs(skip: Iterable = ()) -> tuple[list[dict], list[dict]]:
    """Unfinished jobs whose process is gone, as (ran on this machine, ran elsewhere).

    A job on this machine is dead when it was started before the last reboot, by this very
    process (called at server start, so it cannot be running here, except for ids in skip,
    which this process is running right now), or by a process that no longer exists. A job
    started by another live process on this machine (a seeding script, say) is left alone. A
    job from another machine is only counted after two hours without progress, because its
    video file is on that machine."""
    host, skip = socket.gethostname(), {str(s) for s in skip}
    here, elsewhere = [], []
    for job in db.fetch_all("SELECT * FROM jobs WHERE status IN ('queued', 'running')"):
        if str(job["id"]) in skip:
            continue
        parts = (job["runner"] or "").split(":")
        job_host, pid = parts[0], parts[1] if len(parts) > 1 else ""
        boot = parts[2] if len(parts) > 2 else None
        if job_host == host:
            if (not pid.isdigit() or (boot is not None and boot != _boot_id()) or int(pid) == os.getpid()
                    or not _process_alive(int(pid))):
                here.append(job)
        elif dt.datetime.now(dt.timezone.utc) - job["updated_at"] > dt.timedelta(hours=2):
            elsewhere.append(job)
    return here, elsewhere


INTERRUPTED = "Interrupted by a server restart. Upload again or re-run."


def fail_interrupted_jobs() -> int:
    """Mark every unfinished job whose process is gone as interrupted (see interrupted_jobs)."""
    here, elsewhere = interrupted_jobs()
    dead = [j["id"] for j in here + elsewhere]
    if dead:
        db.execute("UPDATE jobs SET status='error', error=%s, updated_at=now() WHERE id = ANY(%s)",
                   (INTERRUPTED, dead))
    return len(dead)


def claim_job(job: dict) -> bool:
    """Take over an interrupted job for this process: it becomes queued under this runner with
    one more resume counted. False if another process claimed it first."""
    row = db.fetch_one(
        """UPDATE jobs SET runner=%s, resumes=resumes + 1, status='queued', error=NULL, updated_at=now()
           WHERE id=%s AND runner IS NOT DISTINCT FROM %s AND status IN ('queued', 'running') RETURNING id""",
        (_runner(), job["id"], job["runner"]))
    return row is not None


def load_timeline(attempt_id) -> Timeline:
    """The timeline save_timeline stored for an attempt, in rubric order."""
    from .models import OrderViolation, TimelineStep

    rows = db.fetch_all(
        """SELECT x.step_id, x.found, x.start_s, x.end_s, x.performed_index, x.timeline_confidence, x.timeline_note
           FROM attempt_steps x JOIN attempts a ON a.id = x.attempt_id
           LEFT JOIN skill_steps st ON st.skill_id = a.skill_id AND st.step_id = x.step_id
           WHERE x.attempt_id=%s ORDER BY st.ord NULLS LAST, x.step_id""", (attempt_id,))
    steps = [TimelineStep(step_id=r["step_id"], found=bool(r["found"]), start_s=r["start_s"], end_s=r["end_s"],
                          performed_index=r["performed_index"], confidence=r["timeline_confidence"] or 0.0,
                          note=r["timeline_note"] or "") for r in rows]
    violations = db.fetch_all(
        "SELECT step_id, expected_after, message, at_s FROM order_violations WHERE attempt_id=%s "
        "ORDER BY at_s NULLS LAST, step_id", (attempt_id,))
    return Timeline(steps=steps, order_violations=[OrderViolation(**v) for v in violations],
                    missing_step_ids=[s.step_id for s in steps if not s.found])


def load_evaluation(attempt_id) -> Evaluation:
    """The evaluation save_evaluation stored for an attempt, in rubric order."""
    from .models import StepResult

    attempt = db.fetch_one("SELECT people, overall_feedback, skill_match, skill_match_note FROM attempts WHERE id=%s",
                           (attempt_id,))
    rows = db.fetch_all(
        """SELECT x.step_id, x.status, x.confidence, x.feedback, x.evidence, x.evidence_start_s, x.evidence_end_s,
                  x.double_checked
           FROM attempt_steps x JOIN attempts a ON a.id = x.attempt_id
           LEFT JOIN skill_steps st ON st.skill_id = a.skill_id AND st.step_id = x.step_id
           WHERE x.attempt_id=%s AND x.status IS NOT NULL ORDER BY st.ord NULLS LAST, x.step_id""", (attempt_id,))
    flags = db.fetch_all("SELECT * FROM safety_flags WHERE attempt_id=%s AND source='gemini' ORDER BY start_s",
                         (attempt_id,))
    return Evaluation(
        people=people_from(attempt["people"]),
        steps=[StepResult(step_id=r["step_id"], status=r["status"], confidence=r["confidence"] or 0.0,
                          feedback=r["feedback"], evidence=r["evidence"], evidence_start_s=r["evidence_start_s"],
                          evidence_end_s=r["evidence_end_s"], double_checked=r["double_checked"]) for r in rows],
        safety_flags=[SafetyFlag(**{k: f[k] for k in SafetyFlag.model_fields}) for f in flags],
        overall_feedback=attempt["overall_feedback"],
        skill_match=attempt["skill_match"] is not False,
        skill_match_note=attempt["skill_match_note"],
    )


def ai_problem() -> str | None:
    """A sentence about the AI account when the most recent pipeline job failed because of it
    (out of credit, over budget, key rejected) and nothing has succeeded since. None otherwise.

    Only failures since the current API key was first used count. A job that failed before
    that failed under the previous key, and replacing the key is how such a problem is fixed,
    so reporting it would tell a nurse to top up an account that is no longer in use."""
    from . import gemini

    first_use = db.fetch_one("SELECT min(created_at) AS at FROM gemini_calls WHERE key_id=%s", (gemini.key_id(),))
    if not first_use or first_use["at"] is None:
        return None
    last = db.fetch_one(
        """SELECT j.error, j.updated_at FROM jobs j
           WHERE j.status = 'error' AND j.updated_at > now() - interval '1 day' AND j.updated_at >= %s
             AND NOT EXISTS (SELECT 1 FROM jobs d WHERE d.status = 'done' AND d.updated_at > j.updated_at)
           ORDER BY j.updated_at DESC LIMIT 1""", (first_use["at"],))
    error = (last or {}).get("error") or ""
    first = error.split("\n")[0]
    if first.startswith(("The AI service", "This server has reached its AI spending limit")):
        return first
    if "RESOURCE_EXHAUSTED" in error or "credits are depleted" in error:  # stored before errors were reworded
        return ("The AI service account has run out of credit, so new videos cannot be checked. "
                "Top up the Gemini account.")
    return None


def people_from(rows: list[dict] | None) -> list[PersonObs]:
    return [PersonObs(**r) for r in (rows or [])]
