"use client";

import { Skeleton } from "@/components/ui";
import { MySkillsLoadable } from "@/caregiver/components/MySkillsLoadable";
import { ProgressOverview } from "@/caregiver/components/home/ProgressOverview";
import { ProgressTiles, progressTilesGrid } from "@/caregiver/components/home/ProgressTiles";
import { RecentUpdates } from "@/caregiver/components/home/RecentUpdates";
import { SkillsAtAGlance } from "@/caregiver/components/home/SkillsAtAGlance";
import { CaughtUpCard, StartSkillCta } from "@/caregiver/components/home/StartSkillCta";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { recommendedSkill } from "@/caregiver/skills";
import { cn } from "@/lib/cn";
import { firstName } from "@/lib/format";
import { useTitle } from "@/lib/hooks";
import { useUser } from "@/shared/AuthProvider";

/**
 * Phone: progress on one card, then the next skill to record.
 * Laptop: two columns. The figures, the next skill and the recent activity on the left;
 * every skill's state on the right.
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
            <div className="space-y-6 lg:space-y-5">
              <div className={cn(progressTilesGrid, "hidden lg:grid")}>
                {[0, 1, 2, 3, 4].map((key) => (
                  <Skeleton key={key} className="h-[78px]" />
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
          const ready = skills.filter((skill) => skill.ready_attempt_id).length;
          return (
            <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch lg:gap-5">
              <div className="space-y-6 lg:space-y-5">
                <ProgressTiles counts={counts} className="hidden lg:grid" />
                <ProgressOverview counts={counts} ready={ready} className="lg:hidden" />
                {/* No "Practice again" card for a skill a nurse sent back; the "Try again" figure covers it. */}
                {!next ? (
                  <CaughtUpCard inReview={counts.in_review} />
                ) : next.state === "needs_practice" && !next.checking_attempt_id && !next.ready_attempt_id ? null : (
                  <StartSkillCta skill={next} />
                )}
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
