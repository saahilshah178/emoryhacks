"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Loadable, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import type { AiAssessment, AttemptSummary } from "@/lib/types";
import { attemptMatches, PendingReviewsTable } from "@/nurse/components/dashboard/PendingReviewsTable";
import { ProcessingAttempts } from "@/nurse/components/dashboard/ProcessingAttempts";
import { PageHeading } from "@/nurse/components/layout/PageHeading";
import { useDashboard } from "@/nurse/context/DashboardContext";

type Filter = "all" | AiAssessment;

const filters: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All pending" },
  { id: "safety_concern", label: "Safety concern" },
  { id: "needs_review", label: "Needs review" },
  { id: "not_passed", label: "Not passed" },
  { id: "passed", label: "AI passed" },
];

// New submissions show up without a reload.
const REFRESH_MS = 15_000;

export default function PendingPage() {
  useTitle("Pending reviews");
  const { search } = useDashboard();
  const [filter, setFilter] = useState<Filter>("all");
  const pending = useApi<AttemptSummary[]>("/attempts?state=pending", { refreshMs: REFRESH_MS });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeading
        title="Pending reviews"
        description="AI assessments sort the work. Certification happens only after you approve or request retraining."
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
          const matching = all.filter((item) => attemptMatches(search, item));
          const count = (id: Filter) =>
            id === "all" ? matching.length : matching.filter((item) => item.ai_assessment === id).length;
          const rows = filter === "all" ? matching : matching.filter((item) => item.ai_assessment === filter);
          const active = filters.find((item) => item.id === filter) ?? filters[0];

          return (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by AI assessment">
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
                      When a caregiver records a skill demonstration, it appears here once the AI has finished its
                      first read. This list refreshes on its own.
                    </EmptyState>
                  ) : rows.length === 0 && matching.length > 0 ? (
                    <EmptyState title={`Nothing under “${active.label}”`}>
                      None of the pending submissions{search.trim() ? " that match your search" : ""} have this AI
                      assessment.
                    </EmptyState>
                  ) : (
                    <PendingReviewsTable attempts={rows} />
                  )}
                </CardBody>
              </Card>
            </>
          );
        }}
      </Loadable>

      <ProcessingAttempts />
    </div>
  );
}
