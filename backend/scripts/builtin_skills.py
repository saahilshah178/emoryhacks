"""The nine standard skills: install them, or refresh the file they are kept in.

  uv run python -m scripts.builtin_skills            (make skills)
      Add any standard skill the default agency does not have yet. No Gemini calls. The API
      does the same when it starts, so this is only needed for a database no server has
      been started on.

  uv run python -m scripts.builtin_skills export
      Rewrite backend/app/builtin_skills.json from the default agency's current version of
      each standard skill. Use it after improving a rubric you want every database to get.

  uv run python -m scripts.builtin_skills check
      Read the file and report anything wrong with it: a missing skill, a step without
      criteria, a step whose times fall outside its video, a missing reference file.
"""
from __future__ import annotations

import json
import sys

from app import builtin, catalog, config, db


def problems(skills: list[dict]) -> list[str]:
    found = []
    by_slug = {s["slug"]: s for s in skills}
    for slug in builtin.SLUGS:
        skill = by_slug.get(slug)
        if not skill:
            found.append(f"{slug}: not in the file")
            continue
        video = skill["video"]
        if not (config.REFERENCE_DIR / video["original_name"]).is_file():
            found.append(f"{slug}: reference_vids/{video['original_name']} is missing")
        if video["original_name"] not in catalog.REFERENCE_FILES[slug].values():
            found.append(f"{slug}: {video['original_name']} is not one of this skill's reference videos")
        steps = skill["steps"]
        if len(steps) < 3:
            found.append(f"{slug}: only {len(steps)} steps")
        ids = [s["step_id"] for s in steps]
        if len(set(ids)) != len(ids):
            found.append(f"{slug}: repeated step ids")
        for step in steps:
            where = f"{slug} {step['step_id']} ({step['title']})"
            if not (0 <= step["start_s"] < step["end_s"] <= video["duration_s"] + 1):
                found.append(f"{where}: times {step['start_s']}-{step['end_s']} do not fit a "
                             f"{video['duration_s']:.0f} s video")
            evals = step["evals"] or {}
            for key in ("pass_criteria", "fail_criteria", "unverified_when"):
                if not evals.get(key):
                    found.append(f"{where}: no {key}")
            unknown = [m for m in step["must_follow"] if m not in ids]
            if unknown:
                found.append(f"{where}: must_follow names unknown steps {unknown}")
    return found


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "install"
    if command == "export":
        db.migrate()
        skills = builtin.export()
        wrong = problems(skills)
        if wrong:
            print("Not written, because the skills in this database have problems:")
            print("\n".join(f"  {p}" for p in wrong))
            return 1
        builtin.FILE.write_text(json.dumps({"skills": skills}, indent=1, ensure_ascii=False) + "\n")
        print(f"Wrote {len(skills)} skills to {builtin.FILE}")
        return 0
    if command == "check":
        wrong = problems(builtin.load())
        for skill in builtin.load():
            print(f"  {skill['slug']:<20} {len(skill['steps']):>2} steps  {skill['video']['duration_s']:>6.0f} s  "
                  f"{skill['video']['original_name']}")
        print("\n".join(f"  PROBLEM {p}" for p in wrong) or "The file is sound.")
        return 1 if wrong else 0
    if command == "install":
        db.migrate()
        added = builtin.ensure()
        print(f"Added {len(added)}: {', '.join(added)}" if added else "All nine standard skills are already here.")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    finally:
        db.close()
