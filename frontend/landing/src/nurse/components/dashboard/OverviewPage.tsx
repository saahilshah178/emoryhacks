"use client";

import Link from "next/link";
import { KpiCards } from "@/nurse/components/dashboard/KpiCards";
import { PendingReviewsTable } from "@/nurse/components/dashboard/PendingReviewsTable";
import { RecentActivity } from "@/nurse/components/dashboard/RecentActivity";
import { SafetyOverview } from "@/nurse/components/dashboard/SafetyOverview";
import { Card, CardBody, CardHeader, CardTitle } from "@/nurse/components/ui/Card";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { APP_NAME } from "@/nurse/lib/branding";
import { CURRENT_NURSE } from "@/nurse/lib/mock-data";

export function OverviewPage() {
  const { submissions, pendingCount } = useDashboard();
  const pending = submissions.filter((item) => item.reviewStatus === "pending");

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-secondary">
            {CURRENT_NURSE.agency} · {CURRENT_NURSE.title}
          </p>
          <p className="mt-1 max-w-2xl text-sm text-ink-secondary">
            {APP_NAME} prepares caregiver demonstrations for your review. AI flags missed steps;
            you remain the only person who can approve a skill.
          </p>
        </div>
        <p className="rounded-full bg-warning-bg px-3 py-1 text-xs font-medium text-warning">
          {pendingCount} submissions need a nurse decision
        </p>
      </div>

      <KpiCards />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Pending reviews</CardTitle>
              <p className="mt-1 text-sm text-ink-secondary">
                Newest caregiver submissions. Open a row to compare against the nurse reference.
              </p>
            </div>
            <Link href="/dashboard/pending" className="text-sm font-medium text-teal hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardBody>
            <PendingReviewsTable submissions={pending.slice(0, 6)} compact />
          </CardBody>
        </Card>
        <RecentActivity />
      </div>

      <SafetyOverview />
    </div>
  );
}
