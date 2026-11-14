"""Run reference videos through the nurse pipeline so every skill has a rubric.

  uv run python -m scripts.seed_reference                 # all primaries not seeded yet
  uv run python -m scripts.seed_reference --only glove_removal,sit_to_stand
  uv run python -m scripts.seed_reference --which backup --force

A primary that fails is retried with its backup video when one exists.
"""
from __future__ import annotations

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor

from app import catalog, config, db, jobs, repo


def seed_one(slug: str, which: str) -> dict:
    files = catalog.REFERENCE_FILES[slug]
    order = [which] + [w for w in ("primary", "backup") if w != which]
    last: dict = {"slug": slug, "status": "error", "error": "no video file"}
    for choice in order:
        filename = files.get(choice)
        if not filename:
            continue
        src = config.REFERENCE_DIR / filename
        try:
            video = jobs.ingest(str(src), "reference", filename)
            job_id = repo.create_job("reference", video["id"])
            jobs.run_reference(job_id, slug=slug, name=catalog.BY_SLUG[slug]["name"])
            job = repo.get_job(job_id)
        except Exception as exc:  # ingest failure
            last = {"slug": slug, "status": "error", "error": str(exc), "file": filename}
            continue
        if job["status"] == "done":
            skill = repo.get_skill(job["skill_id"])
            detected = (skill["classification"] or {}).get("skill_slug")
            return {"slug": slug, "status": "done", "file": filename, "used": choice, "skill_id": str(skill["id"]),
                    "steps": len(skill["steps"]), "detected": detected, "match": detected == slug,
                    "confidence": (skill["classification"] or {}).get("confidence"),
                    "stages": {s["name"]: s["status"] for s in job["stages"]}}
        last = {"slug": slug, "status": "error", "file": filename, "error": (job["error"] or "")[:400]}
    return last


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--which", choices=["primary", "backup"], default="primary")
    parser.add_argument("--only", default="", help="comma-separated slugs")
    parser.add_argument("--force", action="store_true", help="seed even if the skill already exists")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()

    db.migrate()
    wanted = [s for s in args.only.split(",") if s] or list(catalog.REFERENCE_FILES)
    existing = {r["slug"] for r in repo.list_skills()}
    todo = [s for s in wanted if args.force or s not in existing]
    for s in wanted:
        if s not in todo:
            print(f"skip  {s}: already seeded (use --force to add a new version)")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda s: seed_one(s, args.which), todo))
    failed = 0
    for r in results:
        if r["status"] == "done":
            flag = "ok  " if r["match"] else "MISMATCH"
            print(f"{flag} {r['slug']}: {r['steps']} steps from {r['file']} ({r['used']}); "
                  f"classifier said {r['detected']} ({r['confidence']}); stages {r['stages']}")
        else:
            failed += 1
            print(f"FAIL  {r['slug']}: {r.get('file')}: {r.get('error')}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
