"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useApi } from "@/lib/hooks";
import type { Overview } from "@/lib/types";

export type Flash = { tone: "success" | "danger" | "info"; message: string };

type DashboardContextValue = {
  /**
   * Counts, safety patterns, activity and notifications for the nurse's agency
   * (GET /overview). Undefined until it has loaded. Call reloadOverview() after anything
   * that changes them: a review decision, a new or deleted skill, a roster change.
   */
  overview: Overview | undefined;
  overviewError: string | null;
  reloadOverview: () => void;
  /** A one-line message shown under the top bar until dismissed or replaced. */
  flash: Flash | null;
  showFlash: (flash: Flash) => void;
  clearFlash: () => void;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

// The overview drives the sidebar badges and the notification bell, so it is kept fresh.
const REFRESH_MS = 30_000;

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useApi<Overview>("/overview", { refreshMs: REFRESH_MS });
  const [flash, setFlash] = useState<Flash | null>(null);
  const clearFlash = useCallback(() => setFlash(null), []);

  const value = useMemo<DashboardContextValue>(
    () => ({
      overview: data,
      overviewError: error,
      reloadOverview: reload,
      flash,
      showFlash: setFlash,
      clearFlash,
    }),
    [data, error, reload, flash, clearFlash],
  );

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within DashboardProvider");
  }
  return context;
}
