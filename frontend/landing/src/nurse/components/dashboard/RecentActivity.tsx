"use client";

import Link from "next/link";
import { BadgeCheck, ClipboardPen, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorNote, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime, relativeTime } from "@/lib/format";
import type { ActivityEvent } from "@/lib/types";
import { useDashboard } from "@/nurse/context/DashboardContext";

const icons = {
  submission: ClipboardPen,
  safety: ShieldAlert,
  approval: BadgeCheck,
  retraining: RotateCcw,
  first_assessment: Sparkles,
};

const tones = {
  submission: "bg-info-bg text-info",
  safety: "bg-danger-bg text-danger",
  approval: "bg-success-bg text-success",
  retraining: "bg-warning-bg text-warning",
  first_assessment: "bg-teal-soft text-teal",
};

function hrefFor(event: ActivityEvent) {
  if (event.type === "approval") return "/dashboard/verified";
  if (event.type === "first_assessment" && event.caregiver_id) return `/dashboard/caregivers/${event.caregiver_id}`;
  return `/dashboard/reviews/${event.attempt_id}`;
}

export function RecentActivity() {
  const { overview, overviewError, reloadOverview } = useDashboard();

  return (
    <Card className="h-full">
      <CardHeader>
        <div>
          <CardTitle>Recent activity</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">
            The latest submissions, safety flags and nurse decisions.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-1">
        {overview ? (
          overview.activity.length === 0 ? (
            <EmptyState title="No activity yet">
              Submissions, safety flags and your decisions appear here as caregivers record their skills.
            </EmptyState>
          ) : (
            overview.activity.map((event) => {
              const Icon = icons[event.type] ?? ClipboardPen;
              return (
                <Link key={event.id} href={hrefFor(event)} className="block rounded-[12px]">
                  <div className="flex gap-3 rounded-[12px] p-2.5 hover:bg-page">
                    <span
                      className={cn(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]",
                        tones[event.type] ?? tones.submission,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{event.message}</p>
                      <p className="mt-0.5 text-xs text-ink-secondary">{event.detail}</p>
                      <p className="mt-1 text-[11px] text-ink-muted" title={formatDateTime(event.time)}>
                        {relativeTime(event.time)}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })
          )
        ) : overviewError ? (
          <ErrorNote message={overviewError} onRetry={reloadOverview} />
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
