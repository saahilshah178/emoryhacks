"use client";

import Link from "next/link";
import { BadgeCheck, CircleAlert, RotateCcw, Video, type LucideIcon } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorNote, Skeleton } from "@/components/ui";
import { resultsHref } from "@/caregiver/skills";
import { cn } from "@/lib/cn";
import { formatDateTime, relativeTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { AttemptSummary } from "@/lib/types";

const SHOWN = 6;

type Update = { id: string; time: string; title: string; detail: string; href: string; icon: LucideIcon; tone: string };

/** What happened to a recording after it was sent, in the caregiver's words. */
const afterSending: Record<AttemptSummary["review_state"], string> = {
  processing: "It is being checked now.",
  error: "It couldn't be checked. Please record it again.",
  unsubmitted: "It is checked and has not been sent to a nurse yet.",
  pending: "It is with a nurse for review.",
  superseded: "You sent a newer recording, so a nurse will review that one instead.",
  approved: "A nurse has since verified it.",
  retraining: "A nurse has since asked you to practice it again.",
};

/** Each recording the caregiver sent, and each decision a nurse made on one, newest first. */
function updatesFrom(attempts: AttemptSummary[]): Update[] {
  const updates: Update[] = [];
  for (const attempt of attempts) {
    const href = resultsHref(attempt.skill_id, attempt.id);
    updates.push({
      id: `${attempt.id}-sent`,
      time: attempt.created_at,
      title: `You sent a recording of ${attempt.skill_name}`,
      detail: afterSending[attempt.review_state],
      href,
      icon: attempt.review_state === "error" ? CircleAlert : Video,
      tone: attempt.review_state === "error" ? "bg-danger-bg text-danger" : "bg-info-bg text-info",
    });
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
        <div>
          <CardTitle>Recent activity</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">Your recordings and your nurse&apos;s decisions.</p>
        </div>
      </CardHeader>
      <CardBody className="space-y-1">
        {data ? (
          data.length === 0 ? (
            <EmptyState title="Nothing yet">
              When you send a recording, it appears here, followed by your nurse&apos;s decision.
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
