"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge, Card, CardBody, CardDescription, CardHeader, CardTitle, EmptyState, Select, StateBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { firstName, formatDateTime, plural, relativeTime } from "@/lib/format";
import { aiAssessment } from "@/lib/status";
import type { AttemptSummary, CaregiverDetail } from "@/lib/types";
import { pct, recordingState } from "@/nurse/components/attempts/words";

export const HISTORY_ANCHOR = "history";

/** Bring the history into view, e.g. after choosing a skill's recordings above it. */
export function scrollToHistory() {
  document.getElementById(HISTORY_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** "#history-sit_to_stand" opens the history filtered to that skill. */
function slugFromHash() {
  const match = window.location.hash.match(/^#history-(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Which skill the history shows: the one the nurse chose, else the one in the address
 * (#history-<skill>), else every skill. The address is read while rendering rather than once
 * at mount, because after a client-side navigation the hash arrives after the first render.
 */
export function useHistorySlug() {
  const fromHash = useSyncExternalStore(subscribeToHash, slugFromHash, () => null);
  const [chosen, setChosen] = useState<string | null>(null);
  return [chosen ?? fromHash ?? "all", setChosen] as const;
}

/**
 * Every recording the caregiver made, newest first: practice runs they never sent, ones
 * sent anyway, ones replaced by a newer one, and the decided ones. Each opens its page.
 */
export function CaregiverHistory({
  person,
  slug: wanted,
  onSlug: setSlug,
}: {
  person: CaregiverDetail;
  /** The skill to show, or "all". */
  slug: string;
  onSlug: (slug: string) => void;
}) {
  const attempts = person.attempts;
  const skills = [...new Map(attempts.map((item) => [item.skill_slug, item.skill_name])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const slug = skills.some(([key]) => key === wanted) ? wanted : "all";
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.location.hash.startsWith(`#${HISTORY_ANCHOR}`)) ref.current?.scrollIntoView({ block: "start" });
  }, []);

  const rows = slug === "all" ? attempts : attempts.filter((item) => item.skill_slug === slug);
  const sent = attempts.filter((item) => item.submitted_at).length;
  const who = firstName(person.name);

  return (
    <section ref={ref} id={HISTORY_ANCHOR} className="scroll-mt-20">
      <Card>
        <CardHeader className="flex-wrap">
          <div className="min-w-0">
            <CardTitle>Recordings</CardTitle>
            <CardDescription>
              Every recording {who} has made, newest first: {plural(attempts.length, "recording")},{" "}
              {sent === attempts.length ? "all sent to you" : `${sent} sent to you`}. Practice runs they have not sent
              are only visible here.
            </CardDescription>
          </div>
          {skills.length > 1 ? (
            <label className="flex items-center gap-2 text-sm text-ink-secondary">
              Skill
              <Select value={slug} onChange={(event) => setSlug(event.target.value)} className="h-9 w-auto pr-8">
                <option value="all">All skills</option>
                {skills.map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
        </CardHeader>
        <CardBody>
          {attempts.length === 0 ? (
            <EmptyState title="No recordings yet">
              Recordings appear here when {who} practises a skill in the caregiver portal, whether or not they send
              them to you.
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-[12px] border border-border">
              <div className="relative overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="whitespace-nowrap bg-secondary text-xs font-medium text-ink-secondary">
                    <tr>
                      <th className="px-3 py-3 font-medium">Skill</th>
                      <th className="px-3 py-3 font-medium">Recorded</th>
                      <th className="px-3 py-3 font-medium">Score</th>
                      <th className="px-3 py-3 font-medium">Where it stands</th>
                      <th className="hidden px-3 py-3 font-medium xl:table-cell">Reviewer</th>
                      <th className="px-3 py-3 text-right font-medium">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <HistoryRow key={item.id} item={item} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {slug !== "all" ? (
            <button
              type="button"
              className="mt-3 text-sm font-medium text-teal hover:underline"
              onClick={() => setSlug("all")}
            >
              Show every skill
            </button>
          ) : null}
        </CardBody>
      </Card>
    </section>
  );
}

function HistoryRow({ item }: { item: AttemptSummary }) {
  const forced = item.submit_kind === "forced";
  const practice = item.review_state === "unsubmitted";
  return (
    <tr
      className={cn(
        "border-t border-border align-top",
        practice || item.review_state === "superseded" ? "bg-page" : "bg-white",
        "hover:bg-secondary/60",
      )}
    >
      <td className="px-3 py-3">
        <span className="block font-medium text-ink xl:min-w-28">{item.skill_name}</span>
        <span className="text-xs text-ink-muted">Version {item.skill_version}</span>
      </td>
      <td className="px-3 py-3 text-ink-secondary" title={relativeTime(item.created_at)}>
        <span className="block xl:whitespace-nowrap">{formatDateTime(item.created_at)}</span>
        <span className="block text-xs text-ink-muted">
          {item.submitted_at ? `Sent ${relativeTime(item.submitted_at).replace(/^(Just now|Yesterday)$/, (m) => m.toLowerCase())}` : "Not sent to you"}
        </span>
      </td>
      <td className="px-3 py-3">
        {item.score_pct !== null ? (
          <span className="font-semibold tabular-nums text-ink">{pct(item.score_pct)}</span>
        ) : (
          <span className="text-ink-muted">No score</span>
        )}
        {item.ai_assessment ? (
          <span className="mt-1 block">
            <StateBadge entry={aiAssessment[item.ai_assessment]} />
          </span>
        ) : null}
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-1.5">
          <StateBadge entry={recordingState[item.review_state]} />
          {forced ? <Badge tone="warning">Sent anyway</Badge> : null}
          {item.flag_count > 0 ? <Badge tone="danger">{plural(item.flag_count, "safety flag")}</Badge> : null}
        </div>
        {forced && item.submit_note ? (
          <p className="mt-1.5 max-w-xs text-xs text-ink-secondary">“{item.submit_note}”</p>
        ) : null}
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
  );
}

function Reviewer({ item }: { item: AttemptSummary }) {
  if (!item.reviewer_name) {
    return item.submitted_at ? <span className="text-xs text-ink-muted xl:text-sm">Not reviewed</span> : null;
  }
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
