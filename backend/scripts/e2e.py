"""End-to-end check of the caregiver pipeline against the seeded skills.

There are no real caregiver attempts in the repo, so this builds stand-ins from the
reference videos, each with a known expected outcome:

  self     the reference video itself as the attempt   -> every step found, no order violation, not failed
  backup   the backup video of the same skill          -> informational (different people and room)
  missing  the reference with one critical step cut    -> that step is not passed and the attempt is not passed
  swapped  the reference with two dependent steps      -> an order violation naming the step that moved earlier
           performed in the wrong order
  wrong    a video of a different skill                -> skill_match is false and the attempt fails
  truncated  the reference stopped before a critical   -> no step from there on is passed and the attempt
           step in its second half                        is not passed

"missing" and "swapped" are only conclusive for steps that are discrete actions. When a step
is a state that continues into the next one (staying beside the patient, standing behind
them), cutting or moving its footage does not remove or reorder it, and the grader is right
to still find it. "truncated" has no such ambiguity.

  uv run python -m scripts.e2e --skills sit_to_stand,glove_removal --cases self,missing,swapped,wrong

Cut attempts end where the rubric's last step ends, so a replay later in the reference
cannot put a removed step back.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from app import catalog, config, db, gemini, jobs, media, repo

CASES = ["self", "backup", "missing", "swapped", "wrong", "truncated"]
# A clearly different skill to use for the "wrong" case.
WRONG_FOR = {"glove_removal": "sit_to_stand"}
DEFAULT_WRONG = "glove_removal"


def latest_skills() -> dict[str, dict]:
    return {row["slug"]: row for row in repo.list_skills()}  # newest version of each skill


def _last_step_end(skill: dict) -> float:
    """Where the rubric's last step ends. Cut attempts stop here, because instructional
    videos often replay a step from another angle afterwards, which would put a "removed"
    step back into the attempt."""
    return float(max(s["end_s"] for s in skill["steps"]))


def _segments_without(step: dict, end: float) -> list[tuple[float, float]]:
    parts = [(0.0, float(step["start_s"])), (float(step["end_s"]), end)]
    return [(a, b) for a, b in parts if b - a >= 0.5]


def pick_missing(skill: dict) -> dict | None:
    """The critical step whose removal is cleanest: longest, and not the whole video."""
    duration = float(skill["video"]["duration_s"])
    candidates = [s for s in skill["steps"] if s["critical"] and 2.0 <= s["end_s"] - s["start_s"] < duration * 0.6]
    return max(candidates, key=lambda s: s["end_s"] - s["start_s"]) if candidates else None


def pick_swap(skill: dict) -> tuple[dict, dict] | None:
    """A prerequisite M and a dependent step S (S must follow M) that do not overlap."""
    by_id = {s["step_id"]: s for s in skill["steps"]}
    best = None
    for s in skill["steps"]:
        if not s["order_dependent"]:
            continue
        for mid in s["must_follow"] or []:
            m = by_id.get(mid)
            if not m or m["end_s"] > s["start_s"] or m["end_s"] - m["start_s"] < 2 or s["end_s"] - s["start_s"] < 2:
                continue
            gap = s["start_s"] - m["end_s"]
            if best is None or gap < best[0]:
                best = (gap, m, s)
    return (best[1], best[2]) if best else None


def pick_truncation(skill: dict) -> dict | None:
    """The first critical step in the second half of the rubric: the attempt stops before it."""
    steps = skill["steps"]
    later = [s for s in steps if s["critical"] and s["ord"] > len(steps) / 2 and s["start_s"] >= 5]
    return min(later, key=lambda s: s["ord"]) if later else None


def build_case(skill: dict, case: str) -> dict | None:
    """Return {src, expect...} for a case, writing a cut video when needed. None if not applicable."""
    slug = skill["slug"]
    ref_path = skill["video"]["path"]
    duration = float(skill["video"]["duration_s"])
    tmp = config.TMP_DIR / f"e2e_{slug}_{case}.mp4"
    if case == "self":
        return {"src": ref_path}
    if case == "backup":
        name = catalog.REFERENCE_FILES.get(slug, {}).get("backup")
        if not name:
            return None
        # If the skill was seeded from the backup, use the primary as the other performance.
        other = name if skill["video"]["original_name"] != name else catalog.REFERENCE_FILES[slug]["primary"]
        return {"src": str(config.REFERENCE_DIR / other)}
    if case == "missing":
        step = pick_missing(skill)
        if not step:
            return None
        media.cut(ref_path, tmp, _segments_without(step, _last_step_end(skill)))
        return {"src": str(tmp), "missing_step": step["step_id"], "detail": f'cut "{step["title"]}"'}
    if case == "swapped":
        pair = pick_swap(skill)
        if not pair:
            return None
        m, s = pair
        parts = [(0.0, m["start_s"]), (s["start_s"], s["end_s"]), (m["end_s"], s["start_s"]),
                 (m["start_s"], m["end_s"]), (s["end_s"], _last_step_end(skill))]
        media.cut(ref_path, tmp, [(float(a), float(b)) for a, b in parts if b - a >= 0.5])
        return {"src": str(tmp), "swapped": (s["step_id"], m["step_id"]),
                "detail": f'"{s["title"]}" moved before "{m["title"]}"'}
    if case == "truncated":
        step = pick_truncation(skill)
        if not step:
            return None
        media.cut(ref_path, tmp, [(0.0, float(step["start_s"]))])
        return {"src": str(tmp), "from_order": step["ord"], "detail": f'stopped before "{step["title"]}"'}
    if case == "wrong":
        other = WRONG_FOR.get(slug, DEFAULT_WRONG)
        return {"src": str(config.REFERENCE_DIR / catalog.REFERENCE_FILES[other]["primary"]),
                "detail": f"video of {other}"}
    return None


def run_case(skill: dict, case: str) -> dict:
    row = {"skill": skill["slug"], "case": case}
    started = time.time()
    try:
        spec = build_case(skill, case)
        if spec is None:
            return {**row, "skipped": True, "detail": "not applicable for this skill"}
        video = jobs.ingest(spec["src"], "attempt", f"e2e {skill['slug']} {case}")
        attempt_id = repo.create_attempt(skill["id"], video["id"], f"e2e:{case}")
        job_id = repo.create_job("attempt", video["id"], skill_id=skill["id"], attempt_id=attempt_id)
        jobs.run_attempt(job_id)
        job = repo.get_job(job_id)
        attempt = repo.get_attempt(attempt_id)
    except Exception as exc:
        return {**row, "error": f"{type(exc).__name__}: {exc}"}
    if job["status"] != "done":
        return {**row, "error": (job["error"] or "")[:300], "attempt_id": str(attempt_id)}

    steps = attempt["steps"]
    statuses = {s["step_id"]: s["status"] for s in steps}
    found = {s["step_id"]: bool(s["found"]) for s in steps}
    violations = [(v["step_id"], v["expected_after"]) for v in attempt["order_violations"]]
    counted = [f for f in attempt["safety_flags"] if f["counts_toward_score"]]
    row.update(
        attempt_id=str(attempt_id), detail=spec.get("detail", ""), overall=attempt["status"],
        score=attempt["score_pct"], skill_match=attempt["skill_match"],
        steps="".join({"passed": "P", "failed": "F", "unverified": "U"}.get(statuses[s["step_id"]], "?") for s in steps),
        not_found=[k for k, v in found.items() if not v], violations=violations,
        flags=[f"{f['severity']}:{f['kind']}" for f in counted],
        double_checked=sum(1 for s in steps if s["double_checked"]),
        stages={s["name"]: s["status"] for s in job["stages"]}, seconds=round(time.time() - started, 1),
    )
    # Expectations
    ok: bool | None = None
    if case == "self":
        ok = attempt["status"] != "failed" and not violations and not row["not_found"]
    elif case == "missing":
        ok = statuses.get(spec["missing_step"]) != "passed" and attempt["status"] != "passed"
    elif case == "swapped":
        ok = any(v[0] == spec["swapped"][0] for v in violations)
    elif case == "wrong":
        ok = attempt["skill_match"] is False and attempt["status"] == "failed"
    elif case == "truncated":
        later = [s for s in steps if s["ord"] >= spec["from_order"]]
        ok = all(s["status"] != "passed" for s in later) and attempt["status"] != "passed"
    row["expected_ok"] = ok
    return row


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skills", default="", help="comma-separated slugs (default: all seeded)")
    parser.add_argument("--cases", default=",".join(CASES))
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()

    db.migrate()
    config.ensure_dirs()
    skills = latest_skills()
    slugs = [s for s in args.skills.split(",") if s] or list(skills)
    cases = [c for c in args.cases.split(",") if c in CASES]
    todo = []
    for slug in slugs:
        if slug not in skills:
            print(f"skip {slug}: not seeded")
            continue
        full = repo.get_skill(skills[slug]["id"])
        todo += [(full, c) for c in cases]

    spent_before = gemini.spent_usd()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        rows = list(pool.map(lambda t: run_case(*t), todo))

    bad = 0
    for r in rows:
        if r.get("skipped"):
            print(f"-     {r['skill']:<20} {r['case']:<8} skipped ({r['detail']})")
            continue
        if r.get("error"):
            bad += 1
            print(f"ERROR {r['skill']:<20} {r['case']:<8} {r['error']}")
            continue
        mark = {True: "ok   ", False: "WRONG", None: "info "}[r["expected_ok"]]
        bad += r["expected_ok"] is False
        print(f"{mark} {r['skill']:<20} {r['case']:<8} overall={r['overall']:<10} score={r['score']} steps={r['steps']} "
              f"match={r['skill_match']} not_found={r['not_found']} violations={r['violations']} flags={r['flags']} "
              f"rechecked={r['double_checked']} {r['seconds']}s  {r['detail']}")
    out = config.DATA_DIR / "e2e_report.json"
    out.write_text(json.dumps(rows, indent=2, default=str))
    print(f"\n{len(rows)} cases, {bad} not as expected. Gemini spend for this run: "
          f"${gemini.spent_usd() - spent_before:.3f}. Report: {out}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
