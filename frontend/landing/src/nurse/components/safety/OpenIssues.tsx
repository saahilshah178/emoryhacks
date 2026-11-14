"use client";

import Link from "next/link";
import { TimeChip } from "@/components/media/TimeChip";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, Loadable, Skeleton, StateBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { aiAssessment, flagSeverity, flagTitle } from "@/lib/status";
import type { AttemptSummary } from "@/lib/types";

/** Pending attempts that carry safety flags counted toward the result. */
export function OpenIssues() {
  const { data, error, loading, reload } = useApi<AttemptSummary[]>("/attempts?state=pending");
  const open = (data ?? []).filter((item) => item.flag_count > 0);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Open critical issues</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">
            {data === undefined
              ? "Submissions waiting for a nurse that carry a safety flag."
              : open.length === 0
                ? "No open safety flags in the current queue."
                : "Jump into a review to watch the flagged moment on the timeline."}
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        <Loadable
          data={data}
          error={error}
          loading={loading}
          reload={reload}
          skeleton={
            <div className="space-y-3">
              <Skeleton className="h-28" />
              <Skeleton className="h-28" />
            </div>
          }
        >
          {() =>
            open.length === 0 ? (
              <EmptyState title="Nothing flagged right now">
                When the AI flags a safety concern in a submission, it appears here until a nurse approves the skill or
                requests retraining.
              </EmptyState>
            ) : (
              open.map((item) => (
                <div key={item.id} className="rounded-[12px] border border-danger/15 bg-danger-bg/50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-ink">
                        {item.caregiver_name || "Unnamed caregiver"} · {item.skill_name}
                      </p>
                      <p className="mt-1 text-xs text-ink-secondary">Submitted {formatDateTime(item.created_at)}</p>
                    </div>
                    <StateBadge entry={item.ai_assessment ? aiAssessment[item.ai_assessment] : null} />
                  </div>
                  <ul className="mt-3 space-y-2">
                    {(item.flags ?? []).map((flag) => (
                      <li key={flag.id} className="flex flex-wrap items-start gap-2 text-sm">
                        <TimeChip start={flag.start_s} end={flag.end_s} />
                        <Badge tone={flagSeverity[flag.severity].tone}>{flagSeverity[flag.severity].label}</Badge>
                        <span className="min-w-0 flex-1 basis-60 text-ink">
                          <span className="font-medium">{flagTitle(flag)}</span>
                          {flag.description ? <span className="text-ink-secondary"> — {flag.description}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href={`/dashboard/reviews/${item.id}`}
                    className="mt-3 inline-flex text-sm font-medium text-teal hover:underline"
                  >
                    Open skill review
                  </Link>
                </div>
              ))
            )
          }
        </Loadable>
      </CardBody>
    </Card>
  );
}
