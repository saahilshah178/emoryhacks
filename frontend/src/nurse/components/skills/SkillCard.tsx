import Link from "next/link";
import { ListOrdered } from "lucide-react";
import { SkillIcon } from "@/components/skills/SkillIcon";
import { Badge } from "@/components/ui";
import { formatClock, plural } from "@/lib/format";
import { categoryLabel } from "@/lib/status";
import type { SkillSummary } from "@/lib/types";

/** One skill in the list: a black-and-white pictogram of the skill and the facts a nurse scans for. */
export function SkillCard({ skill }: { skill: SkillSummary }) {
  return (
    <Link
      href={`/dashboard/skills/${skill.id}`}
      className="group flex flex-col overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)] transition-colors hover:border-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
    >
      <div className="flex h-36 items-center justify-center border-b border-border bg-white">
        <SkillIcon skill={skill} className="h-24 w-24" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-navy group-hover:text-teal">{skill.name}</h2>
          <Badge tone="teal" className="shrink-0">
            {categoryLabel[skill.category] ?? categoryLabel.other}
          </Badge>
        </div>
        {skill.summary ? <p className="line-clamp-2 text-sm text-ink-secondary">{skill.summary}</p> : null}
        {/* Two lines, so no separator is left hanging at the end of one. */}
        <div className="mt-auto space-y-1 pt-1 text-xs text-ink-secondary">
          <p>
            Version {skill.version} · {plural(skill.step_count, "step")} · {plural(skill.attempt_count, "attempt")}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{skill.duration_s ? `${formatClock(skill.duration_s)} reference video` : "No reference video"}</span>
            {skill.order_matters ? (
              <span className="inline-flex items-center gap-1 font-medium text-ink">
                <ListOrdered className="h-3.5 w-3.5" aria-hidden />
                Order matters
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </Link>
  );
}
