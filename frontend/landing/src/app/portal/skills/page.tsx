"use client";

import { Button, Skeleton } from "@/components/ui";
import { MySkillsLoadable } from "@/caregiver/components/MySkillsLoadable";
import { SkillCard } from "@/caregiver/components/skills/SkillCard";
import { practiceHref, recommendedSkill } from "@/caregiver/skills";
import { useTitle } from "@/lib/hooks";

export default function SkillsPage() {
  useTitle("My skills");

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-navy">My skills</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Practice at your own pace. A nurse always makes the final decision.
        </p>
      </header>

      <MySkillsLoadable
        skeleton={
          <div className="grid gap-3 md:grid-cols-2">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        }
      >
        {(skills) => {
          const next = recommendedSkill(skills);
          return (
            <div className="space-y-5">
              {next ? (
                <Button href={practiceHref(next.id)} size="lg" className="w-full">
                  Continue with {next.name}
                </Button>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                {skills.map((skill) => (
                  <SkillCard key={skill.id} skill={skill} />
                ))}
              </div>
            </div>
          );
        }}
      </MySkillsLoadable>
    </div>
  );
}
