"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { CURRENT_NURSE, HISTORICAL_VERIFIED_COUNT, initialSubmissions } from "@/nurse/lib/mock-data";
import type { ReviewStatus, Submission } from "@/nurse/lib/types";

type Flash = {
  tone: "success" | "danger" | "info";
  message: string;
} | null;

type DashboardContextValue = {
  submissions: Submission[];
  search: string;
  setSearch: (value: string) => void;
  flash: Flash;
  clearFlash: () => void;
  getSubmission: (id: string) => Submission | undefined;
  updateNotes: (id: string, notes: string) => void;
  resolveReview: (id: string, status: Exclude<ReviewStatus, "pending">, notes: string) => void;
  pendingCount: number;
  verifiedCount: number;
  safetyFlagCount: number;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [search, setSearch] = useState("");
  const [flash, setFlash] = useState<Flash>(null);

  const value = useMemo<DashboardContextValue>(() => {
    const pending = submissions.filter((item) => item.reviewStatus === "pending");
    const approved = submissions.filter((item) => item.reviewStatus === "approved");
    const safetyFlagCount = pending.filter((item) => item.safetyIssues.length > 0).length;

    return {
      submissions,
      search,
      setSearch,
      flash,
      clearFlash: () => setFlash(null),
      getSubmission: (id) => submissions.find((item) => item.id === id),
      updateNotes: (id, notes) => {
        setSubmissions((current) =>
          current.map((item) => (item.id === id ? { ...item, notes } : item)),
        );
      },
      resolveReview: (id, status, notes) => {
        setSubmissions((current) =>
          current.map((item) =>
            item.id === id
              ? {
                  ...item,
                  reviewStatus: status,
                  notes,
                  reviewedBy: `${CURRENT_NURSE.name}, RN`,
                  reviewedAt: new Date().toISOString(),
                }
              : item,
          ),
        );
        setFlash(
          status === "approved"
            ? {
                tone: "success",
                message: "Skill approved. The caregiver can perform this task independently once scheduled.",
              }
            : {
                tone: "danger",
                message: "Retraining requested. The caregiver will be notified and this skill stays restricted.",
              },
        );
      },
      pendingCount: pending.length,
      verifiedCount: HISTORICAL_VERIFIED_COUNT + approved.length,
      safetyFlagCount,
    };
  }, [flash, search, submissions]);

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}

export function useDashboard() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboard must be used within DashboardProvider");
  }
  return context;
}
