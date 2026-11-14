"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Loadable, Skeleton } from "@/components/ui";
import { formatClock, formatDateTime, percent } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { PoseOverviewRow } from "@/lib/types";
import { balance100, deg, secs } from "./movement";

function Note({ children }: { children: string }) {
  return <span className="block text-xs text-ink-secondary">{children}</span>;
}

/** One row per video with movement data (GET /safety/overview). */
export function MovementTable() {
  const { data, error, loading, reload } = useApi<PoseOverviewRow[]>("/safety/overview");

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Recordings with movement data</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">
            Body tracking measured on each processed video. Balance is read only while a person is standing with both
            feet in view, so a patient who stays seated or lying has no balance figure.
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <Loadable data={data} error={error} loading={loading} reload={reload} skeleton={<Skeleton className="h-48" />}>
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title="No movement data yet">
                Readings appear here after a video is processed: upload a reference video for a skill, or have a
                caregiver submit a practice recording.
              </EmptyState>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead className="text-xs text-ink-secondary">
                    <tr className="border-b border-border">
                      <th className="py-2 pr-3 font-medium">Recording</th>
                      <th className="py-2 pr-3 font-medium">Recorded</th>
                      <th className="py-2 pr-3 font-medium">Time tracked</th>
                      <th className="py-2 pr-3 font-medium">Patient balance, lowest / average</th>
                      <th className="py-2 pr-3 font-medium">Patient off-centre</th>
                      <th className="py-2 pr-3 font-medium">Caregiver peak lean</th>
                      <th className="py-2 pr-3 font-medium">Caregiver bent past 60°</th>
                      <th className="py-2 pr-3 font-medium" title="Flags that count toward the result / all flags, including body-tracking readings">
                        Flags, counted / all
                      </th>
                      <th className="py-2 font-medium">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const href = `/dashboard/safety/videos/${row.video_id}`;
                      const standing = (row.patient_standing_s ?? 0) >= 1;
                      const noPatient = row.patient_tracked_s ? "not seen standing" : "no patient identified";
                      return (
                        <tr key={row.video_id} className="border-b border-border last:border-0 hover:bg-page">
                          <td className="py-3 pr-3">
                            <Link href={href} className="font-medium text-ink hover:text-teal hover:underline">
                              {row.skill_name ?? (row.original_name || "Untitled video")}
                            </Link>
                            <Note>
                              {`${row.kind === "reference" ? "Reference" : row.caregiver_name || "Caregiver attempt"}${
                                row.skill_match === false ? " · wrong skill, left out of trends" : ""
                              }`}
                            </Note>
                          </td>
                          <td className="py-3 pr-3">
                            {formatDateTime(row.recorded_at)}
                            <Note>{`${formatClock(row.duration_s)} long`}</Note>
                          </td>
                          <td className="py-3 pr-3 tabular-nums">{secs(row.seconds_tracked)}</td>
                          <td className="py-3 pr-3 tabular-nums">
                            {row.patient_balance_min !== null && standing ? (
                              <>
                                {balance100(row.patient_balance_min)} / {balance100(row.patient_balance_avg)}
                                <Note>{`over ${secs(row.patient_standing_s)} standing`}</Note>
                              </>
                            ) : (
                              <Note>{noPatient}</Note>
                            )}
                          </td>
                          <td className="py-3 pr-3 tabular-nums">
                            {row.patient_off_center_share !== null && standing ? (
                              percent(row.patient_off_center_share)
                            ) : (
                              <Note>{noPatient}</Note>
                            )}
                          </td>
                          <td className="py-3 pr-3 tabular-nums">
                            {row.caregiver_tilt_peak !== null ? deg(row.caregiver_tilt_peak) : <Note>no caregiver tracked</Note>}
                          </td>
                          <td className="py-3 pr-3 tabular-nums">
                            {row.caregiver_bent_share !== null ? (
                              <>
                                {percent(row.caregiver_bent_share)}
                                {row.caregiver_tracked_s ? <Note>{`of ${secs(row.caregiver_tracked_s)}`}</Note> : null}
                              </>
                            ) : (
                              <Note>no caregiver tracked</Note>
                            )}
                          </td>
                          <td className="py-3 pr-3 tabular-nums">
                            {row.scored_flag_count} / {row.flag_count}
                            {row.high_flag_count ? <span className="block text-xs text-danger">{row.high_flag_count} critical</span> : null}
                          </td>
                          <td className="py-3 text-right">
                            <Link
                              href={href}
                              aria-label={`Open movement detail for ${row.skill_name ?? "this video"}`}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary hover:bg-secondary hover:text-teal"
                            >
                              <ChevronRight className="h-4 w-4" aria-hidden />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </Loadable>
      </CardBody>
    </Card>
  );
}
