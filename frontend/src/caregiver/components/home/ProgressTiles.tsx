import { BadgeCheck, Hourglass, RotateCcw, Video } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { MySkills } from "@/lib/types";

const tiles = [
  { key: "verified", label: "Skills verified", icon: BadgeCheck, tone: "bg-success-bg text-success" },
  { key: "in_review", label: "Pending", hint: "Waiting for a nurse's decision", icon: Hourglass, tone: "bg-warning-bg text-warning" },
  { key: "needs_practice", label: "To practice again", hint: "A nurse asked for another try", icon: RotateCcw, tone: "bg-info-bg text-info" },
  { key: "not_started", label: "Not started", hint: "Skills you haven't recorded yet", icon: Video, tone: "bg-teal-soft text-teal" },
] as const;

/** Where the caregiver stands, as a row of figures. The laptop version of ProgressOverview. */
export function ProgressTiles({ counts, className }: { counts: MySkills["counts"]; className?: string }) {
  return (
    <section className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)} aria-label="Your progress">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <Card key={tile.key} className="px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-ink-secondary">{tile.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-navy tabular-nums">{counts[tile.key]}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {tile.key === "verified" ? `Of ${counts.total} in all` : tile.hint}
                </p>
              </div>
              <span className={cn("flex h-10 w-10 items-center justify-center rounded-[12px]", tile.tone)}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
            </div>
          </Card>
        );
      })}
    </section>
  );
}
