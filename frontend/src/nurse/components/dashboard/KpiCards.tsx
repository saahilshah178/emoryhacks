"use client";

import { BadgeCheck, ClipboardList, ShieldAlert, Users } from "lucide-react";
import { Card, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { Overview } from "@/lib/types";
import { useDashboard } from "@/nurse/context/DashboardContext";

const items = [
  {
    key: "caregivers",
    label: "Total caregivers",
    hint: "Everyone on your agency's roster",
    icon: Users,
    tone: "bg-teal-soft text-teal",
  },
  {
    key: "pending",
    label: "Pending skill reviews",
    hint: "Waiting on nurse sign-off",
    icon: ClipboardList,
    tone: "bg-warning-bg text-warning",
  },
  {
    key: "verified",
    label: "Verified skills",
    hint: "Nurse-approved competencies",
    icon: BadgeCheck,
    tone: "bg-success-bg text-success",
  },
  {
    key: "safety_flags",
    label: "Safety flags",
    hint: "Open issues in the queue",
    icon: ShieldAlert,
    tone: "bg-danger-bg text-danger",
  },
] as const satisfies ReadonlyArray<{ key: keyof Overview["counts"] } & Record<string, unknown>>;

export function KpiCards() {
  const { overview } = useDashboard();

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key figures">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.key} className="px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-ink-secondary">{item.label}</p>
                {overview ? (
                  <p className="mt-2 text-3xl font-semibold tracking-tight text-navy">{overview.counts[item.key]}</p>
                ) : (
                  <Skeleton className="mt-2 h-9 w-14" />
                )}
                <p className="mt-1 text-xs text-ink-muted">{item.hint}</p>
              </div>
              <span className={cn("flex h-10 w-10 items-center justify-center rounded-[12px]", item.tone)}>
                <Icon className="h-5 w-5" />
              </span>
            </div>
          </Card>
        );
      })}
    </section>
  );
}
