"use client";

import Link from "next/link";
import { SafetyOverview } from "@/components/dashboard/SafetyOverview";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDashboard } from "@/context/DashboardContext";
import { formatDateTime } from "@/lib/format";
import { getCaregiver, getSkill } from "@/lib/mock-data";

export default function SafetyPage() {
  const { submissions } = useDashboard();
  const open = submissions.filter(
    (item) => item.reviewStatus === "pending" && item.safetyIssues.length > 0,
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <p className="text-sm text-ink-secondary">
        Critical misses stay visible until a nurse closes them with approval or retraining.
      </p>

      <SafetyOverview />

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Open critical issues</CardTitle>
            <p className="mt-1 text-sm text-ink-secondary">
              {open.length === 0
                ? "No open safety flags in the current queue."
                : "Jump into a review to watch the flagged moment on the timeline."}
            </p>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          {open.map((item) => {
            const caregiver = getCaregiver(item.caregiverId);
            const skill = getSkill(item.skillId);
            return (
              <div
                key={item.id}
                className="rounded-[12px] border border-danger/15 bg-danger-bg/50 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">
                      {caregiver?.name} · {skill?.name}
                    </p>
                    <p className="mt-1 text-xs text-ink-muted">{formatDateTime(item.submittedAt)}</p>
                  </div>
                  <StatusBadge status="safety_concern" />
                </div>
                <ul className="mt-3 space-y-1 text-sm text-ink">
                  {item.safetyIssues.map((issue) => (
                    <li key={issue.id}>
                      {issue.title} — {issue.detail}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/reviews/${item.id}`}
                  className="mt-3 inline-flex text-sm font-medium text-teal hover:underline"
                >
                  Open skill review
                </Link>
              </div>
            );
          })}
        </CardBody>
      </Card>
    </div>
  );
}
