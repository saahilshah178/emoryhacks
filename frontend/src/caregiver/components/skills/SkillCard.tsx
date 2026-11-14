import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, StateBadge } from "@/components/ui";
import { skillHref } from "@/caregiver/skills";
import { plural } from "@/lib/format";
import { skillState } from "@/lib/status";
import type { MySkill } from "@/lib/types";

export function SkillCard({ skill }: { skill: MySkill }) {
  const state = skillState[skill.state];
  const description = skill.guide.description || skill.summary;
  const minutes = skill.guide.estimated_minutes;
  const facts = [
    skill.step_count > 0 ? plural(skill.step_count, "step") : "",
    minutes > 0 ? `about ${plural(minutes, "minute")}` : "",
  ].filter(Boolean);

  return (
    <Card className="h-full transition-colors hover:border-teal/35">
      <Link href={skillHref(skill)} className="flex h-full flex-col p-4">
        <h2 className="text-[16px] font-semibold leading-snug text-navy">{skill.name}</h2>
        <div className="mt-2">
          <StateBadge entry={state} />
        </div>
        {description ? (
          <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-secondary">{description}</p>
        ) : (
          <span className="flex-1" />
        )}
        {facts.length > 0 ? <p className="mt-2 text-xs text-ink-muted">{facts.join(" · ")}</p> : null}
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal">
          {state.action}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </Link>
    </Card>
  );
}
