// The nurse's words for attempts allowed, scores and recordings. The rules behind them are in
// backend/app/progress.py; this file only says them.
import { plural } from "@/lib/format";
import type { Tone } from "@/lib/status";
import type { AttemptSummary, ReviewState } from "@/lib/types";

/** The API's bounds for attempts allowed (progress.MAX_ATTEMPTS). */
export const MIN_ATTEMPTS = 1;
export const MAX_ATTEMPTS = 50;

/** 64 -> "64%", 79.6 -> "79.6%": never rounded across a bar, as the API writes it. */
export function pct(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

/** A skill's number on a card: "Unlimited attempts" or "3 attempts each". */
export function attemptsEach(max: number | null) {
  return max === null ? "Unlimited attempts" : `${plural(max, "attempt")} each`;
}

/** "2 of 3 used" or "2 used, no limit". */
export function usedOfAllowed(used: number, allowed: number | null) {
  return allowed === null ? `${used} used, no limit` : `${used} of ${allowed} used`;
}

/** "None left", "1 left" or null when unlimited. */
export function leftText(left: number | null) {
  if (left === null) return null;
  return left === 0 ? "None left" : `${left} left`;
}

export function leftTone(left: number | null): Tone {
  if (left === null) return "neutral";
  return left === 0 ? "danger" : left === 1 ? "warning" : "neutral";
}

/** What a caregiver gets after a retraining request: "3 attempts" or "unlimited attempts". */
export function freshSet(allowed: number | null) {
  return allowed === null ? "unlimited attempts" : plural(allowed, "attempt");
}

/** A whole number from min to max, or null. */
export function parseCount(text: string, min = MIN_ATTEMPTS, max = MAX_ATTEMPTS) {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** A score from 0 to 100 (one decimal allowed), or null. */
export function parsePercent(text: string) {
  if (!/^\d{1,3}(\.\d)?$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= 0 && n <= 100 ? n : null;
}

/**
 * Each recording's state in the nurse's words. Differs from lib/status only where the nurse
 * needs to know that a recording was never sent to her.
 */
export const recordingState: Record<ReviewState, { label: string; tone: Tone }> = {
  processing: { label: "Being graded", tone: "info" },
  error: { label: "Could not be processed", tone: "danger" },
  unsubmitted: { label: "Practice run, not sent", tone: "neutral" },
  pending: { label: "Waiting for you", tone: "warning" },
  superseded: { label: "Replaced by a newer one", tone: "neutral" },
  approved: { label: "Approved", tone: "success" },
  retraining: { label: "Retraining requested", tone: "danger" },
};

/** When the caregiver sent it, or when it was recorded for one they never sent. */
export function sentOrRecorded(item: Pick<AttemptSummary, "submitted_at" | "created_at">) {
  return item.submitted_at ?? item.created_at;
}

/** Same caregiver, same skill (across versions). */
export function seriesKey(item: Pick<AttemptSummary, "caregiver_id" | "skill_slug">) {
  return `${item.caregiver_id ?? ""}:${item.skill_slug}`;
}

/** The caregiver page's history, filtered to one skill. */
export function historyHref(caregiverId: string, slug?: string) {
  return `/dashboard/caregivers/${caregiverId}#history${slug ? `-${slug}` : ""}`;
}
