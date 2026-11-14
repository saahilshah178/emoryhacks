"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState, ErrorNote, ProgressBar, Skeleton, StateBadge } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { stepStatus } from "@/lib/status";
import type { MovementNote, PoseSeries, PoseSummary } from "@/lib/types";
import { BalanceChart, LeanChart } from "@/nurse/components/safety/MovementCharts";
import { seriesFromBuckets } from "@/nurse/components/safety/movement";
import { TrackFigures } from "@/nurse/components/safety/Tracks";

// "!" because ProgressBar's own bg-teal comes later in the stylesheet than bg-danger (cn does not merge).
const BAR: Record<string, string> = { success: "bg-teal", warning: "bg-warning!", danger: "bg-danger!" };

/**
 * Movement and balance for one attempt, from the body-tracking readings in Tiger Data:
 * the patient's balance and the caregiver's trunk lean over video time, each person's
 * measured figures, and the AI's notes on body movement when it wrote any.
 */
export function MovementPanel({
  videoId,
  duration,
  notes,
  playhead,
  onSeek,
}: {
  videoId: string;
  duration: number;
  notes: MovementNote[] | undefined;
  playhead: number | null;
  onSeek?: (seconds: number) => void;
}) {
  const series = useApi<PoseSeries>(`/safety/videos/${videoId}/series?bucket_s=1`);
  const summary = useApi<PoseSummary>(`/safety/videos/${videoId}/summary`);
  const error = series.error ?? summary.error;
  const reload = () => {
    series.reload();
    summary.reload();
  };

  let body;
  if (series.data && summary.data) {
    const rows = series.data.rows;
    if (rows.length === 0 && summary.data.tracks.length === 0) {
      body = (
        <EmptyState title="No movement data for this recording">
          Body tracking did not record anyone in this video, so there are no balance or posture readings to show.
        </EmptyState>
      );
    } else {
      const patient = seriesFromBuckets(rows, "balance_avg", { roles: ["patient"], scale: 100 });
      const caregiver = seriesFromBuckets(rows, "trunk_tilt_avg", { roles: ["caregiver"] });
      body = (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="min-w-0 rounded-[12px] border border-border bg-white p-4">
              <p className="text-sm font-semibold text-ink">Patient balance</p>
              <p className="mt-1 text-xs text-ink-secondary">
                100 is weight centred over the feet. Measured only while the patient is standing with both feet in
                view; gaps are times they were seated, lying or out of view.
              </p>
              <div className="mt-3">
                <BalanceChart series={patient} summary={summary.data} duration={duration} playhead={playhead} onSeek={onSeek} />
              </div>
            </div>
            <div className="min-w-0 rounded-[12px] border border-border bg-white p-4">
              <p className="text-sm font-semibold text-ink">Caregiver trunk lean</p>
              <p className="mt-1 text-xs text-ink-secondary">
                Degrees the caregiver&apos;s trunk tips from upright. Long stretches past 60° strain the back.
              </p>
              <div className="mt-3">
                <LeanChart
                  series={caregiver}
                  summary={summary.data}
                  duration={duration}
                  playhead={playhead}
                  onSeek={onSeek}
                  empty="No caregiver was tracked in this recording, so there is no trunk lean reading."
                />
              </div>
            </div>
          </div>
          {onSeek ? <p className="text-xs text-ink-secondary">Click a chart to move the recording to that moment.</p> : null}
          {summary.data.tracks.length ? (
            <div>
              <p className="text-sm font-semibold text-ink">Measured for each person</p>
              <div className="mt-3">
                <TrackFigures summary={summary.data} />
              </div>
            </div>
          ) : null}
        </div>
      );
    }
  } else if (error) {
    body = <ErrorNote message={error} onRetry={reload} />;
  } else {
    body = (
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {body}

      {notes?.length ? (
        <div>
          <p className="text-sm font-semibold text-ink">Body movement analysis</p>
          <p className="mt-1 text-xs text-ink-secondary">The AI&apos;s notes on body mechanics. You decide what they mean.</p>
          <ul className="mt-3 space-y-3">
            {notes.map((item) => {
              const entry = stepStatus[item.status];
              return (
                <li key={item.label}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-sm text-ink">{item.label}</span>
                    <StateBadge entry={entry} label={`AI: ${entry.label}`} />
                  </div>
                  <ProgressBar value={item.value} label={`${item.label}: ${item.value} of 100`} barClassName={BAR[entry.tone] ?? "bg-teal"} />
                  <p className="mt-1 text-xs text-ink-secondary">{item.note}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Link
        href={`/dashboard/safety/videos/${videoId}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-teal hover:underline"
      >
        Open full movement detail
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}
