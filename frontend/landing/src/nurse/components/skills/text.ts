// Small helpers shared by the skill screens.
import type { SkillStep } from "@/lib/types";

/** Textarea text -> list, one item per non-empty line. */
export function toList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** List -> textarea text, one item per line. */
export function toLines(items: string[] | null | undefined): string {
  return (items ?? []).join("\n");
}

export function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** A step has a place in the reference video when it ends after it starts. */
export function isTimed(step: Pick<SkillStep, "start_s" | "end_s">) {
  return Number(step.end_s) > Number(step.start_s);
}

/** Times are stored as 4-byte floats, so show and compare them to a tenth of a second. */
export function tenth(seconds: number) {
  return String(Math.round(Number(seconds) * 10) / 10);
}

/** A frame a little inside the step, so the thumbnail is not the last frame of the step before. */
export function stepFrameTime(step: Pick<SkillStep, "start_s" | "end_s">) {
  return step.start_s + Math.min(0.5, (step.end_s - step.start_s) / 2);
}
