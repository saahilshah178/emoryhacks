"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Avatar, Badge, StateBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime, plural, relativeTime } from "@/lib/format";
import { aiAssessment, flagTitle } from "@/lib/status";
import type { AttemptSummary } from "@/lib/types";
import { historyHref, pct, sentOrRecorded, seriesKey } from "@/nurse/components/attempts/words";

/**
 * Earlier recordings of the same skill by the same caregiver, per queue row, from a list of
 * every attempt (GET /attempts?all=1). Rows without an entry show nothing.
 */
export function earlierRecordings(queue: AttemptSummary[], everything: AttemptSummary[] | undefined) {
  const out: Record<string, { total: number; sent: number }> = {};
  if (!everything) return out;
  const bySeries = new Map<string, AttemptSummary[]>();
  for (const item of everything) {
    const key = seriesKey(item);
    bySeries.set(key, [...(bySeries.get(key) ?? []), item]);
  }
  for (const row of queue) {
    const earlier = (bySeries.get(seriesKey(row)) ?? []).filter(
      (item) => item.id !== row.id && item.created_at < row.created_at,
    );
    out[row.id] = { total: earlier.length, sent: earlier.filter((item) => item.submitted_at).length };
  }
  return out;
}

/** "2 earlier recordings", linking to the caregiver's history of that skill. */
function Earlier({ item, counts }: { item: AttemptSummary; counts?: { total: number; sent: number } }) {
  if (!counts || counts.total === 0 || !item.caregiver_id) return null;
  const detail =
    counts.sent === 0
      ? "none of them sent to you"
      : counts.sent === counts.total
        ? "all sent to you"
        : `${counts.sent} sent to you`;
  return (
    <Link
      href={historyHref(item.caregiver_id, item.skill_slug)}
      title={`${plural(counts.total, "earlier recording")}, ${detail}`}
      className="relative z-10 mt-0.5 block whitespace-nowrap text-xs font-medium text-teal hover:underline"
    >
      {plural(counts.total, "earlier recording")}
    </Link>
  );
}

export function PendingReviewsTable({
  attempts,
  compact = false,
  empty,
  earlier,
}: {
  attempts: AttemptSummary[];
  /** The overview's narrow version: the sent time sits under the skill, the flags under the AI badge. */
  compact?: boolean;
  /** Shown instead of the table when there is nothing to list at all. */
  empty?: ReactNode;
  /** From earlierRecordings(); left out, the rows do not mention earlier recordings. */
  earlier?: Record<string, { total: number; sent: number }>;
}) {
  if (attempts.length === 0 && empty) return <>{empty}</>;

  // Below 1280px (and always in the compact version) the sent time moves under the skill
  // and the flags under the AI badge, so the table fits next to the sidebar without scrolling.
  const wideCell = compact ? "hidden" : "hidden xl:table-cell";
  const narrowOnly = compact ? "" : "xl:hidden";

  return (
    <div className="overflow-hidden rounded-[12px] border border-border">
      <div className="relative overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="whitespace-nowrap bg-secondary text-xs font-medium text-ink-secondary">
            <tr>
              <th className="px-3 py-3 font-medium">Caregiver</th>
              <th className="px-3 py-3 font-medium">Skill</th>
              <th className={cn("px-3 py-3 font-medium", wideCell)}>Sent</th>
              <th className="px-3 py-3 font-medium">Score</th>
              <th className={cn("px-3 py-3 font-medium", compact && "hidden sm:table-cell")}>AI assessment</th>
              <th className={cn("px-3 py-3 font-medium", wideCell)}>Safety flags</th>
              <th className="px-3 py-3 text-right font-medium">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {attempts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-secondary">
                  No submissions to show.
                </td>
              </tr>
            ) : null}
            {attempts.map((item) => {
              const href = `/dashboard/reviews/${item.id}`;
              const flagged = item.flag_count > 0;
              const forced = item.submit_kind === "forced";
              const flagNames = (item.flags ?? []).map((flag) => flagTitle(flag)).join("\n");
              const sent = sentOrRecorded(item);
              return (
                <tr
                  key={item.id}
                  className={cn(
                    "border-t border-border align-top",
                    flagged ? "bg-danger-bg/40 hover:bg-danger-bg/70" : "bg-white hover:bg-page",
                  )}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      {compact ? null : <span className="hidden xl:block"><Avatar name={item.caregiver_name} /></span>}
                      <div className="min-w-0">
                        <Link href={href} className="whitespace-nowrap font-medium text-ink hover:text-teal">
                          {item.caregiver_name}
                        </Link>
                        {item.caregiver_title ? (
                          <p className={cn("text-xs text-ink-muted", !compact && "xl:whitespace-nowrap")}>{item.caregiver_title}</p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-ink">
                    <span className="block min-w-28">{item.skill_name}</span>
                    <span className={cn("block whitespace-nowrap text-xs text-ink-muted", narrowOnly)} title={formatDateTime(sent)}>
                      Sent {relativeTime(sent).replace(/^(Just now|Yesterday)$/, (m) => m.toLowerCase())}
                    </span>
                    <Earlier item={item} counts={earlier?.[item.id]} />
                  </td>
                  <td className={cn("whitespace-nowrap px-3 py-3 text-ink-secondary", wideCell)}>{formatDateTime(sent)}</td>
                  <td className="px-3 py-3">
                    {item.score_pct !== null ? (
                      <span className="font-semibold tabular-nums text-ink">{pct(item.score_pct)}</span>
                    ) : (
                      <span className="text-ink-muted">None</span>
                    )}
                    {forced ? (
                      <span className="mt-1 block">
                        <Badge tone="warning" title={item.submit_note ? `“${item.submit_note}”` : undefined}>
                          Sent anyway
                        </Badge>
                      </span>
                    ) : null}
                    {forced && item.submit_note && !compact ? (
                      <p className="mt-1.5 line-clamp-3 min-w-36 max-w-52 text-xs text-ink-secondary" title={item.submit_note}>
                        “{item.submit_note}”
                      </p>
                    ) : null}
                  </td>
                  <td className={cn("px-3 py-3", compact && "hidden sm:table-cell")}>
                    {item.ai_assessment ? (
                      <StateBadge entry={aiAssessment[item.ai_assessment]} />
                    ) : (
                      <span className="text-ink-muted">Not graded</span>
                    )}
                    {flagged ? (
                      <span
                        className={cn("mt-1 block whitespace-nowrap text-xs font-medium text-danger", narrowOnly)}
                        title={flagNames || undefined}
                      >
                        {plural(item.flag_count, "safety flag")}
                      </span>
                    ) : null}
                  </td>
                  <td className={cn("px-3 py-3", wideCell)}>
                    {flagged ? (
                      <span className="whitespace-nowrap font-medium text-danger" title={flagNames || undefined}>
                        {plural(item.flag_count, "flag")}
                      </span>
                    ) : (
                      <span className="text-ink-muted">None</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <Link
                      href={href}
                      aria-label={`Review ${item.caregiver_name}, ${item.skill_name}`}
                      className="inline-flex h-8 items-center gap-1 rounded-[10px] bg-teal px-3 text-xs font-semibold text-white hover:bg-teal-hover"
                    >
                      Review
                      {compact ? null : <ArrowUpRight className="h-3.5 w-3.5" />}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
