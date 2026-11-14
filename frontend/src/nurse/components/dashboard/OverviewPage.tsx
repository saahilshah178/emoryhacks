"use client";

import Link from "next/link";
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Loadable, Skeleton } from "@/components/ui";
import { useApi, useTitle } from "@/lib/hooks";
import type { AttemptSummary } from "@/lib/types";
import { KpiCards } from "@/nurse/components/dashboard/KpiCards";
import { earlierRecordings, PendingReviewsTable } from "@/nurse/components/dashboard/PendingReviewsTable";
import { RecentActivity } from "@/nurse/components/dashboard/RecentActivity";
import { SafetyOverview } from "@/nurse/components/dashboard/SafetyOverview";
import { PageHeading } from "@/shared/layout/PageHeading";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { useUser } from "@/shared/AuthProvider";
import { APP_NAME } from "@/shared/brand";
import { AgencyCode, JoinAgencyForm } from "@/shared/JoinAgency";

const SHOWN = 6;

export function OverviewPage() {
  useTitle("Clinical dashboard");
  const user = useUser();
  const { overview, reloadOverview } = useDashboard();
  const pending = useApi<AttemptSummary[]>("/attempts?state=pending", { refreshMs: 30_000 });
  const everything = useApi<AttemptSummary[]>("/attempts?all=1", { refreshMs: 30_000 });
  const pendingCount = overview?.counts.pending;
  const freshAgency = overview && overview.counts.skills === 0 && overview.counts.caregivers === 0;

  if (freshAgency) {
    return (
      <div className="space-y-5">
        <PageHeading
          title="Clinical dashboard"
          description={`${overview.agency ?? user.org.name} · ${user.title || "Nurse"}`}
        />
        <EmptyState
          title="Nothing here yet"
          action={
            <Button href="/dashboard/skills/new">
              Record a reference skill
            </Button>
          }
        >
          <p>
            Share this code with caregivers and other nurses, or join an agency that already exists.
            Record a reference video to add a skill once people are here.
          </p>
          <AgencyCode className="mt-4" code={user.org.join_code} />
          <JoinAgencyForm
            className="mt-5 text-left"
            hint="If another nurse gave you their code, enter it here."
            onJoined={() => reloadOverview()}
          />
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeading
        title="Clinical dashboard"
        description={
          <>
            <p>
              {overview?.agency ?? user.org.name} · {user.title || "Nurse"}
            </p>
            <p className="mt-1">
              {APP_NAME} prepares caregiver demonstrations for your review. AI flags missed steps; you remain the only
              person who can approve a skill.
            </p>
          </>
        }
        actions={
          pendingCount === undefined ? null : pendingCount > 0 ? (
            <p className="rounded-full bg-warning-bg px-3 py-1 text-xs font-medium text-warning">
              {pendingCount === 1 ? "1 submission needs" : `${pendingCount} submissions need`} a nurse decision
            </p>
          ) : (
            <p className="rounded-full bg-success-bg px-3 py-1 text-xs font-medium text-success">
              No submissions waiting for a decision
            </p>
          )
        }
      />

      <KpiCards />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Pending reviews</CardTitle>
                <p className="mt-1 text-sm text-ink-secondary">
                  The latest recording each caregiver sent you for each skill. Open a row to compare it with the
                  reference.
                </p>
              </div>
              <Link href="/dashboard/pending" className="shrink-0 text-sm font-medium text-teal hover:underline">
                View all
              </Link>
            </CardHeader>
            <CardBody>
              <Loadable
                data={pending.data}
                error={pending.error}
                loading={pending.loading}
                reload={pending.reload}
                skeleton={
                  <div className="space-y-2">
                    {[0, 1, 2].map((key) => (
                      <Skeleton key={key} className="h-12" />
                    ))}
                  </div>
                }
              >
                {(rows) => (
                  <>
                    <PendingReviewsTable
                      attempts={rows.slice(0, SHOWN)}
                      earlier={earlierRecordings(rows.slice(0, SHOWN), everything.data)}
                      compact
                      empty={
                        <EmptyState title="No submissions waiting for review">
                          When a caregiver sends you a recording, it appears here. Practice runs they have not sent
                          stay with them.
                        </EmptyState>
                      }
                    />
                    {rows.length > SHOWN ? (
                      <p className="mt-3 text-sm text-ink-secondary">
                        Showing the newest {SHOWN} of {rows.length}.{" "}
                        <Link href="/dashboard/pending" className="font-medium text-teal hover:underline">
                          See all pending reviews
                        </Link>
                      </p>
                    ) : null}
                  </>
                )}
              </Loadable>
            </CardBody>
          </Card>
        </div>
        <RecentActivity />
      </div>

      <SafetyOverview />
    </div>
  );
}
