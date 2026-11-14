"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Loadable, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { AiAssessment, AttemptSummary } from "@/lib/types";
import { earlierRecordings, PendingReviewsTable } from "@/nurse/components/dashboard/PendingReviewsTable";
import { PageHeading } from "@/shared/layout/PageHeading";

type Filter = "all" | "forced" | AiAssessment;

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All pending" },
  { id: "forced", label: "Sent anyway" },
  { id: "safety_concern", label: "Safety concern" },
  { id: "needs_review", label: "Needs review" },
  { id: "not_passed", label: "Not passed" },
  { id: "passed", label: "AI passed" },
];

// New submissions show up without a reload.
const REFRESH_MS = 15_000;

export default function PendingPage() {
  useTitle("Pending reviews");
  const [filter, setFilter] = useState<Filter>("all");
  const pending = useApi<AttemptSummary[]>("/attempts?state=pending", { refreshMs: REFRESH_MS });
  // Every recording, sent or not, to say how many came before each one in the queue.
  const everything = useApi<AttemptSummary[]>("/attempts?all=1", { refreshMs: REFRESH_MS });

  return (
    <div className="space-y-5">
      <PageHeading
        title="Pending reviews"
        description="The latest recording each caregiver sent you for each skill. AI assessments sort the work; certification happens only after you approve or request retraining."
      />

      <Loadable
        data={pending.data}
        error={pending.error}
        loading={pending.loading}
        reload={pending.reload}
        skeleton={
          <div className="space-y-4">
            <Skeleton className="h-9 w-[520px] max-w-full" />
            <Skeleton className="h-72" />
          </div>
        }
      >
        {(all) => {
          const matches = (id: Filter, item: AttemptSummary) =>
            id === "all" || (id === "forced" ? item.submit_kind === "forced" : item.ai_assessment === id);
          const count = (id: Filter) => all.filter((item) => matches(id, item)).length;
          const rows = all.filter((item) => matches(filter, item));
          const active = filters.find((item) => item.id === filter) ?? filters[0];

          return (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter the queue">
                {filters.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                    aria-pressed={filter === item.id}
                    className={cn(
                      "h-9 rounded-full border px-3 text-sm",
                      filter === item.id
                        ? "border-teal bg-teal-soft text-teal"
                        : "border-border bg-white text-ink-secondary hover:bg-secondary",
                    )}
                  >
                    {item.label}
                    <span className="ml-2 text-xs">{count(item.id)}</span>
                  </button>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>{plural(rows.length, "submission")}</CardTitle>
                </CardHeader>
                <CardBody>
                  {all.length === 0 ? (
                    <EmptyState title="No submissions waiting for review">
                      When a caregiver sends you a recording, it appears here. Practice runs they have not sent stay
                      with them. This list refreshes on its own.
                    </EmptyState>
                  ) : rows.length === 0 ? (
                    <EmptyState title={`Nothing under “${active.label}”`}>
                      {filter === "forced"
                        ? "No caregiver has sent a recording anyway, under the score needed to send."
                        : "None of the pending submissions have this AI assessment."}
                    </EmptyState>
                  ) : (
                    <PendingReviewsTable attempts={rows} earlier={earlierRecordings(rows, everything.data)} />
                  )}
                  <p className="mt-3 text-xs text-ink-secondary">
                    One row per caregiver and skill: when a caregiver sends a newer recording, it takes the place of
                    the one waiting here. Earlier recordings, and practice runs never sent to you, are on each
                    caregiver&apos;s page.
                  </p>
                </CardBody>
              </Card>
            </>
          );
        }}
      </Loadable>
    </div>
  );
}
