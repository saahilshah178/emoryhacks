"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Avatar } from "@/nurse/components/ui/Avatar";
import { StatusBadge } from "@/nurse/components/ui/StatusBadge";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { formatDateTime, matchesQuery } from "@/nurse/lib/format";
import { getCaregiver, getSkill } from "@/nurse/lib/mock-data";
import { cn } from "@/nurse/lib/cn";
import type { AiAssessment, Submission } from "@/nurse/lib/types";

export function PendingReviewsTable({
  submissions,
  compact = false,
}: {
  submissions: Submission[];
  compact?: boolean;
}) {
  const { search } = useDashboard();
  const rows = submissions.filter((item) => {
    const caregiver = getCaregiver(item.caregiverId);
    const skill = getSkill(item.skillId);
    return matchesQuery(search, caregiver?.name, skill?.name, item.aiAssessment);
  });

  return (
    <div className="overflow-hidden rounded-[12px] border border-border">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-secondary text-xs font-medium uppercase tracking-wide text-ink-secondary">
            <tr>
              <th className="px-4 py-3 font-medium">Caregiver Name</th>
              <th className="px-4 py-3 font-medium">Skill Demonstrated</th>
              <th className="px-4 py-3 font-medium">Submission Date</th>
              <th className="px-4 py-3 font-medium">AI Assessment</th>
              <th className="px-4 py-3 font-medium">Safety Flags</th>
              <th className="px-4 py-3 font-medium">Review Status</th>
              <th className="px-4 py-3 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-secondary">
                  No submissions match this search.
                </td>
              </tr>
            )}
            {rows.map((item) => {
              const caregiver = getCaregiver(item.caregiverId);
              const skill = getSkill(item.skillId);
              const flagged = item.safetyIssues.length > 0;
              return (
                <tr
                  key={item.id}
                  className={cn(
                    "border-t border-border bg-white hover:bg-page",
                    flagged && "bg-danger-bg/40 hover:bg-danger-bg/70",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={caregiver?.name ?? "Caregiver"} initials={caregiver?.initials} />
                      <div>
                        <Link href={`/dashboard/reviews/${item.id}`} className="font-medium text-ink hover:text-teal">
                          {caregiver?.name}
                        </Link>
                        <p className="text-xs text-ink-muted">{caregiver?.role}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-ink">{skill?.name}</td>
                  <td className="px-4 py-3 text-ink-secondary">{formatDateTime(item.submittedAt)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.aiAssessment as AiAssessment} />
                  </td>
                  <td className="px-4 py-3">
                    {item.safetyIssues.length === 0 ? (
                      <span className="text-ink-muted">None</span>
                    ) : (
                      <span className="font-medium text-danger">
                        {item.safetyIssues.length} {item.safetyIssues.length === 1 ? "flag" : "flags"}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.reviewStatus} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/dashboard/reviews/${item.id}`}
                      className="inline-flex h-8 items-center gap-1 rounded-[10px] bg-teal px-3 text-xs font-medium text-white hover:bg-teal-hover"
                    >
                      Review
                      {!compact && <ArrowUpRight className="h-3.5 w-3.5" />}
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
