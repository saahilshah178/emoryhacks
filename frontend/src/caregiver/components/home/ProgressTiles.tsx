import { BadgeCheck, Hourglass, Repeat, RotateCcw, Video } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { MySkills } from "@/lib/types";

const tiles = [
  { key: "verified", label: "Skills verified", icon: BadgeCheck, tone: "bg-success-bg text-success" },
  { key: "in_review", label: "Pending", icon: Hourglass, tone: "bg-warning-bg text-warning" },
  { key: "practicing", label: "Practicing", icon: Repeat, tone: "bg-teal-soft text-teal" },
  { key: "needs_practice", label: "Try again", icon: RotateCcw, tone: "bg-info-bg text-info" },
  { key: "not_started", label: "Not started", icon: Video, tone: "bg-secondary text-ink-secondary" },
] as const;

/** The grid the five figures sit in: three over two, each row filling the width. Shared with the page's skeleton. */
export const progressTilesGrid = "grid grid-cols-6 gap-3 [&>*]:col-span-2 [&>*:nth-child(n+4)]:col-span-3";

/**
 * Where the caregiver stands, as compact figures. The laptop version of ProgressOverview.
 * Every figure is the same height, so the page's skeleton can match it exactly.
 */
export function ProgressTiles({ counts, className }: { counts: MySkills["counts"]; className?: string }) {
  return (
    <section className={cn(progressTilesGrid, className)} aria-label="Your progress">
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
