"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Avatar, StateBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime, plural, relativeTime } from "@/lib/format";
import { aiAssessment, flagTitle, reviewState } from "@/lib/status";
import type { AttemptSummary } from "@/lib/types";

export function PendingReviewsTable({
  attempts,
  compact = false,
  empty,
}: {
  attempts: AttemptSummary[];
  /** The overview's narrow version: the submitted time sits under the skill, the flags under the AI badge. */
  compact?: boolean;
  /** Shown instead of the table when there is nothing to list at all. */
  empty?: ReactNode;
}) {
  if (attempts.length === 0 && empty) return <>{empty}</>;

  // Below 1280px (and always in the compact version) the submitted time moves under the skill
  // and the flags under the AI badge, so the table fits next to the sidebar without scrolling.
  const wideCell = compact ? "hidden" : "hidden xl:table-cell";
  const narrowOnly = compact ? "" : "xl:hidden";
  // Every row here is waiting for a nurse, so on narrower screens the full list drops this column.
  const statusCell = compact ? "" : "hidden xl:table-cell";

  return (
    <div className="overflow-hidden rounded-[12px] border border-border">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="whitespace-nowrap bg-secondary text-xs font-medium text-ink-secondary">
            <tr>
              <th className="px-3 py-3 font-medium">Caregiver</th>
              <th className="px-3 py-3 font-medium">Skill</th>
              <th className={cn("px-3 py-3 font-medium", wideCell)}>Submitted</th>
              <th className="px-3 py-3 font-medium">AI assessment</th>
              <th className={cn("px-3 py-3 font-medium", wideCell)}>Safety flags</th>
              <th className={cn("px-3 py-3 font-medium", statusCell)}>Review status</th>
              <th className="px-3 py-3 text-right font-medium">Action</th>
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
              const flagNames = (item.flags ?? []).map((flag) => flagTitle(flag)).join("\n");
              return (
                <tr
                  key={item.id}
                  className={cn(
                    "border-t border-border",
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
                    <span
                      className={cn("block whitespace-nowrap text-xs text-ink-muted", narrowOnly)}
                      title={formatDateTime(item.created_at)}
                    >
                      {relativeTime(item.created_at)}
                    </span>
                  </td>
                  <td className={cn("whitespace-nowrap px-3 py-3 text-ink-secondary", wideCell)}>
                    {formatDateTime(item.created_at)}
                  </td>
                  <td className="px-3 py-3">
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
                  <td className={cn("px-3 py-3", statusCell)}>
                    <StateBadge entry={reviewState[item.review_state]} />
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
