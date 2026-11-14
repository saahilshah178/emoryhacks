"use client";

import { Check, Clock3, CircleDashed, Video } from "lucide-react";
import { ProgressOverview } from "@/components/home/ProgressOverview";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { useCaregiver } from "@/context/CaregiverContext";
import { getRecommendedSkill } from "@/data/skills";
import type { SkillStatus } from "@/types/skill";

const icons: Record<SkillStatus, typeof Check> = {
  verified: Check,
  in_review: Clock3,
  ready_to_record: Video,
  not_started: CircleDashed,
};

export default function ProgressPage() {
  const { skills, verifiedCount, awaitingCount } = useCaregiver();
  const nextSkill = getRecommendedSkill(skills);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-navy">My Progress</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Every recording is practice. You&apos;re building confidence one skill at a
          time.
        </p>
      </header>

      <ProgressOverview
        verified={verifiedCount}
        total={skills.length}
        awaiting={awaitingCount}
      />

      <Card className="divide-y divide-border">
        {skills.map((skill) => {
          const Icon = icons[skill.status];
          return (
            <div key={skill.id} className="flex items-start gap-3 px-4 py-3.5">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-navy">{skill.name}</p>
                  <StatusBadge status={skill.status} />
                </div>
                <p className="mt-1 text-sm text-text-secondary">{skill.description}</p>
              </div>
            </div>
          );
        })}
      </Card>

      <Button href={`/skills/${nextSkill.id}`} className="w-full" size="lg">
        Next up: {nextSkill.name}
      </Button>
    </div>
  );
}
