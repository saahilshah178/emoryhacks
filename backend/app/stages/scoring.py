"""Overall result for an attempt. Pure function of the stage outputs, so the same
inputs always give the same answer. Owned by branch feat/evaluate."""
from __future__ import annotations

from ..models import Evaluation, OrderViolation, Rubric, SafetyFlag, Score, Timeline

MAX_FAILED_FRACTION = 0.25
MAX_UNVERIFIED_FRACTION = 0.25
MAX_NOT_PASSED_FRACTION = 0.25    # failed and unverified steps together
ORDER_CONFIDENCE = 0.5            # timeline confidence needed on both steps for an order violation to fail
CRITICAL_PASS_CONFIDENCE = 0.5    # a critical step passed with less confidence than this is sent for review
ORDER_PENALTY = 15.0              # points off score_pct per order violation that fails the attempt
FLAG_PENALTY = {"high": 25.0, "medium": 10.0, "low": 5.0}
PATIENT_FLAG_KINDS = {"patient_distress", "patient_off_center", "patient_unsteady"}


def score(rubric: Rubric, timeline: Timeline, evaluation: Evaluation, flags: list[SafetyFlag]) -> Score:
    """Combine step results, order violations and safety flags into one result.

    A rubric step with no result counts as unverified. Only flags with counts_toward_score
    set are considered (unconfirmed pose flags never affect anything). Counted flags of the
    same kind whose time spans overlap are one event, kept at the highest severity, so a
    Gemini flag and a confirmed pose flag for the same moment count once. A flag is "about
    the patient" when its kind is patient_distress, patient_off_center or patient_unsteady.

    An order violation counts when the rubric's order_matters is set and the step it names
    is order_dependent. It is "confident" when the timeline located both steps with
    confidence of at least ORDER_CONFIDENCE (0.5); otherwise it is "unsure".

    failed, with needs_nurse_review set, when any of these hold:
      * the video does not show the skill (skill_match false); the score is then 0
        and this is the only reason given
      * a critical step failed
      * more than a quarter of the steps failed
      * a confident order violation
      * a high-severity flag (of any kind)
    otherwise unverified, with needs_nurse_review set, when any of these hold:
      * a critical step is unverified, or passed with confidence below CRITICAL_PASS_CONFIDENCE (0.5)
      * more than a quarter of the steps are unverified
      * more than a quarter of the steps are failed or unverified together
      * an unsure order violation
      * a medium-severity flag about the patient
    otherwise passed. needs_nurse_review is then set when any step is unverified or there
    is a medium-severity flag not about the patient; neither changes the result.

    score_pct = 100 * (passed + 0.5 * unverified) / number of rubric steps, minus
    ORDER_PENALTY (15) for each confident order violation, minus FLAG_PENALTY for each
    counted flag event: 25 for high, 10 for medium, and 5 for low when it is about the
    patient (a low flag about anything else costs nothing). It is rounded to one decimal
    and never below 0. Because a failed attempt always has a failed step, a penalty or no
    skill match, its score is never 100.

    Reasons are plain sentences for the caregiver: failure reasons first, then review
    reasons, then safety points.
    """
    steps = {s.step_id: s for s in rubric.steps}
    titles = {i: s.title for i, s in steps.items()}
    results = {r.step_id: r for r in evaluation.steps if r.step_id in steps}
    total = max(len(steps), 1)
    passed = [i for i in steps if i in results and results[i].status == "passed"]
    failed = [i for i in steps if i in results and results[i].status == "failed"]
    unverified = [i for i in steps if i not in results or results[i].status == "unverified"]

    if not evaluation.skill_match:
        note = evaluation.skill_match_note.strip()
        reason = "The video does not appear to show this skill." + (f" {note}" if note else "")
        return Score(overall="failed", score_pct=0.0, reasons=[reason], needs_nurse_review=True)

    confident, unsure = _counted_violations(rubric, timeline)
    events = merge_flags([f for f in flags if f.counts_toward_score])
    penalty = ORDER_PENALTY * len(confident) + sum(_flag_penalty(f) for f in events)
    score_pct = round(max(0.0, 100 * (len(passed) + 0.5 * len(unverified)) / total - penalty), 1)

    fail_reasons: list[str] = []
    review_reasons: list[str] = []
    notes: list[str] = []

    for i in failed:
        if steps[i].critical:
            fail_reasons.append(f'A critical step was not done correctly: "{titles[i]}".')
    if len(failed) / total > MAX_FAILED_FRACTION:
        fail_reasons.append(f"{len(failed)} of {total} steps were not done correctly.")
    fail_reasons += [f"Steps out of order: {v.message}" for v in confident]
    fail_reasons += [f"Safety risk: {f.description}" for f in events if f.severity == "high"]

    for i in unverified:
        if steps[i].critical:
            review_reasons.append(f'A critical step could not be seen clearly: "{titles[i]}".')
    for i in passed:
        if steps[i].critical and results[i].confidence < CRITICAL_PASS_CONFIDENCE:
            review_reasons.append(f'A critical step may have been done but it was hard to be sure: "{titles[i]}".')
    if len(unverified) / total > MAX_UNVERIFIED_FRACTION:
        review_reasons.append(f"{len(unverified)} of {total} steps could not be checked from the video.")
    elif len(failed) / total <= MAX_FAILED_FRACTION and (len(failed) + len(unverified)) / total > MAX_NOT_PASSED_FRACTION:
        review_reasons.append(f"{len(failed) + len(unverified)} of {total} steps were not done correctly "
                              "or could not be seen.")
    review_reasons += [f"Steps may be out of order: {v.message}" for v in unsure]
    review_reasons += [f"Patient safety concern for a nurse to review: {f.description}"
                       for f in events if f.severity == "medium" and f.kind in PATIENT_FLAG_KINDS]

    notes += [f"Safety point for a nurse to review: {f.description}"
              for f in events if f.severity == "medium" and f.kind not in PATIENT_FLAG_KINDS]
    notes += [f"Minor safety point: {f.description}"
              for f in events if f.severity == "low" and f.kind in PATIENT_FLAG_KINDS]

    if fail_reasons:
        return Score(overall="failed", score_pct=score_pct, reasons=fail_reasons + review_reasons + notes,
                     needs_nurse_review=True)
    if review_reasons:
        return Score(overall="unverified", score_pct=score_pct, reasons=review_reasons + notes,
                     needs_nurse_review=True)
    if failed or unverified:
        summary = (f"Every critical step met the criteria; {len(failed) + len(unverified)} of {total} "
                   "other steps need another try or a clearer view.")
    else:
        summary = "All steps met the criteria."
    needs_review = bool(unverified) or any(f.severity == "medium" for f in events)
    return Score(overall="passed", score_pct=score_pct, reasons=[summary] + notes, needs_nurse_review=needs_review)


def _counted_violations(rubric: Rubric, timeline: Timeline) -> tuple[list[OrderViolation], list[OrderViolation]]:
    """Order violations that count, split into (confident, unsure), one per step pair."""
    if not rubric.order_matters:
        return [], []
    steps = {s.step_id: s for s in rubric.steps}
    confidence = {t.step_id: t.confidence for t in timeline.steps if t.found}
    confident, unsure, seen = [], [], set()
    for v in timeline.order_violations:
        step = steps.get(v.step_id)
        if step is None or not step.order_dependent or (v.step_id, v.expected_after) in seen:
            continue
        seen.add((v.step_id, v.expected_after))
        sure = min(confidence.get(v.step_id, 0.0), confidence.get(v.expected_after, 0.0)) >= ORDER_CONFIDENCE
        (confident if sure else unsure).append(v)
    return confident, unsure


def merge_flags(flags: list[SafetyFlag]) -> list[SafetyFlag]:
    """One flag per event: flags of the same kind whose spans overlap (or that share a
    description) are merged, keeping the most severe. Returned in start order."""
    rank = {"high": 0, "medium": 1, "low": 2}
    events: list[SafetyFlag] = []
    for f in sorted(flags, key=lambda f: (rank.get(f.severity, 3), f.start_s)):
        if not any(_same_event(f, e) for e in events):
            events.append(f)
    return sorted(events, key=lambda f: f.start_s)


def _same_event(a: SafetyFlag, b: SafetyFlag) -> bool:
    if a.description == b.description:
        return True
    a_end = a.end_s if a.end_s is not None else a.start_s
    b_end = b.end_s if b.end_s is not None else b.start_s
    return a.kind == b.kind and a.start_s <= b_end and b.start_s <= a_end


def _flag_penalty(flag: SafetyFlag) -> float:
    if flag.severity == "low" and flag.kind not in PATIENT_FLAG_KINDS:
        return 0.0
    return FLAG_PENALTY.get(flag.severity, 0.0)
