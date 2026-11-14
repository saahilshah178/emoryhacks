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

from . import config, db, media
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
def create_video(kind: str, path: str, original_name: str, info: dict, video_id: uuid.UUID | None = None) -> dict:
    video_id = video_id or uuid.uuid4()
    db.execute(
        """INSERT INTO videos (id, kind, original_name, path, duration_s, width, height, fps)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (video_id, kind, original_name, path, info.get("duration_s", 0), info.get("width", 0),
         info.get("height", 0), info.get("fps", 0)),
    )
    return get_video(video_id)


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
    if Path(video["path"]).exists():
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
                 name: str | None = None) -> uuid.UUID:
    """Store a new skill version with its steps. slug/name override the classifier's."""
    slug = slug or classification.skill_slug
    skill_id = uuid.uuid4()
    with db.tx() as conn:
        row = conn.execute("SELECT coalesce(max(version), 0) AS v FROM skills WHERE slug=%s", (slug,)).fetchone()
        conn.execute(
            """INSERT INTO skills (id, slug, name, category, summary, version, order_matters, safety_criteria,
                                   people, classification, notes, reference_video_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (skill_id, slug, name or classification.skill_name, classification.category, classification.summary,
             row["v"] + 1, rubric.order_matters, db.J(rubric.safety_criteria),
             db.J([p.model_dump() for p in classification.people]), db.J(classification.model_dump()),
             rubric.notes, video_id),
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


def list_skills(all_versions: bool = False) -> list[dict]:
    """Skills, newest version of each by default. Rebuilding a rubric adds a version."""
    newest = "" if all_versions else "WHERE s.version = (SELECT max(version) FROM skills x WHERE x.slug = s.slug)"
    return db.fetch_all(
        f"""SELECT s.id, s.slug, s.name, s.category, s.summary, s.version, s.order_matters,
                  s.reference_video_id, s.created_at, v.duration_s,
                  (SELECT count(*) FROM skill_steps st WHERE st.skill_id = s.id) AS step_count,
                  (SELECT count(*) FROM attempts a WHERE a.skill_id = s.id) AS attempt_count
           FROM skills s LEFT JOIN videos v ON v.id = s.reference_video_id
           {newest}
           ORDER BY s.name, s.version DESC"""
    )


def get_skill(skill_id) -> dict | None:
    skill = db.fetch_one("SELECT * FROM skills WHERE id=%s", (skill_id,))
    if not skill:
        return None
    skill["steps"] = db.fetch_all("SELECT * FROM skill_steps WHERE skill_id=%s ORDER BY ord", (skill_id,))
    skill["video"] = get_video(skill["reference_video_id"]) if skill["reference_video_id"] else None
    newest = db.fetch_one("SELECT id FROM skills WHERE slug=%s ORDER BY version DESC LIMIT 1", (skill["slug"],))
    skill["latest_id"] = newest["id"]
    return skill


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
    allowed = {"name", "summary", "order_matters", "safety_criteria"}
    sets, params = [], []
    for key, value in fields.items():
        if key in allowed and value is not None:
            sets.append(f"{key}=%s")
            params.append(db.J(value) if key == "safety_criteria" else value)
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
def create_attempt(skill_id, video_id, caregiver_name: str = "") -> uuid.UUID:
    attempt_id = uuid.uuid4()
    with db.tx() as conn:
        conn.execute("INSERT INTO attempts (id, skill_id, video_id, caregiver_name) VALUES (%s,%s,%s,%s)",
                     (attempt_id, skill_id, video_id, caregiver_name))
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


def list_attempts(skill_id=None) -> list[dict]:
    where, params = "", ()
    if skill_id:
        where, params = "WHERE a.skill_id=%s", (skill_id,)
    return db.fetch_all(
        f"""SELECT a.id, a.skill_id, a.video_id, a.caregiver_name, a.status, a.score_pct, a.needs_review,
                   a.nurse_status, a.reviewed_at, a.created_at, s.name AS skill_name, s.slug AS skill_slug,
                   v.duration_s,
                   (SELECT count(*) FROM safety_flags f WHERE f.attempt_id = a.id AND f.counts_toward_score) AS flag_count,
                   (SELECT j.status FROM jobs j WHERE j.attempt_id = a.id ORDER BY j.created_at DESC LIMIT 1) AS job_status
            FROM attempts a JOIN skills s ON s.id = a.skill_id JOIN videos v ON v.id = a.video_id
            {where} ORDER BY a.created_at DESC""",
        params,
    )


def get_attempt(attempt_id) -> dict | None:
    """The attempt with its rubric steps joined to their results, violations and flags."""
    attempt = db.fetch_one(
        """SELECT a.*, s.name AS skill_name, s.slug AS skill_slug, s.order_matters, s.reference_video_id
           FROM attempts a JOIN skills s ON s.id = a.skill_id WHERE a.id=%s""",
        (attempt_id,),
    )
    if not attempt:
        return None
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
    attempt["video"] = get_video(attempt["video_id"])
    attempt["job"] = db.fetch_one(
        "SELECT id, status, stage, stages, error FROM jobs WHERE attempt_id=%s ORDER BY created_at DESC LIMIT 1",
        (attempt_id,),
    )
    attempt["final_status"] = attempt["nurse_status"] or attempt["status"]
    return attempt


def review_attempt(attempt_id, overall: str | None, note: str, steps: list[dict]) -> None:
    with db.tx() as conn:
        conn.execute(
            "UPDATE attempts SET nurse_status=coalesce(%s, nurse_status), nurse_note=%s, reviewed_at=now(), needs_review=false WHERE id=%s",
            (overall, note, attempt_id),
        )
        for s in steps:
            conn.execute(
                "UPDATE attempt_steps SET nurse_status=%s, nurse_note=%s WHERE attempt_id=%s AND step_id=%s",
                (s.get("status"), s.get("note", ""), attempt_id, s["step_id"]),
            )


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
def _runner() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


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
        params.append(db.J(value) if key == "stages" else value)
    db.execute(f"UPDATE jobs SET {', '.join(sets)}, updated_at=now() WHERE id=%s", (*params, job_id))


def _process_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def fail_interrupted_jobs() -> int:
    """Mark unfinished jobs whose process is gone as interrupted. Called at server start.

    A job started by another live process on this machine (a seeding script, say) is left
    alone. A job from another machine is only given up on after two hours without progress."""
    host = socket.gethostname()
    dead = []
    for job in db.fetch_all("SELECT id, runner, updated_at FROM jobs WHERE status IN ('queued', 'running')"):
        job_host, _, pid = (job["runner"] or "").rpartition(":")
        if job_host == host and pid.isdigit():
            if int(pid) == os.getpid() or not _process_alive(int(pid)):
                dead.append(job["id"])
        elif dt.datetime.now(dt.timezone.utc) - job["updated_at"] > dt.timedelta(hours=2):
            dead.append(job["id"])
    if dead:
        db.execute(
            "UPDATE jobs SET status='error', error='Interrupted by a server restart. Upload again or re-run.', "
            "updated_at=now() WHERE id = ANY(%s)", (dead,))
    return len(dead)


def people_from(rows: list[dict] | None) -> list[PersonObs]:
    return [PersonObs(**r) for r in (rows or [])]
