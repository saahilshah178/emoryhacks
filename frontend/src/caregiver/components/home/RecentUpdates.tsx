"use client";

import Link from "next/link";
import { BadgeCheck, CircleAlert, RotateCcw, Send, Video, type LucideIcon } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorNote, Skeleton } from "@/components/ui";
import { resultsHref } from "@/caregiver/skills";
import { formatScore } from "@/caregiver/status";
import { cn } from "@/lib/cn";
import { formatDateTime, relativeTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AttemptSummary } from "@/lib/types";

const SHOWN = 6;

type Update = { id: string; time: string; title: string; detail: string; href: string; icon: LucideIcon; tone: string };

/** What became of a recording once it was checked, in the caregiver's words. */
function afterRecording(attempt: AttemptSummary): string {
  const score = attempt.score_pct !== null ? `It scored ${formatScore(attempt.score_pct)}. ` : "";
  switch (attempt.review_state) {
    case "processing":
      return "It is being checked now.";
    case "error":
      return "It couldn't be checked, so it didn't use an attempt. Please record it again.";
    case "unsubmitted":
      if (attempt.submission.can_submit) return `${score}That's good enough to send to your nurse, if you choose to.`;
      if (attempt.submission.can_force) return `${score}You can record it again, or send it anyway with a note.`;
      return `${score}That's under what can be sent, so give it another try.`;
    default:
      return `${score}You sent it to your nurse.`;
  }
}

/** What happened to a recording after it was sent. */
const afterSending: Partial<Record<AttemptSummary["review_state"], string>> = {
  pending: "It is with your nurse for review.",
  superseded: "You sent a newer recording later, so your nurse will review that one instead.",
  approved: "Your nurse has since verified it.",
  retraining: "Your nurse has since asked you to practice it again.",
};

/**
 * Each recording the caregiver made, each one they sent, and each decision a nurse made on
 * one, newest first.
 */
function updatesFrom(attempts: AttemptSummary[]): Update[] {
  const updates: Update[] = [];
  for (const attempt of attempts) {
    const href = resultsHref(attempt.skill_id, attempt.id);
    const failed = attempt.review_state === "error";
    updates.push({
      id: `${attempt.id}-recorded`,
      time: attempt.created_at,
      title: failed ? `Your recording of ${attempt.skill_name} couldn't be checked` : `You recorded ${attempt.skill_name}`,
      detail: afterRecording(attempt),
      href,
      icon: failed ? CircleAlert : Video,
      tone: failed ? "bg-danger-bg text-danger" : "bg-info-bg text-info",
    });
    if (attempt.submitted_at) {
      const forced = attempt.submit_kind === "forced";
      updates.push({
        id: `${attempt.id}-sent`,
        time: attempt.submitted_at,
        title: forced ? `You sent ${attempt.skill_name} to your nurse anyway` : `You sent ${attempt.skill_name} to your nurse`,
        detail: `${afterSending[attempt.review_state] ?? ""}${
          forced && attempt.review_state === "pending" ? " They can see your note." : ""
        }`.trim(),
        href,
        icon: Send,
        tone: attempt.review_state === "superseded" ? "bg-secondary text-ink-secondary" : "bg-teal-soft text-teal",
      });
    }
    if (attempt.reviewed_at && (attempt.review_state === "approved" || attempt.review_state === "retraining")) {
      const nurse = attempt.reviewer_name || "A nurse";
      const approved = attempt.review_state === "approved";
      updates.push({
        id: `${attempt.id}-decided`,
        time: attempt.reviewed_at,
        title: approved ? `${nurse} verified ${attempt.skill_name}` : `${nurse} asked you to practice ${attempt.skill_name} again`,
        detail: attempt.nurse_note.trim() ? "They left you a note." : approved ? "Well done." : "Open it to see what to work on.",
        href,
        icon: approved ? BadgeCheck : RotateCcw,
        tone: approved ? "bg-success-bg text-success" : "bg-warning-bg text-warning",
      });
    }
  }
  return updates.sort((a, b) => b.time.localeCompare(a.time)).slice(0, SHOWN);
}

/** The caregiver's own recent history (GET /attempts lists only their attempts). */
export function RecentUpdates({ className }: { className?: string }) {
  const { data, error, reload } = useApi<AttemptSummary[]>("/attempts");

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardBody className="space-y-1">
        {data ? (
          data.length === 0 ? (
            <EmptyState title="Nothing yet">
              When you record a skill, it appears here. So do the recordings you send and your nurse&apos;s decisions.
            </EmptyState>
          ) : (
            updatesFrom(data).map((update) => {
              const Icon = update.icon;
              return (
                <Link key={update.id} href={update.href} className="block rounded-[12px]">
                  <div className="flex gap-3 rounded-[12px] p-2.5 hover:bg-page">
                    <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]", update.tone)}>
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{update.title}</p>
                      <p className="mt-0.5 text-xs text-ink-secondary">{update.detail}</p>
                      <p className="mt-1 text-[11px] text-ink-muted" title={formatDateTime(update.time)}>
                        {relativeTime(update.time)}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })
          )
        ) : error ? (
          <ErrorNote message={error} onRetry={reload} />
        ) : (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} className="h-14" />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
