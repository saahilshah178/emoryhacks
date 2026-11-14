"use client";

import Link from "next/link";
import { Avatar, Badge, Card, EmptyState, Loadable, ProgressBar, Skeleton, StateBadge } from "@/components/ui";
import { formatDate, matchesQuery, plural, relativeTime } from "@/lib/format";
import { useApi, useTitle } from "@/lib/hooks";
import { caregiverStatus } from "@/lib/status";
import type { CaregiverRow } from "@/lib/types";
import { useDashboard } from "@/nurse/context/DashboardContext";
import { useUser } from "@/shared/AuthProvider";

export default function CaregiversPage() {
  useTitle("Caregivers");
  const user = useUser();
  const { search, overview } = useDashboard();
  const roster = useApi<CaregiverRow[]>("/caregivers", { refreshMs: 30_000 });
  const agency = overview?.agency ?? user.org.name;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <p className="text-sm text-ink-secondary">
        Competency progress across {agency}. A caregiver is restricted while a safety concern from one of their
        submissions is waiting for review.
      </p>

      <Loadable
        data={roster.data}
        error={roster.error}
        loading={roster.loading}
        reload={roster.reload}
        skeleton={
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} className="h-56" />
            ))}
          </div>
        }
      >
        {(people) => {
          if (people.length === 0) {
            return (
              <EmptyState title="No caregivers yet">
                Caregivers appear here as soon as they create an account in the caregiver portal. Their progress on
                each skill fills in as they submit recordings.
              </EmptyState>
            );
          }
          const rows = people.filter((person) =>
            matchesQuery(
              search,
              person.name,
              person.title,
              person.email,
              person.location,
              caregiverStatus[person.status]?.label,
            ),
          );
          if (rows.length === 0) {
            return <EmptyState title="No caregivers match this search">Try a name, job title or location.</EmptyState>;
          }
          return (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((person) => (
                <CaregiverCard key={person.id} person={person} />
              ))}
            </div>
          );
        }}
      </Loadable>
    </div>
  );
}

/** "Just now" and "Yesterday" read better lower-case mid-sentence; dates keep their capitals. */
function inSentence(phrase: string) {
  return phrase === "Just now" || phrase === "Yesterday" ? phrase.toLowerCase() : phrase;
}

function CaregiverCard({ person }: { person: CaregiverRow }) {
  const details = [
    person.location,
    person.hire_date ? `Hired ${formatDate(person.hire_date)}` : "",
    person.last_submission_at ? `Last submission ${inSentence(relativeTime(person.last_submission_at))}` : "",
  ].filter(Boolean);

  return (
    <Card className="relative flex flex-col p-5 transition-shadow focus-within:ring-2 focus-within:ring-teal/30 hover:border-teal/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={person.name} size="lg" />
          <div className="min-w-0">
            {/* The name's link covers the whole card; the "Review latest" link sits above it. */}
            <Link
              href={`/dashboard/caregivers/${person.id}`}
              className="block truncate font-semibold text-ink outline-none after:absolute after:inset-0 after:rounded-[12px] hover:text-teal"
            >
              {person.name}
            </Link>
            <p className="truncate text-sm text-ink-secondary">{person.title || "Caregiver"}</p>
          </div>
        </div>
        <StateBadge entry={caregiverStatus[person.status]} />
      </div>
      {details.length > 0 ? (
        <p className="mt-4 text-xs text-ink-muted">{details.join(" · ")}</p>
      ) : (
        <p className="mt-4 text-xs text-ink-muted">No submissions yet</p>
      )}
      <div className="mt-4">
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-ink-secondary">Verified skills</span>
          <span className="font-medium text-ink">
            {person.skills_verified}/{person.skills_total}
          </span>
        </div>
        <ProgressBar
          value={person.skills_verified}
          max={person.skills_total}
          label={`${person.name}: ${person.skills_verified} of ${person.skills_total} skills verified`}
        />
        {person.skills_in_review > 0 ? (
          <p className="mt-1.5 text-xs text-ink-muted">{plural(person.skills_in_review, "skill")} in review</p>
        ) : null}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-sm">
        {person.open_flags > 0 ? (
          <Badge tone="danger" dot>
            {plural(person.open_flags, "open flag")}
          </Badge>
        ) : (
          <span className="text-xs text-ink-muted">No open flags</span>
        )}
        {person.pending_attempt_id ? (
          <Link
            href={`/dashboard/reviews/${person.pending_attempt_id}`}
            className="relative z-10 text-sm font-medium text-teal hover:underline"
          >
            Review latest
          </Link>
        ) : (
          <span className="text-xs text-ink-muted">No pending review</span>
        )}
      </div>
    </Card>
  );
}
