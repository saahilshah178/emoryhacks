"""Overall result for an attempt. Pure function of the stage outputs, so the same
inputs always give the same answer. Owned by branch feat/evaluate."""
from __future__ import annotations

from ..models import Evaluation, Rubric, SafetyFlag, Score, Timeline

MAX_FAILED_FRACTION = 0.25
MAX_UNVERIFIED_FRACTION = 0.25


def score(rubric: Rubric, timeline: Timeline, evaluation: Evaluation, flags: list[SafetyFlag]) -> Score:
    """Combine step results, order violations and safety flags into one result.

    A rubric step with no result counts as unverified. Only flags with
    counts_toward_score set are considered (unconfirmed pose flags are ignored).

    failed, with needs_nurse_review set, when any of these hold:
      * the video does not show the skill (skill_match false); the score is then 0
        and this is the only reason given
      * a critical step failed
      * more than a quarter of the steps failed
      * an order violation names a step that is order_dependent, and the rubric's
        order_matters is set
      * a high-severity safety flag
    otherwise unverified, with needs_nurse_review set, when:
      * a critical step is unverified, or
      * more than a quarter of the steps are unverified
    otherwise passed. needs_nurse_review is then set only when there is a
    medium-severity safety flag, which asks for review without changing the result.

    score_pct is 100 * (passed + 0.5 * unverified) / number of rubric steps.
    Reasons are plain sentences for the caregiver: failure reasons first, then review reasons.
    """
    steps = {s.step_id: s for s in rubric.steps}
    titles = {i: s.title for i, s in steps.items()}
    results = {r.step_id: r for r in evaluation.steps if r.step_id in steps}
    total = max(len(steps), 1)
    passed = [i for i in steps if i in results and results[i].status == "passed"]
    failed = [i for i in steps if i in results and results[i].status == "failed"]
    unverified = [i for i in steps if i not in results or results[i].status == "unverified"]
    score_pct = round(100 * (len(passed) + 0.5 * len(unverified)) / total, 1)

    if not evaluation.skill_match:
        note = evaluation.skill_match_note.strip()
        reason = "The video does not appear to show this skill." + (f" {note}" if note else "")
        return Score(overall="failed", score_pct=0.0, reasons=[reason], needs_nurse_review=True)

    fail_reasons: list[str] = []
    review_reasons: list[str] = []

    for i in failed:
        if steps[i].critical:
            fail_reasons.append(f'A critical step was not done correctly: "{titles[i]}".')
    if len(failed) / total > MAX_FAILED_FRACTION:
        fail_reasons.append(f"{len(failed)} of {total} steps were not done correctly.")
    if rubric.order_matters:
        seen: set[str] = set()
        for v in timeline.order_violations:
            step = steps.get(v.step_id)
            if step is not None and step.order_dependent and v.message not in seen:
                seen.add(v.message)
                fail_reasons.append(f"Steps out of order: {v.message}")
    counted = [f for f in flags if f.counts_toward_score]
    for f in _unique(counted, "high"):
        fail_reasons.append(f"Safety risk: {f.description}")

    for i in unverified:
        if steps[i].critical:
            review_reasons.append(f'A critical step could not be seen clearly: "{titles[i]}".')
    if len(unverified) / total > MAX_UNVERIFIED_FRACTION:
        review_reasons.append(f"{len(unverified)} of {total} steps could not be checked from the video.")
    flag_reasons = [f"Safety point for a nurse to review: {f.description}" for f in _unique(counted, "medium")]

    if fail_reasons:
        return Score(overall="failed", score_pct=score_pct, reasons=fail_reasons + review_reasons + flag_reasons,
                     needs_nurse_review=True)
    if review_reasons:
        return Score(overall="unverified", score_pct=score_pct, reasons=review_reasons + flag_reasons,
                     needs_nurse_review=True)
    if failed or unverified:
        summary = (f"Every critical step met the criteria; {len(failed) + len(unverified)} of {total} "
                   "other steps need another try or a clearer view.")
    else:
        summary = "All steps met the criteria."
    return Score(overall="passed", score_pct=score_pct, reasons=[summary] + flag_reasons,
                 needs_nurse_review=bool(flag_reasons))


def _unique(flags: list[SafetyFlag], severity: str) -> list[SafetyFlag]:
    """Flags of one severity, dropping repeats of the same description."""
    out, seen = [], set()
    for f in flags:
        if f.severity == severity and f.description not in seen:
            seen.add(f.description)
            out.append(f)
    return out
