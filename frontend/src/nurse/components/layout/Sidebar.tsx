"use client";

import { useDashboard } from "@/nurse/context/DashboardContext";
import { primaryNav, settingsNav } from "@/nurse/nav";
import { Rail } from "@/shared/layout/Rail";

/** The dashboard's rail: the pages in nurse/nav.ts, with how many reviews and safety issues are waiting. */
export function Sidebar() {
  const { overview } = useDashboard();
  const counts = {
    pending: overview?.counts.pending ?? 0,
    safety: overview?.counts.safety_flags ?? 0,
  };

  return (
    <Rail
      label="Clinical"
      items={primaryNav.map((item) => ({
        ...item,
        exact: item.href === "/dashboard",
        count: item.badge ? counts[item.badge] : 0,
      }))}
      footer={settingsNav}
    />
  );
}
