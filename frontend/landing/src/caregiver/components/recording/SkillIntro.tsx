import { Clock3, HeartHandshake, Shield } from "lucide-react";
import { Card } from "@/caregiver/components/ui/Card";
import { Button } from "@/caregiver/components/ui/Button";
import type { Skill } from "@/caregiver/types/skill";

export function SkillIntro({
  skill,
  onContinue,
}: {
  skill: Skill;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-navy">
          {skill.name}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">
          {skill.explanation}
        </p>
      </header>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-secondary">
        <span className="inline-flex items-center gap-1.5 font-medium text-navy">
          <Clock3 className="h-4 w-4 text-teal" aria-hidden />
          {skill.estimatedMinutes} minutes
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium text-navy">
          <HeartHandshake className="h-4 w-4 text-teal" aria-hidden />
          Practice, not a test
        </span>
      </p>

      <Card className="flex gap-3 bg-info-bg p-4">
        <Shield className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-navy">Safety reminder</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
            {skill.safetyReminder}
          </p>
        </div>
      </Card>

      <Button onClick={onContinue} className="w-full" size="lg">
        Watch the demonstration
      </Button>
    </div>
  );
}
