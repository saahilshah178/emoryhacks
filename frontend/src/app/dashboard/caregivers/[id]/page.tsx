"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Card, CardBody, ErrorNote, Loadable, ProgressBar, Skeleton, StateBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, plural } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { caregiverStatus } from "@/lib/status";
import type { CaregiverDetail } from "@/lib/types";
import { BackLink } from "@/shared/layout/BackLink";
import { PageHeading } from "@/shared/layout/PageHeading";
import { CaregiverHistory, scrollToHistory, useHistorySlug } from "@/nurse/components/caregivers/CaregiverHistory";
import { CaregiverSkills } from "@/nurse/components/caregivers/CaregiverSkills";
import { useDashboard } from "@/nurse/context/DashboardContext";

/** "12 recordings, 5 sent to you" */
function recordingsLine(person: CaregiverDetail) {
  const total = person.attempts.length;
  if (total === 0) return "No recordings yet";
  const sent = person.attempts.filter((item) => item.submitted_at).length;
  return `${plural(total, "recording")}, ${sent === total ? "all" : sent} sent to you`;
}

export default function CaregiverPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useApi<CaregiverDetail>(`/caregivers/${id}`, { refreshMs: 30_000 });
  useTitle(detail.data?.name ?? "Caregiver");
  // Which skill's recordings the history shows; a link to #history-<skill> picks one.
  const [historySlug, setHistorySlug] = useHistorySlug();

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
            <CaregiverSkills
              person={person}
              onSaved={detail.setData}
              onShowHistory={(slug) => {
                setHistorySlug(slug);
                scrollToHistory();
              }}
            />
            <CaregiverHistory person={person} slug={historySlug} onSlug={setHistorySlug} />
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
              {recordingsLine(person)}
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
