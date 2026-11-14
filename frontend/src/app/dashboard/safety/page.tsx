"use client";

import { useTitle } from "@/lib/hooks";
import { SafetyOverview } from "@/nurse/components/dashboard/SafetyOverview";
import { PageHeading } from "@/nurse/components/layout/PageHeading";
import { MovementTable } from "@/nurse/components/safety/MovementTable";
import { OpenIssues } from "@/nurse/components/safety/OpenIssues";
import { StoragePanel } from "@/nurse/components/safety/StoragePanel";
import { TrendsPanel } from "@/nurse/components/safety/TrendsPanel";

export default function SafetyPage() {
  useTitle("Safety reports");

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeading
        title="Safety reports"
        description="Critical misses stay visible until a nurse closes them with approval or retraining."
      />

      <SafetyOverview />

      <OpenIssues />

      <section aria-labelledby="movement-data" className="space-y-4">
        <div>
          <h2 id="movement-data" className="text-base font-semibold text-navy">
            Movement data
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            Balance, trunk lean and joint angles measured by body tracking on every processed video. These are
            measurements to guide your review, not findings anyone has confirmed on video.
          </p>
        </div>
        <MovementTable />
        <TrendsPanel />
        <StoragePanel />
      </section>
    </div>
  );
}
