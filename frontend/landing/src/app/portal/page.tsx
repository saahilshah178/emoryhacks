"use client";

import { ProgressOverview } from "@/caregiver/components/home/ProgressOverview";
import { StartSkillCta } from "@/caregiver/components/home/StartSkillCta";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { getRecommendedSkill } from "@/caregiver/data/skills";

export default function HomePage() {
  const { caregiver, skills, verifiedCount, awaitingCount } = useCaregiver();
  const nextSkill = getRecommendedSkill(skills);
  const nextHref =
    nextSkill.status === "verified" || nextSkill.status === "in_review"
      ? `/portal/skills/${nextSkill.id}/results`
      : `/portal/skills/${nextSkill.id}`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[1.65rem] font-semibold leading-tight tracking-tight text-navy">
          Welcome back, {caregiver.firstName}
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Next shift: {caregiver.nextShift}. Let&apos;s get you ready.
        </p>
      </header>

      <ProgressOverview
        verified={verifiedCount}
        total={skills.length}
        awaiting={awaitingCount}
      />

      <StartSkillCta href={nextHref} skillName={nextSkill.name} />
    </div>
  );
}
