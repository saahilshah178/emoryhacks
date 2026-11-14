"use client";

import Link from "next/link";
import { Card, CardBody, CardHeader, CardTitle, ErrorNote, ProgressBar, Skeleton } from "@/components/ui";
import { percent } from "@/lib/format";
import { useDashboard } from "@/nurse/context/DashboardContext";

/** Safety patterns and the agency's overall verification figure, from GET /overview. */
export function SafetyOverview() {
  const { overview, overviewError, reloadOverview } = useDashboard();

  if (!overview) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Safety overview</CardTitle>
        </CardHeader>
        <CardBody>
          {overviewError ? (
            <ErrorNote message={overviewError} onRetry={reloadOverview} />
          ) : (
            <div className="grid gap-8 lg:grid-cols-3">
              <Skeleton className="h-36" />
              <Skeleton className="h-36" />
              <Skeleton className="h-36" />
            </div>
          )}
        </CardBody>
      </Card>
    );
  }

  const { missed_steps: missed, flagged_skills: flagged, verification_rate: rate, pattern_days: days, counts } = overview;
  const maxMissed = Math.max(1, ...missed.map((item) => item.count));
  const maxFlags = Math.max(1, ...flagged.map((item) => item.flags));
  const possible = counts.caregivers * counts.skills;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Safety overview</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">Patterns from the last {days} days.</p>
        </div>
      </CardHeader>
      <CardBody className="grid gap-8 lg:grid-cols-3">
        <div>
          <p className="mb-3 text-xs font-semibold text-ink-secondary">Most frequently missed steps</p>
          {missed.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              No failed steps in the last {days} days. Steps that the AI or a nurse marks as failed are counted here.
            </p>
          ) : (
            <ul className="space-y-3">
              {missed.map((item) => (
                <li key={`${item.skill_name}-${item.label}`}>
                  <div className="mb-1 flex items-start justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block text-ink">{item.label}</span>
                      <span className="block text-xs text-ink-muted">{item.skill_name}</span>
                    </span>
                    <span className="shrink-0 text-ink-secondary">{item.count}</span>
                  </div>
                  <ProgressBar
                    value={item.count}
                    max={maxMissed}
                    label={`${item.label}: missed ${item.count} times`}
                    barClassName="bg-warning!"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold text-ink-secondary">Skills with the most safety flags</p>
          {flagged.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              No safety flags in the last {days} days. Flags raised on caregiver recordings are counted here by skill.
            </p>
          ) : (
            <ul className="space-y-3">
              {flagged.map((item) => (
                <li key={item.slug}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    {item.skill_id ? (
                      <Link href={`/dashboard/skills/${item.skill_id}`} className="min-w-0 truncate text-ink hover:text-teal">
                        {item.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate text-ink">{item.name}</span>
                    )}
                    <span className="shrink-0 text-danger">{item.flags}</span>
                  </div>
                  <ProgressBar
                    value={item.flags}
                    max={maxFlags}
                    label={`${item.name}: ${item.flags} safety flags`}
                    barClassName="bg-danger!"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-[12px] bg-teal-soft p-4">
          <p className="text-xs font-semibold text-teal">Overall verification</p>
          <p className="mt-3 text-3xl font-semibold text-navy">{rate === null ? "–" : percent(rate)}</p>
          {rate === null ? (
            <p className="mt-2 text-sm text-ink-secondary">
              Appears once your agency has both caregivers and skills.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-secondary">
                Share of caregiver–skill sign-offs a nurse has approved: {counts.verified} of {possible}. AI
                findings never certify a skill on their own.
              </p>
              <div className="mt-4">
                <ProgressBar value={rate * 100} label="Overall verification" />
              </div>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
