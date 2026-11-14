// How the review screen reads an attempt's steps.
import { attemptStepSpan, type AttemptSpan } from "@/components/media/chapters";
import { isNotNeeded } from "@/lib/steps";
import type { Attempt, AttemptStep, OrderViolation, StepReview, StepStatus } from "@/lib/types";

export type Span = AttemptSpan;

/** The nurse's per-step choice while the decision form is open. */
export type Override = { status: StepStatus | null; note: string };
export type Overrides = Record<string, Override>;

/**
 * Where a step is in the attempt video: the timeline's span, or else the stretch the grader
 * cited as evidence (the grader looks for steps the timeline missed). Null when neither, and
 * null for a step that was not needed (counting the nurse's unsaved choice): it has no time.
 */
export function stepSpan(step: AttemptStep, override?: Override | null): Span | null {
  return attemptStepSpan(step, effectiveStatus(step, override));
}

/** Steps that have a place in the video, in video order. */
export function locatedSteps(steps: AttemptStep[], overrides: Overrides = {}) {
  return steps
    .map((step) => ({ step, span: stepSpan(step, overrides[step.step_id]) }))
    .filter((item): item is { step: AttemptStep; span: Span } => item.span !== null)
    .sort((a, b) => a.span.start - b.span.start || a.step.ord - b.step.ord);
}

/**
 * The status that stands for a step: while the form is open, the nurse's draft (a cleared
 * choice means the AI's again); otherwise the nurse's saved status, then the AI's.
 */
export function effectiveStatus(step: AttemptStep, override?: Override | null): StepStatus | null {
  if (override) return override.status ?? step.status;
  return step.nurse_status ?? step.status;
}

/**
 * Where each step was done among the steps that were needed and done, and where it belongs
 * among them, by step_id; only steps out of their place are listed. A step that was not needed
 * (counting the nurse's unsaved choice) or was not done takes no place, so leaving one out
 * does not move the others: with steps 1 and 2 not needed, step 3 done first is in its place.
 */
export function orderPlaces(steps: AttemptStep[], overrides: Overrides = {}): Record<string, { done: number; expected: number }> {
  const done = steps.filter(
    (s) => s.performed_index !== null && !isNotNeeded(effectiveStatus(s, overrides[s.step_id])),
  );
  const byOrd = [...done].sort((a, b) => a.ord - b.ord);
  const byDone = [...done].sort((a, b) => (a.performed_index ?? 0) - (b.performed_index ?? 0) || a.ord - b.ord);
  const out: Record<string, { done: number; expected: number }> = {};
  byDone.forEach((step, index) => {
    const expected = byOrd.indexOf(step) + 1;
    if (expected !== index + 1) out[step.step_id] = { done: index + 1, expected };
  });
  return out;
}

export function violationsFor(attempt: Pick<Attempt, "order_violations">, stepId: string): OrderViolation[] {
  return attempt.order_violations.filter((v) => v.step_id === stepId || v.expected_after === stepId);
}

/** The step under the playhead: the latest-starting one when spans overlap. */
export function stepAt(steps: AttemptStep[], seconds: number, overrides: Overrides = {}) {
  const here = locatedSteps(steps, overrides).filter(({ span }) => span.start <= seconds && seconds < span.end);
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
export function changedSteps(steps: AttemptStep[], overrides: Overrides): StepReview[] {
  return steps
    .filter((s) => {
      const o = overrides[s.step_id];
      return o && (o.status !== s.nurse_status || o.note.trim() !== (s.nurse_note ?? "").trim());
    })
    .map((s) => ({ step_id: s.step_id, status: overrides[s.step_id].status, note: overrides[s.step_id].note.trim() }));
}
