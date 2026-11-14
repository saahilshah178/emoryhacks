"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { caregiver as caregiverSeed } from "@/caregiver/data/caregiver";
import { skills as skillsSeed } from "@/caregiver/data/skills";
import type { CaregiverProfile, Skill, SkillStatus } from "@/caregiver/types/skill";

type RecordingMap = Record<string, string>;

type CaregiverContextValue = {
  caregiver: CaregiverProfile;
  skills: Skill[];
  recordings: RecordingMap;
  saveRecording: (skillId: string, objectUrl: string) => void;
  submitForReview: (skillId: string) => void;
  verifiedCount: number;
  awaitingCount: number;
};

const CaregiverContext = createContext<CaregiverContextValue | null>(null);

export function CaregiverProvider({ children }: { children: ReactNode }) {
  const [statusOverrides, setStatusOverrides] = useState<Record<string, SkillStatus>>(
    {},
  );
  const [recordings, setRecordings] = useState<RecordingMap>({});

  const skills = useMemo(
    () =>
      skillsSeed.map((skill) => ({
        ...skill,
        status: statusOverrides[skill.id] ?? skill.status,
      })),
    [statusOverrides],
  );

  const saveRecording = useCallback((skillId: string, objectUrl: string) => {
    setRecordings((current) => {
      const previous = current[skillId];
      if (previous) URL.revokeObjectURL(previous);
      return { ...current, [skillId]: objectUrl };
    });
  }, []);

  const submitForReview = useCallback((skillId: string) => {
    setStatusOverrides((current) => ({ ...current, [skillId]: "in_review" }));
  }, []);

  const verifiedCount = skills.filter((skill) => skill.status === "verified").length;
  const awaitingCount = skills.filter((skill) => skill.status === "in_review").length;

  const value = useMemo(
    () => ({
      caregiver: caregiverSeed,
      skills,
      recordings,
      saveRecording,
      submitForReview,
      verifiedCount,
      awaitingCount,
    }),
    [skills, recordings, saveRecording, submitForReview, verifiedCount, awaitingCount],
  );

  return (
    <CaregiverContext.Provider value={value}>{children}</CaregiverContext.Provider>
  );
}

export function useCaregiver() {
  const context = useContext(CaregiverContext);
  if (!context) {
    throw new Error("useCaregiver must be used within CaregiverProvider");
  }
  return context;
}
