"use client";

import { Skeleton } from "@/components/ui";
import { MySkillsLoadable } from "@/caregiver/components/MySkillsLoadable";
import { ProgressOverview } from "@/caregiver/components/home/ProgressOverview";
import { CaughtUpCard, StartSkillCta } from "@/caregiver/components/home/StartSkillCta";
import { recommendedSkill } from "@/caregiver/skills";
import { firstName } from "@/lib/format";
import { useTitle } from "@/lib/hooks";
import { useUser } from "@/shared/AuthProvider";

export default function HomePage() {
  useTitle("Home");
  const user = useUser();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight text-navy">
          Welcome back, {firstName(user.name)}
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {user.next_shift ? `Next shift: ${user.next_shift}. ` : ""}
          Let&apos;s get you ready.
        </p>
      </header>

      <MySkillsLoadable
        skeleton={
          <div className="space-y-6">
            <Skeleton className="h-32" />
            <Skeleton className="h-48" />
          </div>
        }
      >
        {(skills, counts) => {
          const next = recommendedSkill(skills);
          return (
            <div className="space-y-6">
              <ProgressOverview counts={counts} />
              {next ? <StartSkillCta skill={next} /> : <CaughtUpCard inReview={counts.in_review} />}
            </div>
          );
        }}
      </MySkillsLoadable>
    </div>
  );
}
