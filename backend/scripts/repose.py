"""Measure pose again for the reference video of each skill, replacing its stored readings.

Use after changing how pose is measured (sampling rate, the standing test, tracking), so the
safety dashboard shows readings from the current code. Attempts are not touched: record or
upload them again to regrade them.

  uv run python -m scripts.repose                    # newest version of every skill
  uv run python -m scripts.repose --only sit_to_stand,fall_response

Roles cost a few Gemini still-image calls per video (about two cents).
"""
from __future__ import annotations

import argparse
import sys
import time

from app import db, jobs, repo
from app.stages import pose


def repose(skill: dict) -> str:
    full = repo.get_skill(skill["id"])
    if not full["video"]:
        return "no reference video"
    video = repo.ensure_video_file(full["video"])
    ctx = jobs.StageContext(job_id=None, video=video, skill=full, slug_hint=full["slug"])
    started = time.time()
    summary = pose.extract(ctx)
    pose.assign_roles(ctx, repo.people_from(full["people"]))
    flags = pose.relabel_flags(video["id"], summary.candidate_flags)
    repo.save_flags(video["id"], None, flags, sources=("pose", "pose_confirmed"))
    roles = db.fetch_all(
        "SELECT role, count(*) AS n FROM pose_tracks WHERE video_id=%s GROUP BY role ORDER BY role", (video["id"],))
    return (f"{summary.frames_written} rows at {summary.sample_fps:.1f} fps in {time.time() - started:.0f}s, "
            f"{summary.tracks} tracks ({', '.join(f'{r['n']} {r['role']}' for r in roles)}), {len(flags)} advisory flags")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated skill slugs")
    args = parser.parse_args()
    db.migrate()
    wanted = {s for s in args.only.split(",") if s}
    failed = 0
    for skill in repo.list_skills(org_id=repo.DEFAULT_ORG):  # other agencies' videos are not on this machine
        if wanted and skill["slug"] not in wanted:
            continue
        try:
            print(f"ok    {skill['slug']}: {repose(skill)}")
        except Exception as exc:
            failed += 1
            print(f"FAIL  {skill['slug']}: {type(exc).__name__}: {exc}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
