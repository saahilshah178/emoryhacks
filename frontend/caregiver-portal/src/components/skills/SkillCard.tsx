import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge, skillActionLabel } from "@/components/ui/StatusBadge";
import type { Skill } from "@/types/skill";

function skillHref(skill: Skill) {
  if (skill.status === "in_review" || skill.status === "verified") {
    return `/skills/${skill.id}/results`;
  }
  return `/skills/${skill.id}`;
}

export function SkillCard({ skill }: { skill: Skill }) {
  const action = skillActionLabel(skill.status);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold leading-snug text-navy">
            {skill.name}
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            {skill.description}
          </p>
        </div>
        <StatusBadge status={skill.status} />
      </div>
      <Button
        href={skillHref(skill)}
        variant={skill.status === "verified" ? "secondary" : "primary"}
        className="mt-4 w-full"
      >
        {action}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Button>
    </Card>
  );
}
