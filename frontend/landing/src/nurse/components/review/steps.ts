// How the review screen reads an attempt's steps.
import { hasSpan } from "@/lib/format";
import type { Attempt, AttemptStep, OrderViolation, Status } from "@/lib/types";

export type Span = { start: number; end: number; byGrader: boolean };

/** The nurse's per-step choice while the decision form is open. */
export type Override = { status: Status | null; note: string };
export type Overrides = Record<string, Override>;

/**
 * Where a step is in the attempt video: the timeline's span, or else the stretch the grader
 * cited as evidence (the grader looks for steps the timeline missed). Null when neither.
 */
export function stepSpan(step: AttemptStep): Span | null {
  if (step.found && hasSpan(step.start_s, step.end_s)) {
    return { start: step.start_s as number, end: step.end_s as number, byGrader: false };
  }
  if (hasSpan(step.evidence_start_s, step.evidence_end_s)) {
    return { start: step.evidence_start_s as number, end: step.evidence_end_s as number, byGrader: true };
  }
  return null;
}

/** Steps that have a place in the video, in video order. */
export function locatedSteps(steps: AttemptStep[]) {
  return steps
    .map((step) => ({ step, span: stepSpan(step) }))
    .filter((item): item is { step: AttemptStep; span: Span } => item.span !== null)
    .sort((a, b) => a.span.start - b.span.start || a.step.ord - b.step.ord);
}

/** The status that stands for a step: the nurse's draft, then the nurse's saved status, then the AI's. */
export function effectiveStatus(step: AttemptStep, override?: Override | null): Status | null {
  return override?.status ?? step.nurse_status ?? step.status;
}

export function violationsFor(attempt: Pick<Attempt, "order_violations">, stepId: string): OrderViolation[] {
  return attempt.order_violations.filter((v) => v.step_id === stepId || v.expected_after === stepId);
}

/** The step under the playhead: the latest-starting one when spans overlap. */
export function stepAt(steps: AttemptStep[], seconds: number) {
  const here = locatedSteps(steps).filter(({ span }) => span.start <= seconds && seconds < span.end);
  return here.length ? here[here.length - 1].step : null;
}

/** Gemini's notes sometimes cite raw step ids ("Performed before s2"); show "step 2" instead. */
export function nameStepIds(text: string, steps: AttemptStep[]) {
  return text.replace(/\bs\d+\b/g, (id) => {
    const step = steps.find((s) => s.step_id === id);
    return step ? `step ${step.ord}` : id;
  });
}

export function ordinal(n: number) {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${tail}`;
}

export function initialOverrides(steps: AttemptStep[]): Overrides {
  return Object.fromEntries(steps.map((s) => [s.step_id, { status: s.nurse_status, note: s.nurse_note ?? "" }]));
}

/** The steps whose choice differs from what is saved: the only ones sent with the decision. */
export function changedSteps(steps: AttemptStep[], overrides: Overrides) {
  return steps
    .filter((s) => {
      const o = overrides[s.step_id];
      return o && (o.status !== s.nurse_status || o.note.trim() !== (s.nurse_note ?? "").trim());
    })
    .map((s) => ({ step_id: s.step_id, status: overrides[s.step_id].status, note: overrides[s.step_id].note.trim() }));
}
