"use client";

import Link from "next/link";
import { Avatar } from "@/nurse/components/ui/Avatar";
import { Card } from "@/nurse/components/ui/Card";
import { ProgressBar } from "@/nurse/components/ui/ProgressBar";
import { StatusBadge } from "@/nurse/components/ui/StatusBadge";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { caregivers } from "@/nurse/lib/mock-data";
import { formatDate, matchesQuery } from "@/nurse/lib/format";
import { cn } from "@/nurse/lib/cn";

const statusLabel = {
  active: "Active",
  onboarding: "Onboarding",
  restricted: "Restricted",
};

export default function CaregiversPage() {
  const { search, submissions } = useDashboard();
  const rows = caregivers.filter((person) =>
    matchesQuery(search, person.name, person.role, person.location, person.status),
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <p className="text-sm text-ink-secondary">
        Competency progress across Harbor Home Care. Restricted caregivers have open safety flags.
      </p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((person) => {
          const open = submissions.filter(
            (item) => item.caregiverId === person.id && item.reviewStatus === "pending",
          );
          const progress = (person.skillsCompleted / person.skillsRequired) * 100;
          return (
            <Card key={person.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar name={person.name} initials={person.initials} size="lg" />
                  <div>
                    <p className="font-semibold text-ink">{person.name}</p>
                    <p className="text-sm text-ink-secondary">{person.role}</p>
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    person.status === "active" && "bg-success-bg text-success",
                    person.status === "onboarding" && "bg-info-bg text-info",
                    person.status === "restricted" && "bg-danger-bg text-danger",
                  )}
                >
                  {statusLabel[person.status]}
                </span>
              </div>
              <p className="mt-4 text-xs text-ink-muted">
                {person.location} · Hired {formatDate(person.hireDate)}
              </p>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-ink-secondary">Verified skills</span>
                  <span className="font-medium text-ink">
                    {person.skillsCompleted}/{person.skillsRequired}
                  </span>
                </div>
                <ProgressBar value={progress} />
              </div>
              <div className="mt-4 flex items-center justify-between text-sm">
                {person.openFlags > 0 ? (
                  <StatusBadge status="safety_concern" label={`${person.openFlags} open flags`} />
                ) : (
                  <span className="text-xs text-ink-muted">No open flags</span>
                )}
                {open[0] ? (
                  <Link href={`/dashboard/reviews/${open[0].id}`} className="text-sm font-medium text-teal">
                    Review latest
                  </Link>
                ) : (
                  <span className="text-xs text-ink-muted">No pending review</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
