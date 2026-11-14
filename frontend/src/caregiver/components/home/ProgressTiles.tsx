import { BadgeCheck, Hourglass, Repeat, RotateCcw, Video } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { MySkills } from "@/lib/types";

const tiles = [
  { key: "verified", label: "Skills verified", icon: BadgeCheck, tone: "bg-success-bg text-success" },
  { key: "in_review", label: "Pending", hint: "Sent, waiting for a nurse's decision", icon: Hourglass, tone: "bg-warning-bg text-warning" },
  { key: "practicing", label: "Practicing", hint: "Recorded, not sent to a nurse", icon: Repeat, tone: "bg-teal-soft text-teal" },
  { key: "needs_practice", label: "To practice again", hint: "A nurse asked for another try", icon: RotateCcw, tone: "bg-info-bg text-info" },
  { key: "not_started", label: "Not started", hint: "Skills you haven't recorded yet", icon: Video, tone: "bg-secondary text-ink-secondary" },
] as const;

/**
 * Where the caregiver stands, as a row of figures. The laptop version of ProgressOverview.
 * ready: how many of the practicing skills have a recording ready to send.
 */
export function ProgressTiles({ counts, ready = 0, className }: { counts: MySkills["counts"]; ready?: number; className?: string }) {
  return (
    <section className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5", className)} aria-label="Your progress">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        let hint: string = "hint" in tile ? tile.hint : `Of ${counts.total} in all`;
        if (tile.key === "practicing" && ready > 0) hint = ready === 1 ? "1 is ready to send" : `${ready} are ready to send`;
        return (
          <Card key={tile.key} className="px-5 py-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm text-ink-secondary">{tile.label}</p>
                <p className="mt-2 text-3xl font-semibold tracking-tight text-navy tabular-nums">{counts[tile.key]}</p>
                <p className={cn("mt-1 text-xs", tile.key === "practicing" && ready > 0 ? "font-medium text-success" : "text-ink-muted")}>
                  {hint}
                </p>
              </div>
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]", tile.tone)}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
            </div>
          </Card>
        );
      })}
    </section>
  );
}
