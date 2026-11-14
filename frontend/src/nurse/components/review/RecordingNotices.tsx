import Link from "next/link";
import { EyeOff, History, MessageSquareWarning } from "lucide-react";
import { firstName, formatDateTime } from "@/lib/format";
import type { Attempt, AttemptHistoryItem } from "@/lib/types";
import { pct } from "@/nurse/components/attempts/words";

function who(attempt: Attempt) {
  return firstName(attempt.caregiver_name || "") || "The caregiver";
}

/** The caregiver's newest submission of this skill other than this one, if there is one. */
export function newestSubmission(attempt: Attempt): AttemptHistoryItem | null {
  const sent = attempt.history.filter((item) => item.submitted_at);
  return sent.find((item) => item.review_state === "pending") ?? sent[0] ?? null;
}

/** Shown when the caregiver sent this recording under the score needed to send, with a note. */
export function SentAnywayBanner({ attempt }: { attempt: Attempt }) {
  if (attempt.submit_kind !== "forced") return null;
  const name = who(attempt);
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3">
      <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">Sent anyway, with a note, at {pct(attempt.score_pct)}</p>
        <p className="mt-1 text-sm text-ink-secondary">
          The score was under what this skill needs for sending (now {pct(attempt.policy.submit_pct)}). {name} thinks
          the automatic check got it wrong
          {attempt.submitted_at ? ` and sent it on ${formatDateTime(attempt.submitted_at)}` : ""}. Their note:
        </p>
        <blockquote className="mt-2 rounded-[10px] border-l-4 border-warning bg-white px-3 py-2 text-sm text-ink [overflow-wrap:anywhere]">
          {attempt.submit_note || "No note."}
        </blockquote>
        <p className="mt-2 text-xs text-ink-secondary">Check the steps they disagree with in the video before deciding.</p>
      </div>
    </div>
  );
}

/** Shown on a recording the caregiver has since replaced with a newer one. */
export function SupersededNotice({ attempt }: { attempt: Attempt }) {
  if (attempt.review_state !== "superseded") return null;
  const newest = newestSubmission(attempt);
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-[12px] border border-info/20 bg-info-bg px-4 py-3">
      <History className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-ink">{who(attempt)} sent a newer recording of this skill</p>
        <p className="mt-1 text-ink-secondary">
          This one was replaced{newest?.submitted_at ? ` on ${formatDateTime(newest.submitted_at)}` : ""}, so it is no
          longer in your queue. The newest is the one waiting for your decision.
        </p>
        {newest ? (
          <Link href={`/dashboard/reviews/${newest.id}`} className="mt-2 inline-block font-medium text-teal hover:underline">
            Open the newest recording{newest.score_pct !== null ? ` (${pct(newest.score_pct)})` : ""}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Shown on a graded recording the caregiver kept to themselves. */
export function PracticeRunNotice({ attempt }: { attempt: Attempt }) {
  if (attempt.review_state !== "unsubmitted") return null;
  const name = who(attempt);
  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-border bg-secondary px-4 py-3">
      <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-semibold text-ink">Practice run, not sent to you</p>
        <p className="mt-1 text-ink-secondary">
          {name} recorded this on {formatDateTime(attempt.created_at)} and has not sent it for review. You can watch it
          and read the automatic check, but there is nothing to decide unless they send it.{" "}
          {attempt.submission.reason ? <>What {name} sees: “{attempt.submission.reason}”</> : null}
        </p>
      </div>
    </div>
  );
}
