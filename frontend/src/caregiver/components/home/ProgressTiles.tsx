import { BadgeCheck, Hourglass, RotateCcw, Video } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { MySkills } from "@/lib/types";

const tiles = [
  { key: "verified", label: "Skills verified", icon: BadgeCheck, tone: "bg-success-bg text-success" },
  { key: "in_review", label: "Pending", icon: Hourglass, tone: "bg-warning-bg text-warning" },
  { key: "needs_practice", label: "Try again", icon: RotateCcw, tone: "bg-info-bg text-info" },
  { key: "not_started", label: "Not started", icon: Video, tone: "bg-teal-soft text-teal" },
] as const;

/** Where the caregiver stands, as a row of figures. The laptop version of ProgressOverview. */
export function ProgressTiles({ counts, className }: { counts: MySkills["counts"]; className?: string }) {
  return (
    <section className={cn("grid grid-cols-2 gap-3 xl:grid-cols-4", className)} aria-label="Your progress">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <Card key={tile.key} className="px-3.5 py-3">
            <p className="whitespace-nowrap text-xs text-ink-secondary">{tile.label}</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-2xl font-semibold tracking-tight text-navy tabular-nums">{counts[tile.key]}</p>
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]", tile.tone)}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
            </div>
          </Card>
        );
      })}
    </section>
  );
}
