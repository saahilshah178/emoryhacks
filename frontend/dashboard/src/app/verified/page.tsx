"use client";

import { Avatar } from "@/components/ui/Avatar";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDashboard } from "@/context/DashboardContext";
import { formatDateTime, matchesQuery } from "@/lib/format";
import { getCaregiver, getSkill, verifiedRecords } from "@/lib/mock-data";

export default function VerifiedPage() {
  const { search, submissions } = useDashboard();
  const sessionApproved = submissions
    .filter((item) => item.reviewStatus === "approved")
    .map((item) => ({
      id: `session-${item.id}`,
      caregiverId: item.caregiverId,
      skillId: item.skillId,
      approvedAt: item.reviewedAt ?? new Date().toISOString(),
      approvedBy: item.reviewedBy ?? "Patricia Chen, RN",
      aiAssessment: item.aiAssessment,
      notes: item.notes || "Approved from the clinical dashboard.",
    }));
  const records = [...sessionApproved, ...verifiedRecords].filter((item) => {
    const caregiver = getCaregiver(item.caregiverId);
    const skill = getSkill(item.skillId);
    return matchesQuery(search, caregiver?.name, skill?.name, item.approvedBy, item.notes);
  });

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-navy">Verified skills</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Competencies signed off by a registered nurse. AI recommendations are recorded for audit.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{records.length} approved competencies</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="overflow-hidden rounded-[12px] border border-border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-secondary text-xs font-medium uppercase tracking-wide text-ink-secondary">
                <tr>
                  <th className="px-4 py-3 font-medium">Caregiver</th>
                  <th className="px-4 py-3 font-medium">Skill</th>
                  <th className="px-4 py-3 font-medium">Approved</th>
                  <th className="px-4 py-3 font-medium">Approved by</th>
                  <th className="px-4 py-3 font-medium">Original AI</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {records.map((item) => {
                  const caregiver = getCaregiver(item.caregiverId);
                  const skill = getSkill(item.skillId);
                  return (
                    <tr key={item.id} className="border-t border-border bg-white">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={caregiver?.name ?? ""} initials={caregiver?.initials} />
                          <span className="font-medium text-ink">{caregiver?.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-ink">{skill?.name}</td>
                      <td className="px-4 py-3 text-ink-secondary">{formatDateTime(item.approvedAt)}</td>
                      <td className="px-4 py-3 text-ink">{item.approvedBy}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={item.aiAssessment} />
                      </td>
                      <td className="px-4 py-3 text-ink-secondary">{item.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
