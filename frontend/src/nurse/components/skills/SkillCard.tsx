import Link from "next/link";
import { ListOrdered } from "lucide-react";
import { Badge } from "@/components/ui";
import { thumbUrl } from "@/lib/api";
import { formatClock, plural } from "@/lib/format";
import { categoryLabel } from "@/lib/status";
import type { SkillSummary } from "@/lib/types";
import { SkillThumb } from "./SkillThumb";

/** One skill in the list: a still from its reference video and the facts a nurse scans for. */
export function SkillCard({ skill }: { skill: SkillSummary }) {
  const thumb = skill.reference_video_id
    ? thumbUrl(skill.reference_video_id, Math.min(1, (skill.duration_s ?? 2) / 2))
    : null;
  return (
    <Link
      href={`/dashboard/skills/${skill.id}`}
      className="group flex flex-col overflow-hidden rounded-[12px] border border-border bg-white shadow-[var(--shadow-card)] transition-colors hover:border-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
    >
      <div className="relative">
        <SkillThumb src={thumb} />
        {skill.duration_s ? (
          <span className="absolute bottom-2 right-2 rounded-full bg-navy/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-white">
            {formatClock(skill.duration_s)}
          </span>
        ) : (
          <span className="absolute bottom-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-ink-secondary">
            No reference video
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-navy group-hover:text-teal">{skill.name}</h2>
          <Badge tone="teal" className="shrink-0">
            {categoryLabel[skill.category] ?? categoryLabel.other}
          </Badge>
        </div>
        {skill.summary ? <p className="line-clamp-2 text-sm text-ink-secondary">{skill.summary}</p> : null}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-xs text-ink-secondary">
          <span>Version {skill.version}</span>
          <span aria-hidden>·</span>
          <span>{plural(skill.step_count, "step")}</span>
          <span aria-hidden>·</span>
          <span>{plural(skill.attempt_count, "attempt")}</span>
          {skill.order_matters ? (
            <span className="inline-flex items-center gap-1 font-medium text-ink">
              <ListOrdered className="h-3.5 w-3.5" aria-hidden />
              Order matters
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
