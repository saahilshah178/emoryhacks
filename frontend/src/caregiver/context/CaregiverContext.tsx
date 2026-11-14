"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useApi } from "@/lib/hooks";
import type { MySkill, MySkills } from "@/lib/types";

type CaregiverContextValue = {
  /** The caregiver's skills with their standing on each. Empty until the first answer. */
  skills: MySkill[];
  /** How many skills are in each state. Undefined until the first answer. */
  counts: MySkills["counts"] | undefined;
  /** True only until the first answer. */
  loading: boolean;
  error: string | null;
  /** Fetch again, e.g. after a submission. What is on screen stays meanwhile. */
  reload: () => void;
};

const CaregiverContext = createContext<CaregiverContextValue | null>(null);

/** Loads GET /my/skills once for every page of the portal. */
export function CaregiverProvider({ children }: { children: ReactNode }) {
  const { data, error, loading, reload } = useApi<MySkills>("/my/skills");

  const value = useMemo<CaregiverContextValue>(
    () => ({ skills: data?.skills ?? [], counts: data?.counts, loading, error, reload }),
    [data, loading, error, reload],
  );

  return <CaregiverContext.Provider value={value}>{children}</CaregiverContext.Provider>;
}

export function useCaregiver() {
  const context = useContext(CaregiverContext);
  if (!context) {
    throw new Error("useCaregiver must be used within CaregiverProvider");
  }
  return context;
}
