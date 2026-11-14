"use client";

import { Skeleton } from "@/components/ui";
import { MySkillsLoadable } from "@/caregiver/components/MySkillsLoadable";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { SkillCard } from "@/caregiver/components/skills/SkillCard";
import { useTitle } from "@/lib/hooks";

export default function SkillsPage() {
  useTitle("My skills");

  return (
    <div className="space-y-5">
      <PortalHeading title="My skills" />

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
          <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
            {loaded.map((skill) => (
              <SkillCard key={skill.id} skill={skill} />
            ))}
          </div>
        )}
      </MySkillsLoadable>
    </div>
  );
}
