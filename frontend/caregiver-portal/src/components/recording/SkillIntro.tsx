import { Clock3, HeartHandshake, Shield } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Skill } from "@/types/skill";

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
        <p className="text-xs font-semibold uppercase tracking-wide text-teal">
          Skill check
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">
          {skill.name}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-text-secondary">
          {skill.explanation}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <Clock3 className="h-5 w-5 text-teal" aria-hidden />
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            About
          </p>
          <p className="text-sm font-semibold text-navy">
            {skill.estimatedMinutes} minutes
          </p>
        </Card>
        <Card className="p-4">
          <HeartHandshake className="h-5 w-5 text-teal" aria-hidden />
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            This is
          </p>
          <p className="text-sm font-semibold text-navy">Practice, not a test</p>
        </Card>
      </div>

      <Card className="flex gap-3 bg-info-bg p-4">
        <Shield className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
        <div>
          <p className="text-sm font-semibold text-navy">Safety reminder</p>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
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
