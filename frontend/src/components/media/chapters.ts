// Turning a skill's or an attempt's steps into chapters for <StepChapters>.
import { hasSpan } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { isNotNeeded, savedStatus } from "@/lib/steps";
import type { AttemptStep, SkillStep, StepStatus } from "@/lib/types";
import type { Chapter } from "./StepChapters";

const byOrd = <T extends { ord: number }>(steps: T[]) => [...steps].sort((a, b) => a.ord - b.ord);

/** A skill's steps over its reference video. start === end means a step is not timed. */
export function referenceChapters(steps: SkillStep[]): Chapter[] {
  return byOrd(steps).map((step) => {
    const timed = hasSpan(step.start_s, step.end_s);
    return {
      id: step.step_id,
      number: step.ord,
      title: step.title,
      start: timed ? step.start_s : null,
      end: timed ? step.end_s : null,
    };
  });
}

export type AttemptSpan = { start: number; end: number; byGrader: boolean };

/**
 * Where a step is in the caregiver's recording: where the timeline found it, or else the
 * stretch the grader cited as evidence (the grader looks for steps the timeline missed).
 * Null when neither: the step was not seen, and no time is made up for it. Null too for a
 * step that was not needed (status, by default the saved result): it has no time range.
 */
export function attemptStepSpan(step: AttemptStep, status: StepStatus | null = savedStatus(step)): AttemptSpan | null {
  if (isNotNeeded(status)) return null;
  if (step.found && hasSpan(step.start_s, step.end_s)) {
    return { start: step.start_s as number, end: step.end_s as number, byGrader: false };
  }
  if (hasSpan(step.evidence_start_s, step.evidence_end_s)) {
    return { start: step.evidence_start_s as number, end: step.evidence_end_s as number, byGrader: true };
  }
  return null;
}

/**
 * An attempt's steps over the caregiver's recording. Steps placed only by the grader's
 * evidence are drawn faded; steps with no place are left for the "not seen" line, and steps
 * that were not needed for their own line. describe() can colour a step and add words to its
 * label, e.g. its graded status; its status, when given, replaces the saved result (a nurse's
 * unsaved choice).
 */
export function attemptChapters(
  steps: AttemptStep[],
  describe?: (step: AttemptStep) => { tone?: Tone; hint?: string; status?: StepStatus | null } | null,
): Chapter[] {
  return byOrd(steps).map((step) => {
    const extra = describe?.(step) ?? {};
    const status = extra.status !== undefined ? extra.status : savedStatus(step);
    const span = attemptStepSpan(step, status);
    const hints = [extra.hint, span?.byGrader ? "placed by what the check saw" : null].filter(Boolean);
    return {
      id: step.step_id,
      number: step.ord,
      title: step.title,
      start: span?.start ?? null,
      end: span?.end ?? null,
      tone: extra.tone,
      faded: span?.byGrader ?? false,
      hint: hints.length ? hints.join(", ") : undefined,
      notNeeded: isNotNeeded(status),
    };
  });
}

/** The same attempt's steps over the reference video it was graded against. */
export function attemptReferenceChapters(steps: AttemptStep[]): Chapter[] {
  return byOrd(steps).map((step) => {
    const timed = hasSpan(step.ref_start_s, step.ref_end_s);
    return {
      id: step.step_id,
      number: step.ord,
      title: step.title,
      start: timed ? step.ref_start_s : null,
      end: timed ? step.ref_end_s : null,
    };
  });
}
