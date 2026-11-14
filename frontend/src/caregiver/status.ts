// The caregiver's words for attempt and skill states. The nurse dashboard keeps its own
// wording in lib/status.ts; the tones come from there so a state keeps its colour.
import { reviewState, skillState, type Tone } from "@/lib/status";
import type { AttemptAllowance, MySkill, ReviewState, SkillState } from "@/lib/types";

type Entry = { label: string; tone: Tone };

/** One recording's state, as a caregiver reads it. */
export const attemptStateForCaregiver: Record<ReviewState, Entry> = {
  processing: { label: "Checking", tone: reviewState.processing.tone },
  error: { label: "Couldn't be checked", tone: reviewState.error.tone },
  unsubmitted: { label: "Not sent", tone: "neutral" },
  pending: { label: "With your nurse", tone: skillState.in_review.tone },
  superseded: { label: "Replaced", tone: "neutral" },
  approved: { label: "Verified", tone: skillState.verified.tone },
  retraining: { label: "Practice again", tone: skillState.needs_practice.tone },
};

/** A skill's standing, as a caregiver reads it, with what its card offers to do next. */
export const skillStateForCaregiver: Record<SkillState, Entry & { action: string }> = {
  not_started: { label: "Not started", tone: "neutral", action: "Start practice" },
  practicing: { label: "Practicing", tone: "teal", action: "See your result" },
  in_review: { label: "With your nurse", tone: skillState.in_review.tone, action: "View results" },
  needs_practice: { label: "Practice again", tone: skillState.needs_practice.tone, action: "View feedback" },
  verified: { label: "Verified", tone: "success", action: "View results" },
};

/** A recording that scored high enough to send and has not been sent. It is only sent if the caregiver sends it. */
export const readyToSend: Entry & { action: string } = { label: "Good enough to send", tone: "success", action: "See your result" };

/** 64 -> "64%", 79.6 -> "79.6%", like the API's sentences: never rounded across a mark. */
export function formatScore(value: number | null | undefined) {
  const score = Number(value ?? 0);
  return Number.isInteger(score) ? `${score}%` : `${score.toFixed(1)}%`;
}

/** "1 of 3 attempts left", or null when the nurse set no limit. */
export function attemptsLeftLine(allowance: Pick<AttemptAllowance, "allowed" | "left">) {
  if (allowance.allowed === null || allowance.left === null) return null;
  if (allowance.left === 0) return allowance.allowed === 1 ? "Your only attempt is used" : `All ${allowance.allowed} attempts used`;
  return `${allowance.left} of ${allowance.allowed} ${allowance.allowed === 1 ? "attempt" : "attempts"} left`;
}

/** The sentence the API gives when every attempt is used, for when the portal says it first. */
export function noAttemptsLeft(allowed: number) {
  return `You have used ${allowed === 1 ? "your only attempt" : `all ${allowed} attempts`} for this skill. Ask your nurse for more.`;
}

/** The skill's allowance in the shape an attempt carries it. */
export function skillAllowance(skill: Pick<MySkill, "attempts_used" | "attempts_allowed" | "attempts_left">): AttemptAllowance {
  return { used: skill.attempts_used, allowed: skill.attempts_allowed, left: skill.attempts_left };
}
