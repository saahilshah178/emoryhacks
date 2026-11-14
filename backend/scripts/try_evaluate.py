"""Run the evaluate stage against real Gemini on known cases and print the results.

  cd backend && uv run python -m scripts.try_evaluate self_glove
  cd backend && uv run python -m scripts.try_evaluate missing_glove mismatch pose_ok

Cases (rubrics and timelines come from tests/fixtures_evaluate.py):
  self_sit       sittostand_primary.mp4 graded against its own rubric (should mostly pass)
  self_glove     Glove Removal Primary.mp4 graded against its own rubric (should mostly pass)
  missing_glove  the glove video cut so the second glove is never removed (s4, s5 should fail)
  mismatch       Fall Response Backup.mp4 graded as sit to stand (skill_match should be false)
  pose_ok        a pose flag on the seated part of the sit-to-stand video (should stay advisory)

Each video is ingested once and reused on later runs (matched by its name in the videos table).
"""
from __future__ import annotations

import argparse
import json
import textwrap

from app import config, db, gemini, jobs, media
from app.models import Rubric, SafetyFlag, Timeline, TimelineStep
from app.stages import evaluate, scoring
from tests import fixtures_evaluate as fx


def _video(name: str, src_path, segments=None) -> dict:
    """The attempt video row for name, ingesting (and cutting) it the first time."""
    row = db.fetch_one("SELECT * FROM videos WHERE kind='attempt' AND original_name=%s ORDER BY recorded_at DESC LIMIT 1",
                       (name,))
    if row:
        return row
    path = src_path
    if segments:
        config.ensure_dirs()
        path = config.TMP_DIR / f"{name.replace(':', '_')}.mp4"
        media.cut(src_path, path, segments)
    return jobs.ingest(str(path), "attempt", name)


def _not_found(rubric: Rubric) -> Timeline:
    return Timeline(steps=[TimelineStep(step_id=s.step_id, found=False, note="not seen") for s in rubric.steps],
                    missing_step_ids=[s.step_id for s in rubric.steps])


def _print_evaluation(rubric: Rubric, timeline: Timeline, ev, ctx) -> None:
    titles = {s.step_id: (s.title, s.critical) for s in rubric.steps}
    print(f"skill_match={ev.skill_match} {ev.skill_match_note}")
    for p in ev.people:
        print(f"  person {p.label} {p.role}: {p.description}")
    print(f"{'step':<5}{'title':<40}{'crit':<6}{'status':<12}{'conf':<6}{'2nd':<5}evidence time")
    for r in ev.steps:
        title, critical = titles[r.step_id]
        span = f"{r.evidence_start_s}-{r.evidence_end_s}" if r.evidence_start_s is not None else "-"
        print(f"{r.step_id:<5}{title[:38]:<40}{'yes' if critical else '':<6}{r.status:<12}{r.confidence:<6}"
              f"{'yes' if r.double_checked else '':<5}{span}")
        print(textwrap.indent(textwrap.fill(f"feedback: {r.feedback}", 110), "      "))
        print(textwrap.indent(textwrap.fill(f"evidence: {r.evidence}", 110), "      "))
    for f in ev.safety_flags:
        print(f"  flag {f.severity} {f.kind} {f.start_s}-{f.end_s} {f.person_label}: {f.description}")
    print(f"overall feedback: {ev.overall_feedback}")
    for line in ctx.logs:
        print(f"  log: {line}")
    sc = scoring.score(rubric, timeline, ev, ev.safety_flags)
    print(f"SCORE {sc.overall} {sc.score_pct}% review={sc.needs_nurse_review}")
    for reason in sc.reasons:
        print(f"  - {reason}")


def grade(name: str, src, skill: dict, rubric: Rubric, timeline: Timeline, segments=None, dump=None) -> None:
    video = _video(name, config.REFERENCE_DIR / src, segments)
    ctx = jobs.StageContext(job_id=None, video=video, skill=skill)
    print(f"\n=== {name}: {src} ({ctx.duration:.0f}s) graded as {skill['name']}")
    ev = evaluate.run(ctx, rubric, timeline)
    _print_evaluation(rubric, timeline, ev, ctx)
    if dump:
        with open(dump, "a") as out:
            out.write(json.dumps({"case": name, "evaluation": ev.model_dump()}) + "\n")


def pose_ok(dump=None) -> None:
    name = "try_evaluate:self_sit"
    video = _video(name, config.REFERENCE_DIR / "sittostand_primary.mp4")
    ctx = jobs.StageContext(job_id=None, video=video, skill=fx.SIT_TO_STAND_SKILL)
    candidate = SafetyFlag(kind="patient_off_center", severity="medium", start_s=14.0, end_s=18.0, person_label="P2",
                           description="Pose readings show the centre of mass outside the base of support.",
                           source="pose", counts_toward_score=False)
    print(f"\n=== pose_ok: candidate {candidate.kind} at {candidate.start_s}-{candidate.end_s}s (patient seated)")
    out = evaluate.confirm_pose_flags(ctx, fx.SIT_TO_STAND, [candidate])
    for f in out:
        print(f"  -> source={f.source} counts={f.counts_toward_score} severity={f.severity}: {f.description}")
    for line in ctx.logs:
        print(f"  log: {line}")
    if dump:
        with open(dump, "a") as out_file:
            out_file.write(json.dumps({"case": "pose_ok", "flags": [f.model_dump() for f in out]}) + "\n")


CASES = {
    "self_sit": lambda d: grade("try_evaluate:self_sit", "sittostand_primary.mp4", fx.SIT_TO_STAND_SKILL,
                                fx.SIT_TO_STAND, fx.SIT_TO_STAND_TIMELINE, dump=d),
    "self_glove": lambda d: grade("try_evaluate:self_glove", "Glove Removal Primary.mp4", fx.GLOVE_SKILL,
                                  fx.GLOVE_REMOVAL, fx.GLOVE_TIMELINE, dump=d),
    "missing_glove": lambda d: grade("try_evaluate:missing_glove", "Glove Removal Primary.mp4", fx.GLOVE_SKILL,
                                     fx.GLOVE_REMOVAL, fx.GLOVE_MISSING_TIMELINE,
                                     segments=fx.GLOVE_MISSING_SEGMENTS, dump=d),
    "mismatch": lambda d: grade("try_evaluate:mismatch", "Fall Response Backup.mp4", fx.SIT_TO_STAND_SKILL,
                                fx.SIT_TO_STAND, _not_found(fx.SIT_TO_STAND), dump=d),
    "pose_ok": pose_ok,
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("cases", nargs="+", choices=list(CASES))
    parser.add_argument("--dump", help="append each result as a JSON line to this file")
    args = parser.parse_args()
    if config.FAKE_AI:
        print("FIRSTSHIFT_FAKE_AI is set: results are canned, not from Gemini.")
    db.migrate()
    for case in args.cases:
        CASES[case](args.dump)
    print(f"\nrecorded Gemini spend: ${gemini.spent_usd():.4f} of ${config.GEMINI_BUDGET_USD:.2f}")
