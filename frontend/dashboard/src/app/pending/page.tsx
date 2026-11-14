"use client";

import { useMemo, useState } from "react";
import { PendingReviewsTable } from "@/components/dashboard/PendingReviewsTable";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useDashboard } from "@/context/DashboardContext";
import { cn } from "@/lib/cn";
import type { AiAssessment } from "@/lib/types";

const filters: Array<{ id: "all" | AiAssessment; label: string }> = [
  { id: "all", label: "All pending" },
  { id: "safety_concern", label: "Safety concern" },
  { id: "needs_review", label: "Needs review" },
  { id: "passed", label: "AI passed" },
];

export default function PendingPage() {
  const { submissions } = useDashboard();
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const pending = useMemo(
    () => submissions.filter((item) => item.reviewStatus === "pending"),
    [submissions],
  );
  const rows = pending.filter((item) => (filter === "all" ? true : item.aiAssessment === filter));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <p className="text-sm text-ink-secondary">
        AI assessments sort the work. Certification happens only after you approve or request
        retraining.
      </p>

      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              "h-9 rounded-full border px-3 text-sm",
              filter === item.id
                ? "border-teal bg-teal-soft text-teal"
                : "border-border bg-white text-ink-secondary hover:bg-secondary",
            )}
          >
            {item.label}
            <span className="ml-2 text-xs">
              {item.id === "all"
                ? pending.length
                : pending.filter((row) => row.aiAssessment === item.id).length}
            </span>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} {rows.length === 1 ? "submission" : "submissions"}
          </CardTitle>
        </CardHeader>
        <CardBody>
          <PendingReviewsTable submissions={rows} />
        </CardBody>
      </Card>
    </div>
  );
}
