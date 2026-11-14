"use client";

import type { ReactNode } from "react";
import { EmptyState, Loadable, Skeleton } from "@/components/ui";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import type { MySkill, MySkills } from "@/lib/types";

/**
 * The caregiver's skills from the portal context, with the standard loading and error
 * states, and a plain note when a nurse has not added any skills yet.
 */
export function MySkillsLoadable({
  skeleton,
  children,
}: {
  skeleton?: ReactNode;
  children: (skills: MySkill[], counts: MySkills["counts"]) => ReactNode;
}) {
  const { skills, counts, loading, error, reload } = useCaregiver();
  return (
    <Loadable
      data={counts}
      error={error}
      loading={loading}
      reload={reload}
      skeleton={
        skeleton ?? (
          <div className="space-y-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-40" />
          </div>
        )
      }
    >
      {(loaded) =>
        skills.length === 0 ? (
          <EmptyState title="No skills yet">
            Your nurse hasn&apos;t added any skills to practice. They will appear here as soon as they do.
          </EmptyState>
        ) : (
          children(skills, loaded)
        )
      }
    </Loadable>
  );
}
