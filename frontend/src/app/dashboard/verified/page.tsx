"use client";

import Link from "next/link";
import { Avatar, Card, CardBody, CardHeader, CardTitle, EmptyState, Loadable, Skeleton, StateBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { aiAssessment } from "@/lib/status";
import type { AttemptSummary } from "@/lib/types";
import { PageHeading } from "@/nurse/components/layout/PageHeading";

function reviewer(item: AttemptSummary) {
  if (!item.reviewer_name) return "";
  return item.reviewer_credentials ? `${item.reviewer_name}, ${item.reviewer_credentials}` : item.reviewer_name;
}

export default function VerifiedPage() {
  useTitle("Verified skills");
  const approved = useApi<AttemptSummary[]>("/attempts?state=approved");

  return (
    <div className="space-y-5">
      <PageHeading
        title="Verified skills"
        description="Competencies signed off by a nurse. The AI's original assessment is kept alongside for the record."
      />
      <Loadable
        data={approved.data}
        error={approved.error}
        loading={approved.loading}
        reload={approved.reload}
        skeleton={<Skeleton className="h-72" />}
      >
        {(rows) => {
          return (
            <Card>
              <CardHeader>
                <CardTitle>
                  {rows.length} approved {rows.length === 1 ? "competency" : "competencies"}
                </CardTitle>
              </CardHeader>
              <CardBody>
                {rows.length === 0 ? (
                  <EmptyState title="No approved skills yet">
                    When you approve a caregiver&apos;s submission on its review page, it is recorded here with your
                    name and notes.
                  </EmptyState>
                ) : (
                  <div className="overflow-hidden rounded-[12px] border border-border">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-sm">
                        <thead className="whitespace-nowrap bg-secondary text-xs font-medium text-ink-secondary">
                          <tr>
                            <th className="px-3 py-3 font-medium">Caregiver</th>
                            <th className="px-3 py-3 font-medium">Skill</th>
                            <th className="px-3 py-3 font-medium">Approved</th>
                            <th className="hidden px-3 py-3 font-medium xl:table-cell">Approved by</th>
                            <th className="px-3 py-3 font-medium">Original AI</th>
                            <th className="px-3 py-3 font-medium">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((item) => {
                            const href = `/dashboard/reviews/${item.id}`;
                            return (
                              <tr key={item.id} className="border-t border-border bg-white align-top hover:bg-page">
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-3">
                                    <span className="hidden xl:block"><Avatar name={item.caregiver_name} /></span>
                                    <div className="min-w-0">
                                      <Link href={href} className="whitespace-nowrap font-medium text-ink hover:text-teal">
                                        {item.caregiver_name}
                                      </Link>
                                      {item.caregiver_title ? (
                                        <p className="text-xs text-ink-muted xl:whitespace-nowrap">{item.caregiver_title}</p>
                                      ) : null}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  <Link href={href} className="block text-ink hover:text-teal xl:min-w-28">
                                    {item.skill_name}
                                  </Link>
                                </td>
                                <td className="px-3 py-3 text-ink-secondary">
                                  <span className="block xl:whitespace-nowrap">{formatDateTime(item.reviewed_at)}</span>
                                  {/* Below 1280px the reviewer sits under the date instead of in its own column. */}
                                  {item.reviewer_name ? (
                                    <span className="mt-0.5 block text-xs text-ink xl:hidden">by {reviewer(item)}</span>
                                  ) : null}
                                </td>
                                <td className="hidden px-3 py-3 text-ink xl:table-cell">
                                  <span className="block min-w-32">{reviewer(item) || "—"}</span>
                                </td>
                                <td className="px-3 py-3">
                                  {item.ai_assessment ? (
                                    <StateBadge entry={aiAssessment[item.ai_assessment]} />
                                  ) : (
                                    <span className="text-ink-muted">Not graded</span>
                                  )}
                                </td>
                                <td className="px-3 py-3 text-ink-secondary">
                                  <span className="block min-w-28 max-w-sm">{item.nurse_note || "—"}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          );
        }}
      </Loadable>
    </div>
  );
}
