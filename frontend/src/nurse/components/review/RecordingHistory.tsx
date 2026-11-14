import Link from "next/link";
import { Badge, StateBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { firstName, formatDateTime, plural } from "@/lib/format";
import type { Attempt, AttemptHistoryItem } from "@/lib/types";
import { historyHref, pct, recordingState, usedOfAllowed } from "@/nurse/components/attempts/words";

export const RECORDINGS_ANCHOR = "recordings";

/**
 * "This caregiver's recordings of this skill": this one and attempt.history, newest first,
 * with this one marked. Each other one opens its own page.
 */
export function RecordingHistory({ attempt }: { attempt: Attempt }) {
  if (!attempt.caregiver_id) return null;
  const current: AttemptHistoryItem = {
    id: attempt.id,
    created_at: attempt.created_at,
    submitted_at: attempt.submitted_at,
    submit_kind: attempt.submit_kind,
    score_pct: attempt.score_pct,
    status: attempt.status,
    final_status: attempt.final_status,
    review_state: attempt.review_state,
    skill_id: attempt.skill_id,
    skill_version: attempt.skill_version,
  };
  const items = [current, ...attempt.history].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const name = firstName(attempt.caregiver_name || "") || "This caregiver";
  const { used, allowed } = attempt.attempts;

  return (
    <section
      id={RECORDINGS_ANCHOR}
      aria-labelledby="recordings-title"
      className="scroll-mt-20 rounded-[12px] border border-border bg-white p-4 shadow-[var(--shadow-card)]"
    >
      <h3 id="recordings-title" className="text-base font-semibold text-navy">
        {name}&apos;s recordings of this skill
      </h3>
      <p className="mt-1 text-xs text-ink-secondary">
        {plural(items.length, "recording")}, newest first
        {used !== null ? ` · attempts ${usedOfAllowed(used, allowed)}` : ""}.
      </p>
      <ol className="mt-3 space-y-1.5">
        {items.map((item) => {
          const here = item.id === attempt.id;
          const body = (
            <>
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">{formatDateTime(item.created_at)}</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {item.score_pct !== null ? pct(item.score_pct) : "No score"}
                </span>
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5">
                <StateBadge entry={recordingState[item.review_state]} />
                {item.submit_kind === "forced" ? <Badge tone="warning">Sent anyway</Badge> : null}
                {item.skill_version !== attempt.skill_version ? (
                  <span className="text-xs text-ink-muted">Version {item.skill_version}</span>
                ) : null}
                {here ? <span className="ml-auto text-xs font-semibold text-teal">This one</span> : null}
              </span>
            </>
          );
          return (
            <li key={item.id}>
              {here ? (
                <div aria-current="page" className="rounded-[10px] border border-teal bg-teal-soft/50 px-3 py-2">
                  {body}
                </div>
              ) : (
                <Link
                  href={`/dashboard/reviews/${item.id}`}
                  className={cn("block rounded-[10px] border border-border px-3 py-2 hover:border-teal hover:bg-page")}
                >
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      <Link
        href={historyHref(attempt.caregiver_id, attempt.skill_slug)}
        className="mt-3 inline-block text-sm font-medium text-teal hover:underline"
      >
        All of {name}&apos;s recordings
      </Link>
    </section>
  );
}
