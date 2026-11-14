"use client";

import { Skeleton } from "@/components/ui";
import { MySkillsLoadable } from "@/caregiver/components/MySkillsLoadable";
import { ProgressOverview } from "@/caregiver/components/home/ProgressOverview";
import { ProgressTiles } from "@/caregiver/components/home/ProgressTiles";
import { RecentUpdates } from "@/caregiver/components/home/RecentUpdates";
import { SkillsAtAGlance } from "@/caregiver/components/home/SkillsAtAGlance";
import { CaughtUpCard, StartSkillCta } from "@/caregiver/components/home/StartSkillCta";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { recommendedSkill } from "@/caregiver/skills";
import { firstName } from "@/lib/format";
import { useTitle } from "@/lib/hooks";
import { useUser } from "@/shared/AuthProvider";

/**
 * Phone: progress on one card, then the next skill to record.
 * Laptop: the figures in a row, then the next skill and every skill's state beside the
 * recent activity, the way the nurse's overview is laid out.
 */
export default function HomePage() {
  useTitle("Home");
  const user = useUser();

  return (
    <div className="space-y-6 lg:space-y-5">
      <PortalHeading
        title={`Welcome back, ${firstName(user.name)}`}
        description={`${user.next_shift ? `Next shift: ${user.next_shift}. ` : ""}Let's get you ready.`}
      />

      <MySkillsLoadable
        skeleton={
          <div className="space-y-6 lg:space-y-5">
            <div className="hidden gap-4 lg:grid lg:grid-cols-3 xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((key) => (
                <Skeleton key={key} className="h-28" />
              ))}
            </div>
            <Skeleton className="h-32 lg:hidden" />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Skeleton className="h-48" />
              <Skeleton className="hidden h-48 lg:block" />
            </div>
          </div>
        }
      >
        {(skills, counts) => {
          const next = recommendedSkill(skills);
          const ready = skills.filter((skill) => skill.ready_attempt_id).length;
          // The tile counts practicing skills, so its note counts only theirs.
          const readyPracticing = skills.filter((skill) => skill.ready_attempt_id && skill.state === "practicing").length;
          return (
            <div className="space-y-6 lg:space-y-5">
              <ProgressTiles counts={counts} ready={readyPracticing} className="hidden lg:grid" />
              <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-5">
                <div className="space-y-6 lg:space-y-5">
                  <ProgressOverview counts={counts} ready={ready} className="lg:hidden" />
                  {next ? <StartSkillCta skill={next} /> : <CaughtUpCard inReview={counts.in_review} />}
                  <SkillsAtAGlance skills={skills} className="hidden lg:block" />
                </div>
                <RecentUpdates className="hidden lg:block" />
              </div>
            </div>
          );
        }}
      </MySkillsLoadable>
    </div>
  );
}
