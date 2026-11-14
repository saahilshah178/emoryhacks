import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, StateBadge } from "@/components/ui";
import { skillHref } from "@/caregiver/skills";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { categoryLabel, skillState } from "@/lib/status";
import type { MySkill, SkillState } from "@/lib/types";

// What needs the caregiver first: a nurse's request, then anything not tried, then the rest.
const order: SkillState[] = ["needs_practice", "not_started", "in_review", "verified"];

/** Every skill with its state on one card, the ones that need the caregiver at the top. */
export function SkillsAtAGlance({ skills, className }: { skills: MySkill[]; className?: string }) {
  const sorted = [...skills].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));

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
            const state = skillState[skill.state];
            return (
              <li key={skill.id} className={cn(index > 0 && "border-t border-border")}>
                <Link href={skillHref(skill)} className="flex items-center gap-3 bg-white px-4 py-3 hover:bg-page">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{skill.name}</p>
                    <p className="text-xs text-ink-muted">
                      {categoryLabel[skill.category] ?? skill.category} · {plural(skill.step_count, "step")}
                    </p>
                  </div>
                  <StateBadge entry={state} />
                  <span className="hidden w-32 shrink-0 items-center justify-end gap-1.5 text-sm font-medium text-teal xl:inline-flex">
                    {state.action}
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
