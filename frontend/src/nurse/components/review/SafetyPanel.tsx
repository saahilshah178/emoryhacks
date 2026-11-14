"use client";

import { Activity, AlertTriangle } from "lucide-react";
import { TimeChip } from "@/components/media/TimeChip";
import { Badge } from "@/components/ui";
import { flagSeverity, flagTitle, personRole } from "@/lib/status";
import type { Person, SafetyFlag } from "@/lib/types";
import { flagSource } from "@/nurse/components/safety/FlagList";

function FlagRow({
  flag,
  people,
  onPlay,
}: {
  flag: SafetyFlag;
  people: Person[];
  onPlay?: (start: number, end?: number | null) => void;
}) {
  const severity = flagSeverity[flag.severity];
  const person = flag.person_label ? people.find((p) => p.label === flag.person_label) : undefined;
  const who = flag.person_label
    ? `${flag.person_label}${person ? ` (${personRole[person.role].toLowerCase()})` : ""}`
    : null;
  return (
    <li className="rounded-[12px] bg-white px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {flagTitle(flag)}
          <Badge tone={severity.tone}>{severity.label}</Badge>
        </p>
        <TimeChip start={flag.start_s} end={flag.end_s} onPlay={onPlay} />
      </div>
      {flag.description ? <p className="mt-1 text-sm text-ink-secondary">{flag.description}</p> : null}
      <p className="mt-1.5 text-xs text-ink-secondary">
        {[who, flagSource[flag.source], flag.counts_toward_score ? null : "not counted in the AI result"]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </li>
  );
}

/**
 * Safety flags: the ones that count toward the result first, then body-tracking readings
 * nobody confirmed on video, kept apart and labelled as such.
 */
export function SafetyPanel({
  flags,
  people,
  onPlay,
}: {
  flags: SafetyFlag[];
  people: Person[];
  onPlay?: (start: number, end?: number | null) => void;
}) {
  const ordered = [...flags].sort((a, b) => a.start_s - b.start_s);
  const advisory = ordered.filter((f) => f.source === "pose" && !f.counts_toward_score);
  const main = ordered.filter((f) => !advisory.includes(f)).sort((a, b) => Number(b.counts_toward_score) - Number(a.counts_toward_score));

  return (
    <div className="space-y-3">
      {main.length === 0 ? (
        <div className="rounded-[12px] border border-success/20 bg-success-bg p-4">
          <p className="text-sm font-semibold text-success">No safety flags detected</p>
          <p className="mt-1 text-sm text-ink-secondary">
            AI did not find a critical miss. Nurse review is still required before certification.
          </p>
        </div>
      ) : (
        <div className="rounded-[12px] border border-danger/20 bg-danger-bg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-danger">
                {main.length === 1
                  ? "1 safety issue requires nurse attention"
                  : `${main.length} safety issues require nurse attention`}
              </p>
              <p className="mt-1 text-xs text-ink-secondary">
                These findings are recommendations only. You decide whether the skill is approved.
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {main.map((flag) => (
              <FlagRow key={flag.id} flag={flag} people={people} onPlay={onPlay} />
            ))}
          </ul>
        </div>
      )}

      {advisory.length ? (
        <div className="rounded-[12px] border border-border bg-page p-4">
          <div className="flex items-start gap-2">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink">Body-tracking readings, not confirmed on video</p>
              <p className="mt-1 text-xs text-ink-secondary">
                Measured from body positions only. Nobody has confirmed them on the video and they do not affect the AI
                result; watch the stretch to judge for yourself.
              </p>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {advisory.map((flag) => (
              <FlagRow key={flag.id} flag={flag} people={people} onPlay={onPlay} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
