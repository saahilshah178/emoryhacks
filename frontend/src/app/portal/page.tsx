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
      <PortalHeading title={`Welcome back, ${firstName(user.name)}`} />

      <MySkillsLoadable
        skeleton={
          <div className="grid gap-6 lg:grid-cols-2 lg:gap-5">
            <div className="space-y-5">
              <div className="hidden grid-cols-2 gap-3 lg:grid xl:grid-cols-4">
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className="h-[72px]" />
                ))}
              </div>
              <Skeleton className="h-32 lg:hidden" />
              <Skeleton className="h-48" />
            </div>
            <Skeleton className="hidden h-96 lg:block" />
          </div>
        }
      >
        {(skills, counts) => {
          const next = recommendedSkill(skills);
          return (
            <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch lg:gap-5">
              <div className="space-y-6 lg:space-y-5">
                <ProgressTiles counts={counts} className="hidden lg:grid" />
                <ProgressOverview counts={counts} className="lg:hidden" />
                {/* No banner for a skill a nurse sent back; the "Try again" figure covers it. */}
                {!next ? (
                  <CaughtUpCard inReview={counts.in_review} />
                ) : next.state !== "needs_practice" ? (
                  <StartSkillCta skill={next} />
                ) : null}
                <RecentUpdates className="hidden lg:block" />
              </div>
              <SkillsAtAGlance skills={skills} className="hidden lg:block" />
            </div>
          );
        }}
      </MySkillsLoadable>
    </div>
  );
}
