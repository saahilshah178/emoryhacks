"use client";

import { TimeChip } from "@/components/media/TimeChip";
import { Badge } from "@/components/ui";
import { flagSeverity, flagTitle } from "@/lib/status";
import type { SafetyFlag } from "@/lib/types";

export const flagSource: Record<SafetyFlag["source"], string> = {
  gemini: "Seen on video by the AI",
  pose: "Body-tracking reading, not confirmed on video",
  pose_confirmed: "Body-tracking reading, confirmed on video by the AI",
};

/** Every stored flag of a video, in time order, each with a time chip that plays its stretch. */
export function FlagList({
  flags,
  onPlay,
}: {
  flags: SafetyFlag[];
  onPlay?: (start: number, end?: number | null) => void;
}) {
  const ordered = [...flags].sort((a, b) => a.start_s - b.start_s);
  return (
    <ul className="divide-y divide-border">
      {ordered.map((flag) => (
        <li key={flag.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
          <TimeChip start={flag.start_s} end={flag.end_s} onPlay={onPlay} />
          <div className="min-w-0 flex-1 basis-64">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              {flagTitle(flag)}
              <Badge tone={flagSeverity[flag.severity].tone}>{flagSeverity[flag.severity].label}</Badge>
              {flag.counts_toward_score ? <Badge tone="info">Counts toward the result</Badge> : null}
            </p>
            {flag.description ? <p className="mt-1 text-sm text-ink-secondary">{flag.description}</p> : null}
            <p className="mt-1 text-xs text-ink-secondary">
              {[flag.person_label, flagSource[flag.source]].filter(Boolean).join(" · ")}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
