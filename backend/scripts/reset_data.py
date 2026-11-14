"""Start a database's data from scratch, so that only what real caregivers record is in it.

  uv run python -m scripts.reset_data                (make reset-data)   look, change nothing
  uv run python -m scripts.reset_data --yes          do it
  uv run python -m scripts.reset_data --yes --files  also delete video files nothing refers to

Deletes
  - every agency other than the default one, with everything that belongs to it: users,
    sessions, skills, steps, videos, attempts, flags, jobs, pose rows (and its rows in
    skill_policies and skill_assignments, if those tables exist);
  - in the default agency, every attempt with its recording, steps, order violations, safety
    flags, jobs and pose rows;
  - default-agency users who have no username (roster people without a login), their
    sessions and their skill_assignments;
  - everyone's "notifications seen" time, so nothing starts out looking read.

Keeps the default agency, its logins and their passwords, every skill with its steps and
reference video, the pose data of reference videos, the default agency's skill_policies and
the gemini_calls log.

Without --yes it prints what it would delete (counts per table, names of the agencies and
users affected) and exits 0. With --yes the database changes happen in one transaction.
--files then removes files under the data directory that no videos row refers to any more
(<video id>.mp4 in the video directory, <video id>_<time>.jpg in the thumbnail directory)
and prints how many and how many megabytes; with the dry run it only counts them.
"""
from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

from app import auth, config, db

OPTIONAL = ("skill_policies", "skill_assignments")


def _exists(conn, table: str) -> bool:
    return conn.execute("SELECT to_regclass(%s) AS t", (f"public.{table}",)).fetchone()["t"] is not None


def _scope(conn) -> dict:
    """What a reset would delete: ids of orgs, users, videos and attempts."""
    default = auth.DEFAULT_ORG
    orgs = conn.execute("SELECT id, name FROM orgs WHERE id <> %s ORDER BY name", (default,)).fetchall()
    org_ids = [o["id"] for o in orgs]
    users = conn.execute(
        "SELECT id, org_id, name, role FROM users WHERE org_id = ANY(%s) "
        "OR (org_id = %s AND username IS NULL) ORDER BY name", (org_ids, default)).fetchall()
    videos = [r["id"] for r in conn.execute(
        "SELECT id FROM videos WHERE org_id = ANY(%s) OR (org_id = %s AND kind = 'attempt')",
        (org_ids, default)).fetchall()]
    attempts = [r["id"] for r in conn.execute(
        "SELECT a.id FROM attempts a JOIN skills s ON s.id = a.skill_id "
        "WHERE a.video_id = ANY(%s) OR s.org_id = ANY(%s)", (videos, org_ids)).fetchall()]
    return {"orgs": orgs, "org_ids": org_ids, "users": users, "user_ids": [u["id"] for u in users],
            "videos": videos, "attempts": attempts}


def _count(conn, sql: str, *params) -> int:
    return conn.execute(f"SELECT count(*) AS n FROM ({sql}) q", params).fetchone()["n"]


def _counts(conn, s: dict) -> dict[str, int]:
    org_ids, user_ids, videos, attempts = s["org_ids"], s["user_ids"], s["videos"], s["attempts"]
    counts = {
        "orgs": len(org_ids),
        "users": len(user_ids),
        "sessions": _count(conn, "SELECT 1 FROM sessions WHERE user_id = ANY(%s)", user_ids),
        "skills": _count(conn, "SELECT 1 FROM skills WHERE org_id = ANY(%s)", org_ids),
        "skill_steps": _count(conn, "SELECT 1 FROM skill_steps WHERE skill_id IN "
                                    "(SELECT id FROM skills WHERE org_id = ANY(%s))", org_ids),
        "videos": len(videos),
        "attempts": len(attempts),
        "attempt_steps": _count(conn, "SELECT 1 FROM attempt_steps WHERE attempt_id = ANY(%s)", attempts),
        "order_violations": _count(conn, "SELECT 1 FROM order_violations WHERE attempt_id = ANY(%s)", attempts),
        "safety_flags": _count(conn, "SELECT 1 FROM safety_flags WHERE video_id = ANY(%s) "
                                     "OR attempt_id = ANY(%s)", videos, attempts),
        "jobs": _count(conn, "SELECT 1 FROM jobs WHERE video_id = ANY(%s) OR attempt_id = ANY(%s)", videos, attempts),
        "pose_tracks": _count(conn, "SELECT 1 FROM pose_tracks WHERE video_id = ANY(%s)", videos),
        "pose_frames": _count(conn, "SELECT 1 FROM pose_frames WHERE video_id = ANY(%s)", videos),
    }
    if _exists(conn, "skill_policies"):
        counts["skill_policies"] = _count(conn, "SELECT 1 FROM skill_policies WHERE org_id = ANY(%s)", org_ids)
    if _exists(conn, "skill_assignments"):
        counts["skill_assignments"] = _count(
            conn, "SELECT 1 FROM skill_assignments WHERE org_id = ANY(%s) OR caregiver_id = ANY(%s)",
            org_ids, user_ids)
    counts["notifications_seen_at cleared"] = _count(
        conn, "SELECT 1 FROM users WHERE notifications_seen_at IS NOT NULL AND NOT (id = ANY(%s)) "
              "AND org_id <> ALL(%s)", user_ids, org_ids)
    return counts


def _delete(conn, s: dict) -> None:
    org_ids, user_ids, videos = s["org_ids"], s["user_ids"], s["videos"]
    # pose_frames is a hypertable with no foreign key, so it goes by video id; pose_tracks,
    # attempts, steps, flags and jobs follow their video through ON DELETE CASCADE.
    conn.execute("DELETE FROM pose_frames WHERE video_id = ANY(%s)", (videos,))
    if _exists(conn, "skill_policies"):
        conn.execute("DELETE FROM skill_policies WHERE org_id = ANY(%s)", (org_ids,))
    if _exists(conn, "skill_assignments"):
        conn.execute("DELETE FROM skill_assignments WHERE org_id = ANY(%s) OR caregiver_id = ANY(%s)",
                     (org_ids, user_ids))
    conn.execute("DELETE FROM videos WHERE id = ANY(%s)", (videos,))
    # Attempts of an agency's skills would go with the skills; the videos above are most of them.
    conn.execute("DELETE FROM attempts WHERE id = ANY(%s)", (s["attempts"],))
    conn.execute("DELETE FROM orgs WHERE id = ANY(%s)", (org_ids,))
    conn.execute("DELETE FROM users WHERE id = ANY(%s)", (user_ids,))  # sessions cascade
    conn.execute("UPDATE users SET notifications_seen_at = NULL WHERE notifications_seen_at IS NOT NULL")


def _file_video_id(path: Path) -> uuid.UUID | None:
    try:
        return uuid.UUID(path.name.split(".")[0].split("_")[0])
    except ValueError:
        return None


def orphan_files(keep_ids: set[uuid.UUID]) -> list[Path]:
    """Video and thumbnail files whose video id is not in keep_ids."""
    found = []
    for directory, pattern in ((config.VIDEO_DIR, "*.mp4"), (config.THUMB_DIR, "*.jpg")):
        for path in sorted(directory.glob(pattern)) if directory.is_dir() else []:
            video_id = _file_video_id(path)
            if video_id is not None and video_id not in keep_ids:
                found.append(path)
    return found


def _megabytes(paths: list[Path]) -> float:
    return sum(p.stat().st_size for p in paths) / 1e6


def run(yes: bool = False, files: bool = False) -> dict:
    """Plan or do the reset. Returns {"counts", "orgs", "users", "files", "megabytes", "done"}."""
    db.migrate()
    with db.tx() as conn:
        s = _scope(conn)
        counts = _counts(conn, s)
        report = {"counts": counts, "orgs": [o["name"] for o in s["orgs"]],
                  "users": [f"{u['name']} ({u['role']})" for u in s["users"]],
                  "files": 0, "megabytes": 0.0, "done": yes}
        doomed = set(s["videos"])
        if yes:
            _delete(conn, s)
        remaining = {r["id"] for r in conn.execute("SELECT id FROM videos").fetchall()} - doomed
    if files:
        orphans = orphan_files(remaining)
        report["files"], report["megabytes"] = len(orphans), _megabytes(orphans)
        if yes:
            for path in orphans:
                path.unlink(missing_ok=True)
    auth.forget_cached()
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="reset_data", description="Start the data from scratch.")
    parser.add_argument("--yes", action="store_true", help="delete (without it, only print what would go)")
    parser.add_argument("--files", action="store_true",
                        help="also delete video and thumbnail files that no video row refers to")
    args = parser.parse_args(argv)
    report = run(yes=args.yes, files=args.files)
    verb = "Deleted" if report["done"] else "Would delete"
    print(f"{verb}:")
    for table, n in report["counts"].items():
        print(f"  {table:<32} {n}")
    for label, names in (("Agencies", report["orgs"]), ("Users", report["users"])):
        print(f"{label} {'deleted' if report['done'] else 'affected'}: {', '.join(names) or 'none'}")
    if args.files:
        print(f"Files {'deleted' if report['done'] else 'that would be deleted'}: "
              f"{report['files']} ({report['megabytes']:.1f} MB)")
    if not report["done"]:
        print("Nothing was changed. Run again with --yes to do it.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    finally:
        db.close()
