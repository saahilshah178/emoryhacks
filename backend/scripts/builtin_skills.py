"""The nine standard skills: install them, or refresh the file they are kept in.

  uv run python -m scripts.builtin_skills            (make skills)
      Add any standard skill the default agency does not have yet, and install a revised
      rubric as a new version where the agency still has an earlier revision no nurse has
      changed (builtin.ensure). No Gemini calls. The API does the same when it starts, so
      this is only needed for a database no server has been started on.

  uv run python -m scripts.builtin_skills export
      Rewrite backend/app/builtin_skills.json from the default agency's current version of
      each standard skill. Use it after improving a rubric you want every database to get: a
      changed skill gets the next revision, so other databases are given it at their next start.

  uv run python -m scripts.builtin_skills check
      Read the file and report anything wrong with it: a missing skill, a step without
      criteria, a step whose times fall outside its video, a missing reference file, text that
      depends on speech (grading is by sight only, see stages/sight.py), steps not numbered
      s1..sN in order, a must_follow naming a missing or later step, a missing applies_when
      key, or a missing revision.
"""
from __future__ import annotations

import json
import sys

from app import builtin, catalog, config, db
from app.stages import sight


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
        if not (isinstance(skill.get("revision"), int) and skill["revision"] >= 1):
            found.append(f"{slug}: no revision")
        if not isinstance(skill.get("replaces"), list):
            found.append(f"{slug}: no replaces list")
        # Graded by sight only: nothing the grader reads may depend on what is said.
        texts = [("summary", skill["summary"])]
        texts += [(f"safety_criteria[{i}]", text) for i, text in enumerate(skill["safety_criteria"])]
        texts += [(f"people {p['label']}", p["description"]) for p in skill["people"]]
        for where, text in texts:
            words = sight.spoken_words(text)
            if words:
                found.append(f"{slug} {where}: depends on speech ({', '.join(words)}): {text}")
        steps = skill["steps"]
        if len(steps) < 3:
            found.append(f"{slug}: only {len(steps)} steps")
        ids = [s["step_id"] for s in steps]
        if len(set(ids)) != len(ids):
            found.append(f"{slug}: repeated step ids")
        numbered = [(f"s{i}", i) for i in range(1, len(steps) + 1)]
        actual = [(s["step_id"], s["ord"]) for s in steps]
        if actual != numbered:
            listed = ", ".join(f"{step_id} ord {ord_}" for step_id, ord_ in actual)
            found.append(f"{slug}: steps are not s1..s{len(steps)} with ord 1..{len(steps)} in order ({listed})")
        for problem in sight.speech_problems(steps):
            title = next(s["title"] for s in steps if s["step_id"] == problem["step_id"])
            found.append(f"{slug} {problem['step_id']} ({title}) {problem['where']}: depends on speech "
                         f"({', '.join(problem['words'])}): {problem['text']}")
        for n, step in enumerate(steps):
            where = f"{slug} {step['step_id']} ({step['title']})"
            if not (0 <= step["start_s"] < step["end_s"] <= video["duration_s"] + 1):
                found.append(f"{where}: times {step['start_s']}-{step['end_s']} do not fit a "
                             f"{video['duration_s']:.0f} s video")
            evals = step["evals"] or {}
            for key in ("pass_criteria", "fail_criteria", "unverified_when"):
                if not evals.get(key):
                    found.append(f"{where}: no {key}")
            if "applies_when" not in step:
                found.append(f"{where}: no applies_when (use \"\" for a step every attempt must show)")
            unknown = [m for m in step["must_follow"] if m not in ids]
            if unknown:
                found.append(f"{where}: must_follow names unknown steps {unknown}")
            later = [m for m in step["must_follow"] if m in ids[n:]]
            if later:
                found.append(f"{where}: must_follow names steps that are not before it {later}")
    return found


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "install"
    if command == "export":
        db.migrate()
        try:
            skills = builtin.export()
        except (KeyError, ValueError) as exc:
            print(f"Not written: {exc}")
            return 1
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
        changes = builtin.ensure()
        print("\n".join(builtin.describe(changes)) if changes
              else "All nine standard skills are here, and each is current or a nurse's own version.")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    finally:
        db.close()
