"""Overall result for an attempt. Pure function of the stage outputs, so the same
inputs always give the same answer. Owned by branch feat/evaluate."""
from __future__ import annotations

from ..models import Evaluation, Rubric, SafetyFlag, Score, Timeline

MAX_FAILED_FRACTION = 0.25
MAX_UNVERIFIED_FRACTION = 0.25


def score(rubric: Rubric, timeline: Timeline, evaluation: Evaluation, flags: list[SafetyFlag]) -> Score:
    steps = {s.step_id: s for s in rubric.steps}
    results = {r.step_id: r for r in evaluation.steps}
    total = max(len(steps), 1)
    passed = [i for i, r in results.items() if r.status == "passed" and i in steps]
    failed = [i for i, r in results.items() if r.status == "failed" and i in steps]
    unverified = [i for i in steps if i not in results or results[i].status == "unverified"]

    fail_reasons: list[str] = []
    review_reasons: list[str] = []

    if not evaluation.skill_match:
        fail_reasons.append("The video does not appear to show this skill. " + evaluation.skill_match_note)
    for i in failed:
        if steps[i].critical:
            fail_reasons.append(f'Critical step failed: "{steps[i].title}".')
    if len(failed) / total > MAX_FAILED_FRACTION:
        fail_reasons.append(f"{len(failed)} of {total} steps failed.")
    if rubric.order_matters:
        for v in timeline.order_violations:
            step = steps.get(v.step_id)
            if step is not None and step.order_dependent:
                fail_reasons.append(f"Out of order: {v.message}")
    for f in flags:
        if not f.counts_toward_score:
            continue
        if f.severity == "high":
            fail_reasons.append(f"Safety: {f.description}")
        elif f.severity == "medium":
            review_reasons.append(f"Safety concern to review: {f.description}")

    for i in unverified:
        if steps[i].critical:
            review_reasons.append(f'Critical step could not be verified: "{steps[i].title}".')
    if len(unverified) / total > MAX_UNVERIFIED_FRACTION:
        review_reasons.append(f"{len(unverified)} of {total} steps could not be verified from the video.")

    score_pct = round(100 * (len(passed) + 0.5 * len(unverified)) / total, 1)
    if fail_reasons:
        return Score(overall="failed", score_pct=score_pct, reasons=fail_reasons + review_reasons,
                     needs_nurse_review=True)
    blocking = [r for r in review_reasons if not r.startswith("Safety concern")]
    if blocking:
        return Score(overall="unverified", score_pct=score_pct, reasons=review_reasons, needs_nurse_review=True)
    return Score(overall="passed", score_pct=score_pct,
                 reasons=review_reasons or ["All steps met the criteria."],
                 needs_nurse_review=bool(review_reasons or unverified))
