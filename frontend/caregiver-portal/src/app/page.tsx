"use client";

import { ProgressOverview } from "@/components/home/ProgressOverview";
import { StartSkillCta } from "@/components/home/StartSkillCta";
import { SkillCard } from "@/components/skills/SkillCard";
import { useCaregiver } from "@/context/CaregiverContext";
import { getRecommendedSkill } from "@/data/skills";

export default function HomePage() {
  const { caregiver, skills, verifiedCount, awaitingCount } = useCaregiver();
  const nextSkill = getRecommendedSkill(skills);
  const nextHref =
    nextSkill.status === "verified" || nextSkill.status === "in_review"
      ? `/skills/${nextSkill.id}/results`
      : `/skills/${nextSkill.id}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[1.65rem] font-bold leading-tight tracking-tight text-navy">
          Welcome back, {caregiver.firstName}!
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Let&apos;s get you ready for your next shift.
        </p>
      </header>

      <ProgressOverview
        verified={verifiedCount}
        total={skills.length}
        awaiting={awaitingCount}
      />

      <StartSkillCta href={nextHref} />

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="text-lg font-semibold text-navy">My Skills</h2>
          <p className="text-xs font-medium text-text-muted">
            {skills.length} skills
          </p>
        </div>
        <div className="space-y-3">
          {skills.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      </section>
    </div>
  );
}
