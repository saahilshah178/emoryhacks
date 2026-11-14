"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorNote,
  Loadable,
  ProgressBar,
  Skeleton,
  StateBadge,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { firstName, formatDate, formatDateTime, plural, relativeTime } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { aiAssessment, caregiverStatus, categoryLabel, reviewState, skillState } from "@/lib/status";
import type { CaregiverDetail } from "@/lib/types";
import { BackLink } from "@/shared/layout/BackLink";
import { PageHeading } from "@/shared/layout/PageHeading";
import { useDashboard } from "@/nurse/context/DashboardContext";

export default function CaregiverPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<CaregiverDetail>(`/caregivers/${id}`);
  useTitle(detail.data?.name ?? "Caregiver");

  return (
    <div className="space-y-5">
      <BackLink href="/dashboard/caregivers">Back to caregivers</BackLink>
      <Loadable
        data={detail.data}
        error={detail.error}
        loading={detail.loading}
        reload={detail.reload}
        skeleton={
          <div className="space-y-5">
            <Skeleton className="h-12 w-72" />
            <Skeleton className="h-44" />
            <Skeleton className="h-56" />
            <Skeleton className="h-64" />
          </div>
        }
      >
        {(person) => (
          <>
            <PageHeading
              title={person.name}
              description={person.title || "Caregiver"}
              actions={<StateBadge entry={caregiverStatus[person.status]} />}
            />
            <Profile person={person} onSaved={detail.setData} />
            <SkillsCard person={person} />
            <HistoryCard person={person} />
          </>
        )}
      </Loadable>
    </div>
  );
}

function Profile({ person, onSaved }: { person: CaregiverDetail; onSaved: (next: CaregiverDetail) => void }) {
  const { reloadOverview } = useDashboard();
  const [saving, setSaving] = useState<CaregiverDetail["employment"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setEmployment(employment: CaregiverDetail["employment"]) {
    if (employment === person.employment || saving) return;
    setSaving(employment);
    setError(null);
    try {
      const next = await api<CaregiverDetail>(`/caregivers/${person.id}`, { method: "PATCH", json: { employment } });
      onSaved(next);
      reloadOverview();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  const facts = [
    { label: "Email", value: person.email },
    { label: "Location", value: person.location },
    { label: "Hired", value: person.hire_date ? formatDate(person.hire_date) : "" },
    { label: "Next shift", value: person.next_shift },
    {
      label: "Last submission",
      value: person.last_submission_at ? formatDateTime(person.last_submission_at) : "No submissions yet",
    },
  ].filter((fact) => fact.value);

  return (
    <Card>
      <CardBody className="grid gap-6 pt-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-xs text-ink-muted">{fact.label}</dt>
                <dd className="text-ink [overflow-wrap:anywhere]">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 max-w-md">
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-ink-secondary">Verified skills</span>
              <span className="font-medium text-ink">
                {person.skills_verified}/{person.skills_total}
              </span>
            </div>
            <ProgressBar
              value={person.skills_verified}
              max={person.skills_total}
              label={`${person.skills_verified} of ${person.skills_total} skills verified`}
            />
            <p className="mt-2 text-xs text-ink-muted">
              {plural(person.attempt_count, "submission")}
              {person.skills_in_review > 0 ? ` · ${plural(person.skills_in_review, "skill")} in review` : ""}
              {person.open_flags > 0 ? ` · ${plural(person.open_flags, "open safety flag")}` : ""}
            </p>
          </div>
        </div>

        <div className="rounded-[12px] bg-page p-4">
          <p className="text-sm font-semibold text-ink" id="employment-label">
            Employment
          </p>
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-[12px] border border-border bg-white p-1" role="group" aria-labelledby="employment-label">
            {(["active", "onboarding"] as const).map((value) => {
              const selected = person.employment === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  disabled={saving !== null}
                  onClick={() => void setEmployment(value)}
                  className={cn(
                    "h-9 rounded-[10px] text-sm font-medium transition-colors disabled:cursor-wait",
                    selected ? "bg-teal text-white" : "text-ink-secondary hover:bg-secondary hover:text-ink",
                  )}
                >
                  {saving === value ? "Saving…" : caregiverStatus[value].label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-ink-secondary">
            Mark a caregiver active once they are cleared for independent shifts. “Restricted” is not set here: it
            applies on its own while a safety concern from one of their submissions is waiting for review, and lifts
            once a nurse has reviewed it.
          </p>
          {person.status === "restricted" ? (
            <p className="mt-2 text-xs font-medium text-danger">
              Shown as restricted now. Employment underneath: {caregiverStatus[person.employment].label.toLowerCase()}.
            </p>
          ) : null}
          {error ? <ErrorNote className="mt-3" message={error} /> : null}
        </div>
      </CardBody>
    </Card>
  );
}

function SkillsCard({ person }: { person: CaregiverDetail }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Skills</CardTitle>
          <CardDescription>
            {firstName(person.name)}&apos;s standing on each of the agency&apos;s skills.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        {person.skills.length === 0 ? (
          <EmptyState title="No skills yet">
            Skills appear here once a nurse adds one to the library from a reference recording.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-[12px] border border-border">
            {person.skills.map((skill) => {
              const state = skillState[skill.state];
              return (
                <li key={skill.skill_id} className="flex flex-wrap items-center gap-3 bg-white px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/skills/${skill.skill_id}`} className="font-medium text-ink hover:text-teal">
                      {skill.name}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {categoryLabel[skill.category] ?? categoryLabel.other} ·{" "}
                      {skill.attempts === 0 ? "No submissions" : plural(skill.attempts, "submission")}
                    </p>
                  </div>
                  <StateBadge entry={state} />
                  {skill.attempt_id ? (
                    <Link
                      href={`/dashboard/reviews/${skill.attempt_id}`}
                      className="w-28 text-right text-sm font-medium text-teal hover:underline"
                      aria-label={`Open the review for ${skill.name}`}
                    >
                      {skill.state === "in_review" ? "Review" : "Open review"}
                    </Link>
                  ) : (
                    <span className="w-28 text-right text-xs text-ink-muted">Not submitted</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function HistoryCard({ person }: { person: CaregiverDetail }) {
  const attempts = person.attempts;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Submission history</CardTitle>
          <CardDescription>
            Every recording {firstName(person.name)} has submitted, newest first, including ones sent back for
            retraining.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody>
        {attempts.length === 0 ? (
          <EmptyState title="No submissions yet">
            Recordings appear here when this caregiver practises a skill in the caregiver portal.
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-border">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="whitespace-nowrap bg-secondary text-xs font-medium text-ink-secondary">
                  <tr>
                    <th className="px-3 py-3 font-medium">Skill</th>
                    <th className="px-3 py-3 font-medium">Submitted</th>
                    <th className="px-3 py-3 font-medium">AI assessment</th>
                    <th className="hidden px-3 py-3 font-medium xl:table-cell">Safety flags</th>
                    <th className="px-3 py-3 font-medium">Review status</th>
                    <th className="hidden px-3 py-3 font-medium xl:table-cell">Reviewer</th>
                    <th className="px-3 py-3 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((item) => (
                    <tr
                      key={item.id}
                      className={cn(
                        "border-t border-border align-top",
                        item.review_state === "retraining" ? "bg-danger-bg/30 hover:bg-danger-bg/50" : "bg-white hover:bg-page",
                      )}
                    >
                      <td className="px-3 py-3">
                        <span className="block font-medium text-ink xl:min-w-28">{item.skill_name}</span>
                        {item.skill_version > 1 ? (
                          <span className="text-xs text-ink-muted">Version {item.skill_version}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-ink-secondary xl:whitespace-nowrap" title={relativeTime(item.created_at)}>
                        {formatDateTime(item.created_at)}
                      </td>
                      <td className="px-3 py-3">
                        {item.ai_assessment ? (
                          <StateBadge entry={aiAssessment[item.ai_assessment]} />
                        ) : (
                          <span className="text-ink-muted">Not graded</span>
                        )}
                        {item.flag_count > 0 ? (
                          <span className="mt-1 block whitespace-nowrap text-xs font-medium text-danger xl:hidden">
                            {plural(item.flag_count, "safety flag")}
                          </span>
                        ) : null}
                      </td>
                      <td className="hidden px-3 py-3 xl:table-cell">
                        {item.flag_count > 0 ? (
                          <span className="whitespace-nowrap font-medium text-danger">{plural(item.flag_count, "flag")}</span>
                        ) : (
                          <span className="text-ink-muted">None</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <StateBadge entry={reviewState[item.review_state]} />
                        <div className="mt-2 xl:hidden">
                          <Reviewer item={item} />
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 xl:table-cell">
                        <Reviewer item={item} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Link
                          href={`/dashboard/reviews/${item.id}`}
                          className="text-sm font-medium text-teal hover:underline"
                          aria-label={`Open ${item.skill_name} from ${formatDateTime(item.created_at)}`}
                        >
                          {item.review_state === "pending" ? "Review" : "Open"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {attempts.some((item) => item.review_state === "retraining") ? (
          <p className="mt-3 text-xs text-ink-secondary">
            Rows shaded red were sent back for retraining. They stay here for the record; the caregiver sees the
            nurse&apos;s feedback in their portal.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Reviewer({ item }: { item: CaregiverDetail["attempts"][number] }) {
  if (!item.reviewer_name) return <span className="text-xs text-ink-muted xl:text-sm">Not reviewed</span>;
  return (
    <div className="xl:min-w-40">
      <p className="text-ink">
        {item.reviewer_name}
        {item.reviewer_credentials ? `, ${item.reviewer_credentials}` : ""}
      </p>
      {item.reviewed_at ? <p className="text-xs text-ink-muted">{formatDateTime(item.reviewed_at)}</p> : null}
      {item.nurse_note ? <p className="mt-1 text-xs text-ink-secondary">“{item.nurse_note}”</p> : null}
    </div>
  );
}
