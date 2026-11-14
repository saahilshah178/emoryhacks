"use client";

import { SkillCard } from "@/components/skills/SkillCard";
import { useCaregiver } from "@/context/CaregiverContext";
import { getRecommendedSkill } from "@/data/skills";
import { Button } from "@/components/ui/Button";

export default function SkillsPage() {
  const { skills } = useCaregiver();
  const nextSkill = getRecommendedSkill(skills);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-navy">My Skills</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Practice at your own pace. A nurse always makes the final decision.
        </p>
      </header>

      <Button href={`/skills/${nextSkill.id}`} className="w-full">
        Continue with {nextSkill.name}
      </Button>

      <div className="space-y-3">
        {skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} />
        ))}
      </div>
    </div>
  );
}
