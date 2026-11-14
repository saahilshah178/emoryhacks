import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, StateBadge } from "@/components/ui";
import { skillHref, skillPriority } from "@/caregiver/skills";
import { attemptsLeftLine, skillAllowance, skillCardState } from "@/caregiver/status";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { categoryLabel } from "@/lib/status";
import type { MySkill } from "@/lib/types";

/** Every skill with its state on one card, the ones that need the caregiver at the top. */
export function SkillsAtAGlance({ skills, className }: { skills: MySkill[]; className?: string }) {
  // Stable: skills that need the same thing keep the API's order.
  const sorted = [...skills].sort((a, b) => skillPriority(a) - skillPriority(b));

  return (
    <Card className={className}>
      <CardHeader>
        <div>
          <CardTitle>My skills</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">The ones that need you are at the top.</p>
        </div>
        <Link href="/portal/skills" className="shrink-0 text-sm font-medium text-teal hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardBody>
        <ul className="overflow-hidden rounded-[12px] border border-border">
          {sorted.map((skill, index) => {
            const { badge, extra, action } = skillCardState(skill);
            const left = skill.state === "verified" ? null : attemptsLeftLine(skillAllowance(skill));
            return (
              <li key={skill.id} className={cn(index > 0 && "border-t border-border")}>
                <Link href={skillHref(skill)} className="flex items-center gap-3 bg-white px-4 py-3 hover:bg-page">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{skill.name}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {categoryLabel[skill.category] ?? skill.category} · {plural(skill.step_count, "step")}
                      {left ? <span className={cn(skill.attempts_left === 0 && skill.state !== "in_review" && "text-danger")}> · {left}</span> : null}
                    </p>
                  </div>
                  <StateBadge entry={badge} />
                  {extra ? <StateBadge entry={extra} /> : null}
                  <span className="hidden w-36 shrink-0 items-center justify-end gap-1.5 text-sm font-medium text-teal xl:inline-flex">
                    {action}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
