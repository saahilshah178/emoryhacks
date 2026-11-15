"use client";

import type { ReactNode } from "react";
import { EmptyState, Loadable, Skeleton } from "@/components/ui";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import type { MySkill, MySkills } from "@/lib/types";
import { useUser } from "@/shared/AuthProvider";
import { connectedToAgency, JoinAgencyForm } from "@/shared/JoinAgency";

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
  const user = useUser();
  const { skills, counts, loading, error, reload } = useCaregiver();
  const connected = connectedToAgency(user);
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
            {connected ? (
              <p>
                You&apos;re connected to {user.org.name}. Skills your nurse assigns will show up here.
              </p>
            ) : (
              <>
                <p>
                  You&apos;re not connected to an agency yet. Ask your nurse for their code and enter it
                  here.
                </p>
                <JoinAgencyForm className="mt-4 text-left" size="lg" onJoined={() => reload()} />
              </>
            )}
          </EmptyState>
        ) : (
          children(skills, loaded)
        )
      }
    </Loadable>
  );
}
