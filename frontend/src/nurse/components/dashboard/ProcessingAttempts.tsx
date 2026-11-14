"use client";

import Link from "next/link";
import { Avatar, Card, CardBody, CardDescription, CardHeader, CardTitle, ErrorNote, StateBadge } from "@/components/ui";
import { formatDateTime, plural, relativeTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { reviewState } from "@/lib/status";
import type { AttemptSummary } from "@/lib/types";

const REFRESH_MS = 15_000;

/**
 * Submissions the AI is still working on, or could not process. They are not in the pending
 * queue yet (or never will be), so they are listed here to keep every submission visible.
 * Renders nothing while there are none.
 */
export function ProcessingAttempts({ className }: { className?: string }) {
  const processing = useApi<AttemptSummary[]>("/attempts?state=processing", { refreshMs: REFRESH_MS });
  const failed = useApi<AttemptSummary[]>("/attempts?state=error", { refreshMs: REFRESH_MS });

  const error = processing.error ?? failed.error;
  const rows = [...(processing.data ?? []), ...(failed.data ?? [])].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );

  if (rows.length === 0) {
    if (!error) return null;
    return (
      <ErrorNote
        className={className}
        message={`Submissions that are still being processed could not be loaded. ${error}`}
        onRetry={() => {
          processing.reload();
          failed.reload();
        }}
      />
    );
  }

  const failedCount = failed.data?.length ?? 0;

  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>Being processed</CardTitle>
          <CardDescription>
            {plural(rows.length, "submission")} not in the review queue yet.{" "}
            {failedCount > 0
              ? `${plural(failedCount, "recording")} could not be processed; open it to see why.`
              : "Each one moves to pending reviews when the AI has finished its first read."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        <ul className="divide-y divide-border overflow-hidden rounded-[12px] border border-border">
          {rows.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 bg-white px-4 py-3">
              <Avatar name={item.caregiver_name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {item.caregiver_name} <span className="font-normal text-ink-secondary">· {item.skill_name}</span>
                </p>
                <p className="text-xs text-ink-muted" title={formatDateTime(item.created_at)}>
                  {relativeTime(item.created_at)}
                </p>
              </div>
              <StateBadge entry={reviewState[item.review_state]} />
              <Link
                href={`/dashboard/reviews/${item.id}`}
                className="text-sm font-medium text-teal hover:underline"
                aria-label={`Open ${item.caregiver_name}, ${item.skill_name}`}
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
