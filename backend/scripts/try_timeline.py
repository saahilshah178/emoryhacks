"""Run the timeline stage with real Gemini on synthetic attempts that have known ground truth.

  uv run python -m scripts.try_timeline                       # the sit-to-stand cases
  uv run python -m scripts.try_timeline fall_original fall_backup
  uv run python -m scripts.try_timeline all --refine on      # force the boundary pass (default: auto)
  uv run python -m scripts.try_timeline --list

Cases live in tests/fixtures_timeline.py. Each cut video is built once with media.cut
and ingested once, so repeat runs reuse the Gemini upload. Prints, per step, the found
time against the true time and the boundary error in seconds.
"""
from __future__ import annotations

import argparse
import time

from app import config, db, gemini, jobs, media
from app.stages import timeline
from tests.fixtures_timeline import BY_NAME, CASES, Case, expected_times


def video_for(case: Case) -> dict:
    """The ingested video row for a case, building and ingesting it on first use."""
    # The segments are part of the name so that editing a case builds a fresh cut.
    name = f"fixture:{case.name}:{case.segments}" if case.segments else case.source
    row = db.fetch_one("SELECT * FROM videos WHERE kind='attempt' AND original_name=%s ORDER BY recorded_at DESC LIMIT 1",
                       (name,))
    if row:
        return row
    src = config.REFERENCE_DIR / case.source
    if case.segments:
        cut = config.TMP_DIR / "timeline_fixtures" / f"{case.name}.mp4"
        media.cut(src, cut, case.segments)
        src = cut
    return jobs.ingest(str(src), "attempt", name)


def run_case(case: Case, refine: bool | None) -> list[float]:
    """Run one case, print the comparison and return the absolute boundary errors."""
    video = video_for(case)
    ctx = jobs.StageContext(job_id=None, video=video)
    spent = gemini.spent_usd()
    started = time.time()
    tl = timeline.run(ctx, case.rubric, refine=refine)
    cost = gemini.spent_usd() - spent
    truth = expected_times(case.segments or [(0, ctx.duration)], case.truth) if case.truth else {}

    print(f"\n=== {case.name}  ({ctx.duration:.1f}s, refine={refine}, ${cost:.4f}, {time.time() - started:.0f}s)")
    titles = {s.step_id: s.title for s in case.rubric.steps}
    errors: list[float] = []
    for s in tl.steps:
        got = f"{s.start_s:6.1f}-{s.end_s:6.1f}" if s.found else "   not found "
        line = f"  {s.step_id:<3} {titles[s.step_id][:34]:<34} #{s.performed_index or '-':<2} {got}  conf={s.confidence:.2f}"
        if s.step_id in truth:
            want = truth[s.step_id]
            if want is None:
                line += "   truth: cut out" + ("  OK" if not s.found else "  WRONG (should be missing)")
            elif not s.found:
                line += f"   truth: {want[0]:6.1f}-{want[1]:6.1f}  MISSED"
            else:
                e0, e1 = s.start_s - want[0], s.end_s - want[1]
                errors += [abs(e0), abs(e1)]
                line += f"   truth: {want[0]:6.1f}-{want[1]:6.1f}  err {e0:+5.1f} / {e1:+5.1f}"
        print(line + (f"   [{s.note}]" if s.note else ""))
    print("  violations:", [(v.step_id, v.expected_after, v.at_s) for v in tl.order_violations] or "none")
    print("  missing:   ", tl.missing_step_ids or "none")
    got_v = {(v.step_id, v.expected_after) for v in tl.order_violations}
    if case.expect_violations or case.truth:
        print("  expected violations present:", set(case.expect_violations) <= got_v,
              "| unexpected:", sorted(got_v - set(case.expect_violations)) or "none")
    if case.expect_missing:
        print("  expected missing present:", set(case.expect_missing) <= set(tl.missing_step_ids))
    if errors:
        print(f"  boundary error: mean {sum(errors) / len(errors):.1f}s  max {max(errors):.1f}s")
    for line in ctx.logs:
        print("  log:", line[:600])
    return errors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("cases", nargs="*", default=["sts_original", "sts_swap_s3_s4", "sts_without_s4"])
    parser.add_argument("--refine", choices=["auto", "on", "off"], default="auto", help="per-step boundary pass")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    if args.list:
        for c in CASES:
            print(c.name, "-", c.source)
        return
    names = [c.name for c in CASES] if args.cases == ["all"] else args.cases
    all_errors: list[float] = []
    for name in names:
        all_errors += run_case(BY_NAME[name], refine={"auto": None, "on": True, "off": False}[args.refine])
    if all_errors:
        print(f"\nALL: mean boundary error {sum(all_errors) / len(all_errors):.1f}s over {len(all_errors)} boundaries")
    print(f"Recorded spend: ${gemini.spent_usd():.4f} of ${config.GEMINI_BUDGET_USD:.2f}")


if __name__ == "__main__":
    main()
