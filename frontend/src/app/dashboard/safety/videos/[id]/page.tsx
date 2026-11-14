"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { VideoFrame } from "@/components/media/VideoFrame";
import { Badge, Card, CardBody, CardHeader, CardTitle, EmptyState, ErrorNote, Loadable, Skeleton } from "@/components/ui";
import { formatClock, formatDateTime } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { useVideoSegments } from "@/lib/segment";
import type { PoseFrames, PoseSeries, PoseSummary, Video } from "@/lib/types";
import { BackLink } from "@/shared/layout/BackLink";
import { PageHeading } from "@/shared/layout/PageHeading";
import { FlagList } from "@/nurse/components/safety/FlagList";
import { BalanceChart, KneeChart, LeanChart } from "@/nurse/components/safety/MovementCharts";
import { samplingText, seriesFromBuckets, seriesFromFrames } from "@/nurse/components/safety/movement";
import { TrackTable } from "@/nurse/components/safety/Tracks";

export default function MovementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const summary = useApi<PoseSummary>(`/safety/videos/${id}/summary`);
  const series = useApi<PoseSeries>(`/safety/videos/${id}/series?bucket_s=1`);
  const frames = useApi<PoseFrames>(`/safety/videos/${id}/frames?metrics=l_knee,r_knee,trunk_tilt&points=600`);
  const video = useApi<Video>(`/videos/${id}`);
  const player = useVideoSegments();

  const s = summary.data;
  const skillName = s?.attempt?.skill_name ?? s?.skill?.skill_name ?? null;
  useTitle(skillName ? `Movement: ${skillName}` : "Movement detail");

  const available = Boolean(video.data?.available);
  const playhead = available ? player.time : null;
  const onSeek = available ? player.seek : undefined;
  const onPlay = available ? player.play : undefined;

  return (
    <div className="space-y-5">
      <BackLink href="/dashboard/safety">Back to safety reports</BackLink>

      <Loadable
        data={s}
        error={summary.error}
        loading={summary.loading}
        reload={summary.reload}
        skeleton={
          <div className="space-y-5">
            <Skeleton className="h-12 w-72" />
            <Skeleton className="h-80" />
          </div>
        }
      >
        {(sum) => {
          const duration = sum.video.duration_s || video.data?.duration_s || 1;
          const sampling = samplingText(sum.sampling);
          const rows = series.data?.rows ?? [];
          const noData = sum.tracks.length === 0 && series.data !== undefined && rows.length === 0;
          const leanSeries = frames.data
            ? seriesFromFrames(frames.data, ["trunk_tilt"])
            : seriesFromBuckets(rows, "trunk_tilt_avg");
          return (
            <>
              <PageHeading
                title={skillName ?? (sum.video.original_name || "Video")}
                description={
                  <>
                    <p>
                      {[
                        sum.video.kind === "reference"
                          ? "Reference recording"
                          : `Attempt by ${sum.attempt?.caregiver_name || "a caregiver"}`,
                        `Recorded ${formatDateTime(sum.video.recorded_at)}`,
                        `${formatClock(sum.video.duration_s)} long`,
                      ].join(" · ")}
                    </p>
                    <p className="mt-1 text-xs">
                      {sampling
                        ? `Body tracking measured ${sampling}${sum.segments > 1 ? ` across ${sum.segments} camera shots` : ""}.`
                        : "No body-tracking measurements for this video."}
                    </p>
                  </>
                }
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={sum.video.kind === "reference" ? "teal" : "neutral"}>
                      {sum.video.kind === "reference" ? "Reference" : "Caregiver attempt"}
                    </Badge>
                    {sum.attempt ? (
                      <Link
                        href={`/dashboard/reviews/${sum.attempt.id}`}
                        className="inline-flex h-8 items-center rounded-[10px] border border-teal bg-white px-3 text-xs font-semibold text-teal hover:bg-teal-soft"
                      >
                        Open skill review
                      </Link>
                    ) : null}
                  </div>
                }
              />

              {noData ? (
                <EmptyState title="No movement data for this video">
                  Body tracking did not record anyone in this video, so there are no balance or posture readings.
                </EmptyState>
              ) : (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:items-start">
                  <div className="space-y-3 xl:sticky xl:top-20">
                    {video.error ? <ErrorNote message={video.error} onRetry={video.reload} /> : null}
                    <VideoFrame
                      video={video.data ?? null}
                      videoRef={player.ref}
                      label={
                        available
                          ? "Click a chart to move the video there; the red line on each chart follows the video."
                          : "The charts below are measured readings from this recording."
                      }
                      missing={
                        video.loading ? (
                          <p className="text-sm text-white/80">Loading the video…</p>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-white">This recording isn&apos;t stored on this server</p>
                            <p className="max-w-sm text-xs text-white/70">
                              Recorded on another machine. The measured readings below are still
                              shown.
                            </p>
                          </>
                        )
                      }
                    />
                  </div>

                  <div className="space-y-4">
                    <ChartCard title="Balance" hint="Measured only while a person stands with both feet in view.">
                      <ChartLoad state={series}>
                        {(data) => (
                          <BalanceChart
                            series={seriesFromBuckets(data.rows, "balance_avg", { scale: 100 })}
                            summary={sum}
                            duration={duration}
                            playhead={playhead}
                            onSeek={onSeek}
                          />
                        )}
                      </ChartLoad>
                    </ChartCard>
                    <ChartCard title="Trunk lean" hint="Degrees the trunk tips from upright.">
                      {frames.data || series.data ? (
                        <LeanChart series={leanSeries} summary={sum} duration={duration} playhead={playhead} onSeek={onSeek} />
                      ) : (
                        <ChartLoad state={frames}>{() => null}</ChartLoad>
                      )}
                    </ChartCard>
                    <ChartCard title="Knee angles" hint="Left knees solid, right knees dashed.">
                      <ChartLoad state={frames}>
                        {(data) => (
                          <KneeChart
                            series={seriesFromFrames(data, ["l_knee", "r_knee"])}
                            duration={duration}
                            playhead={playhead}
                            onSeek={onSeek}
                          />
                        )}
                      </ChartLoad>
                    </ChartCard>
                  </div>
                </div>
              )}

              {sum.tracks.length ? (
                <Card>
                  <CardHeader>
                    <div>
                      <CardTitle>Tracked people</CardTitle>
                      <p className="mt-1 text-sm text-ink-secondary">
                        One row each time the tracker followed someone without a break; the same person can appear on
                        several rows. Figures marked &ldquo;not seen standing&rdquo; were not measured, they are not
                        zero.
                      </p>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <TrackTable summary={sum} onPlay={onPlay} />
                  </CardBody>
                </Card>
              ) : null}

              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Safety flags</CardTitle>
                    <p className="mt-1 text-sm text-ink-secondary">
                      {sum.flags.length
                        ? "Flags raised for this recording, in time order. Press a time to play that stretch."
                        : "No safety flags were raised for this recording."}
                    </p>
                  </div>
                </CardHeader>
                {sum.flags.length ? (
                  <CardBody>
                    <FlagList flags={sum.flags} onPlay={onPlay} />
                  </CardBody>
                ) : null}
              </Card>
            </>
          );
        }}
      </Loadable>
    </div>
  );
}

function ChartCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <p className="mt-0.5 text-xs text-ink-secondary">{hint}</p>
        </div>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

function ChartLoad<T>({
  state,
  children,
}: {
  state: { data: T | undefined; error: string | null; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
}) {
  return (
    <Loadable data={state.data} error={state.error} loading={state.loading} reload={state.reload} skeleton={<Skeleton className="h-[200px]" />}>
      {children}
    </Loadable>
  );
}
