"use client";

import { SkillCard } from "@/caregiver/components/skills/SkillCard";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { getRecommendedSkill } from "@/caregiver/data/skills";
import { Button } from "@/caregiver/components/ui/Button";

export default function SkillsPage() {
  const { skills } = useCaregiver();
  const nextSkill = getRecommendedSkill(skills);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-navy">My Skills</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Practice at your own pace. A nurse always makes the final decision.
        </p>
      </header>

      <Button href={`/portal/skills/${nextSkill.id}`} className="w-full">
        Continue with {nextSkill.name}
      </Button>

      <div className="grid gap-3 md:grid-cols-2">
        {skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} />
        ))}
      </div>
    </div>
  );
}
