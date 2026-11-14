// What the nurse dashboard and the caregiver portal both need to know about a step's result
// and its condition. The words and colours for each result are in lib/status.ts.
import type { AttemptStep, SkillStep, Status, StepStatus } from "./types";

/** The step was not needed in this recording: it is left out of the score and of every count. */
export const NOT_NEEDED = "not_applicable" satisfies StepStatus;

export function isNotNeeded(status: StepStatus | null | undefined): status is typeof NOT_NEEDED {
  return status === NOT_NEEDED;
}

/** The result that stands for a step: the nurse's, otherwise the automatic check's. */
export function savedStatus(step: Pick<AttemptStep, "status" | "nurse_status">): StepStatus | null {
  return step.nurse_status ?? step.status;
}

/** The situation a step is needed in, or "" for a step every recording must show. */
export function appliesWhen(step: Pick<SkillStep, "applies_when">): string {
  return (step.applies_when ?? "").trim();
}

/**
 * The step's condition as a sentence, "Only needed when the patient is hurt.", or null for a
 * step every recording must show. Copes with a condition written as "When ..." or "If ...".
 */
export function onlyNeededWhen(step: Pick<SkillStep, "applies_when">): string | null {
  let text = appliesWhen(step)
    .replace(/^only needed\s+/i, "")
    .replace(/^(when|if)\s+/i, "")
    .replace(/[.\s]+$/, "");
  if (!text) return null;
  // "The patient ..." reads as "the patient ..." mid-sentence; "BP ..." keeps its capitals.
  if (/^[A-Z][a-z]/.test(text)) text = text[0].toLowerCase() + text.slice(1);
  return `Only needed when ${text}.`;
}

export type StepTally = {
  /** Steps with each result, not-needed ones left out. */
  counts: Record<Status, number>;
  /** Steps that have a result and count: the "of 7" in "5 of 7 steps". */
  counted: number;
  notNeeded: number;
};

/** Counts the steps by result. A step that was not needed is in neither number of "5 of 7". */
export function tallySteps<T>(steps: T[], statusOf: (step: T) => StepStatus | null): StepTally {
  const tally: StepTally = { counts: { passed: 0, unverified: 0, failed: 0 }, counted: 0, notNeeded: 0 };
  for (const step of steps) {
    const status = statusOf(step);
    if (!status) continue;
    if (isNotNeeded(status)) {
      tally.notNeeded += 1;
    } else {
      tally.counts[status] += 1;
      tally.counted += 1;
    }
  }
  return tally;
}
