"use client";

import { Button, Skeleton } from "@/components/ui";
import { MySkillsLoadable } from "@/caregiver/components/MySkillsLoadable";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { SkillCard } from "@/caregiver/components/skills/SkillCard";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { practiceHref, recommendedSkill } from "@/caregiver/skills";
import { useTitle } from "@/lib/hooks";

export default function SkillsPage() {
  useTitle("My skills");
  const { skills } = useCaregiver();
  const next = recommendedSkill(skills);

  return (
    <div className="space-y-5">
      <PortalHeading
        title="My skills"
        description="Practice at your own pace. A nurse always makes the final decision."
        actions={
          // On a laptop the next skill sits beside the heading; on a phone it is a full-width button below.
          next ? (
            <Button href={practiceHref(next.id)} className="hidden lg:inline-flex">
              Continue with {next.name}
            </Button>
          ) : null
        }
      />

      <MySkillsLoadable
        skeleton={
          <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        }
      >
        {(loaded) => (
          <div className="space-y-5">
            {next ? (
              <Button href={practiceHref(next.id)} size="lg" className="w-full lg:hidden">
                Continue with {next.name}
              </Button>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
              {loaded.map((skill) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>
          </div>
        )}
      </MySkillsLoadable>
    </div>
  );
}
