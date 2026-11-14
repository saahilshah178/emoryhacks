"use client";

import { BadgeCheck, ClipboardList, ShieldAlert, Users } from "lucide-react";
import { Card } from "@/nurse/components/ui/Card";
import { caregivers } from "@/nurse/lib/mock-data";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { cn } from "@/nurse/lib/cn";

const items = [
  {
    key: "caregivers",
    label: "Total Caregivers",
    hint: "Active agency roster",
    icon: Users,
    tone: "teal",
  },
  {
    key: "pending",
    label: "Pending Skill Reviews",
    hint: "Waiting on nurse sign-off",
    icon: ClipboardList,
    tone: "warning",
  },
  {
    key: "verified",
    label: "Verified Skills",
    hint: "Nurse-approved competencies",
    icon: BadgeCheck,
    tone: "success",
  },
  {
    key: "flags",
    label: "Safety Flags",
    hint: "Open issues in the queue",
    icon: ShieldAlert,
    tone: "danger",
  },
] as const;

export function KpiCards() {
  const { pendingCount, verifiedCount, safetyFlagCount } = useDashboard();
  const values = {
    caregivers: caregivers.length + 36,
    pending: pendingCount,
    verified: verifiedCount,
    flags: safetyFlagCount,
  };

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card key={item.key} className="px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-ink-secondary">{item.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-navy">
                  {values[item.key]}
                </p>
                <p className="mt-1 text-xs text-ink-muted">{item.hint}</p>
              </div>
              <span
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-[12px]",
                  item.tone === "teal" && "bg-teal-soft text-teal",
                  item.tone === "warning" && "bg-warning-bg text-warning",
                  item.tone === "success" && "bg-success-bg text-success",
                  item.tone === "danger" && "bg-danger-bg text-danger",
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
            </div>
          </Card>
        );
      })}
    </section>
  );
}
