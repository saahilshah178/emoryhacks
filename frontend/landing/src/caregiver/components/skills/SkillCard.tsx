import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/caregiver/components/ui/Card";
import { StatusBadge, skillActionLabel } from "@/caregiver/components/ui/StatusBadge";
import type { Skill } from "@/caregiver/types/skill";

function skillHref(skill: Skill) {
  if (skill.status === "in_review" || skill.status === "verified") {
    return `/portal/skills/${skill.id}/results`;
  }
  return `/portal/skills/${skill.id}`;
}

export function SkillCard({ skill }: { skill: Skill }) {
  const action = skillActionLabel(skill.status);

  return (
    <Card className="h-full transition-colors hover:border-teal/35">
      <Link
        href={skillHref(skill)}
        className="flex h-full flex-col p-4"
      >
        <h3 className="text-[16px] font-semibold leading-snug text-navy">
          {skill.name}
        </h3>
        <div className="mt-2">
          <StatusBadge status={skill.status} />
        </div>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-secondary">
          {skill.description}
        </p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal">
          {action}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </Link>
    </Card>
  );
}
