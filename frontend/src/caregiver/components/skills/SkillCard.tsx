import Link from "next/link";
import { ArrowRight, Send } from "lucide-react";
import { Card, StateBadge } from "@/components/ui";
import { skillHref } from "@/caregiver/skills";
import { attemptsLeftLine, readyToSend, skillAllowance, skillStateForCaregiver } from "@/caregiver/status";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import type { MySkill } from "@/lib/types";

export function SkillCard({ skill }: { skill: MySkill }) {
  const state = skillStateForCaregiver[skill.state];
  const ready = Boolean(skill.ready_attempt_id);
  // A recording ready to send is the news while they are practising; otherwise the state says it.
  const badge = ready && skill.state === "practicing" ? readyToSend : state;
  const action = ready ? readyToSend.action : state.action;
  const description = skill.guide.description || skill.summary;
  const minutes = skill.guide.estimated_minutes;
  const facts = [
    skill.step_count > 0 ? plural(skill.step_count, "step") : "",
    minutes > 0 ? `about ${plural(minutes, "minute")}` : "",
  ].filter(Boolean);
  // Only a limit is worth a line: unlimited attempts need no mention.
  const left = skill.state === "verified" ? null : attemptsLeftLine(skillAllowance(skill));

  return (
    <Card className="h-full transition-colors hover:border-teal/35">
      <Link href={skillHref(skill)} className="flex h-full flex-col p-4">
        <h2 className="text-[16px] font-semibold leading-snug text-navy">{skill.name}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StateBadge entry={badge} />
          {ready && skill.state !== "practicing" ? <StateBadge entry={readyToSend} /> : null}
        </div>
        {description ? (
          <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-secondary">{description}</p>
        ) : (
          <span className="flex-1" />
        )}
        {facts.length > 0 ? <p className="mt-2 text-xs text-ink-muted">{facts.join(" · ")}</p> : null}
        {left ? (
          <p className={cn("mt-1 text-xs font-medium", skill.attempts_left === 0 && skill.state !== "in_review" ? "text-danger" : "text-ink-secondary")}>{left}</p>
        ) : null}
        <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-teal">
          {ready ? <Send className="h-4 w-4" aria-hidden /> : null}
          {action}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </span>
      </Link>
    </Card>
  );
}
