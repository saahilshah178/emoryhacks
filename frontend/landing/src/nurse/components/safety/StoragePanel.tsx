"use client";

import type { ReactNode } from "react";
import { Card, CardBody, CardHeader, CardTitle, Loadable, Skeleton } from "@/components/ui";
import { formatDateTime, plural } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import type { PoseStorage } from "@/lib/types";

// Fields the API sends that lib/types does not list yet.
type Size = NonNullable<PoseStorage["size"]> & { table_bytes?: number; index_bytes?: number };
type Job = PoseStorage["jobs"][number] & { schedule_interval?: number; last_successful_finish?: string | null };

const UNAVAILABLE = <span className="text-ink-secondary">Unavailable</span>;

function bytes(value: number | undefined) {
  if (value === undefined || value === null) return "–";
  return value >= 1 << 20 ? `${(value / (1 << 20)).toFixed(1)} MB` : `${Math.round(value / 1024)} kB`;
}

/** Seconds as "every 5 min", "every 1 day". */
function interval(seconds: number | undefined) {
  if (!seconds) return "";
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day");
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

/** Facts about how the movement data is stored in Tiger Data (GET /safety/storage). */
export function StoragePanel() {
  const { data, error, loading, reload } = useApi<PoseStorage>("/safety/storage");

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Stored in Tiger Data</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">
            Every body-tracking reading is one row per person per measured frame in a TimescaleDB hypertable, rolled
            up into one-second buckets for the charts.
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <Loadable data={data} error={error} loading={loading} reload={reload} skeleton={<Skeleton className="h-48" />}>
          {(s) => <Facts storage={s} />}
        </Loadable>
      </CardBody>
    </Card>
  );
}

function Facts({ storage: s }: { storage: PoseStorage }) {
  const chunks = (s.chunks ?? []).filter((c) => !c.error);
  const chunkError = (s.chunks ?? []).some((c) => c.error);
  const jobs = (s.jobs ?? []) as Job[];
  const jobsError = jobs.some((j) => j.error);
  const size = s.size as Size | null;

  const items: Array<[string, ReactNode]> = [
    [
      "Database",
      s.database?.error
        ? UNAVAILABLE
        : `${s.database?.name ?? "–"} · TimescaleDB ${s.database?.timescaledb ?? "–"} · toolkit ${s.database?.toolkit ?? "not installed"}`,
    ],
    [
      "Rows",
      s.rows?.error
        ? UNAVAILABLE
        : `${(s.rows?.pose_frames ?? 0).toLocaleString()} person-frames from ${plural(s.rows?.videos ?? 0, "video")}`,
    ],
    [
      "Time span",
      s.rows?.error ? UNAVAILABLE : s.rows?.first_ts ? `${formatDateTime(s.rows.first_ts)} to ${formatDateTime(s.rows.last_ts)}` : "No rows yet",
    ],
    [
      "Hypertable",
      !s.hypertable || s.hypertable.error
        ? UNAVAILABLE
        : `${s.hypertable.hypertable_name ?? "pose_frames"} · ${plural(s.hypertable.num_chunks ?? chunks.length, "chunk")}${
            chunkError ? "" : ` · ${chunks.filter((c) => c.in_columnstore).length} in the columnstore`
          }`,
    ],
    [
      "Columnstore",
      !s.hypertable || s.hypertable.error
        ? UNAVAILABLE
        : s.hypertable.columnstore_enabled
          ? !s.columnstore || s.columnstore.error
            ? "On · settings unavailable"
            : `On · segment by ${s.columnstore.segmentby || "–"} · order by ${s.columnstore.orderby || "–"}`
          : "Off",
    ],
    [
      "Rollup",
      !s.rollup || s.rollup.error
        ? UNAVAILABLE
        : `${s.rollup.view_name ?? "pose_1s"} · ${(s.rollup.rows ?? 0).toLocaleString()} one-second rows · up to date to ${
            s.rollup.watermark ? formatDateTime(s.rollup.watermark) : "not yet refreshed"
          }${s.rollup.materialized_only ? "" : " · newer rows read live"}`,
    ],
    [
      "Background jobs",
      jobsError ? (
        UNAVAILABLE
      ) : jobs.length === 0 ? (
        "None scheduled"
      ) : (
        <ul className="space-y-0.5">
          {jobs.map((job) => (
            <li key={job.job_id}>
              {(job.application_name ?? "Job").replace(/\s*\[\d+\]$/, "")}
              {job.schedule_interval ? ` · every ${interval(job.schedule_interval)}` : ""}
              {` · last run ${job.last_run_status ? job.last_run_status.toLowerCase() : "not yet"}`}
              {job.next_start ? ` · next ${formatDateTime(job.next_start)}` : ""}
            </li>
          ))}
        </ul>
      ),
    ],
    [
      "Size",
      !size || size.error
        ? UNAVAILABLE
        : `${size.total ?? bytes(size.total_bytes)}${
            size.table_bytes !== undefined ? ` (table ${bytes(size.table_bytes)}, indexes ${bytes(size.index_bytes)})` : ""
          }`,
    ],
  ];

  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-secondary">{label}</dt>
          <dd className="min-w-0 break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
