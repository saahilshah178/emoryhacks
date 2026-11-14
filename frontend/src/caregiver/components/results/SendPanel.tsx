"use client";

import Link from "next/link";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, ChevronRight, CircleSlash, Hourglass, MessageSquareText, RotateCcw, Send } from "lucide-react";
import { Button, Card, ErrorNote, StateBadge, Textarea } from "@/components/ui";
import { practiceHref, resultsHref } from "@/caregiver/skills";
import { attemptStateForCaregiver, formatScore, noAttemptsLeft } from "@/caregiver/status";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { Attempt, AttemptHistoryItem, SubmitRequest } from "@/lib/types";

/** The note a "send anyway" needs, in characters (the API's FORCE_NOTE_MIN). */
export const FORCE_NOTE_MIN = 10;

type Band = "send" | "anyway" | "below";

function bandOf(score: number, submitPct: number, forcePct: number): Band {
  if (score >= submitPct) return "send";
  if (score >= forcePct) return "anyway";
  return "below";
}

const bandFill: Record<Band, string> = { send: "bg-success", anyway: "bg-warning", below: "bg-danger" };
const bandText: Record<Band, string> = { send: "text-success", anyway: "text-warning", below: "text-danger" };

/** "Attempt 2 of 3 · 1 left", "2 of 3 attempts left" or "Unlimited attempts". */
export function attemptsSummary(attempt: Attempt) {
  const { used, allowed, left } = attempt.attempts;
  if (allowed === null || left === null || used === null) return "Unlimited attempts";
  const remaining = left === 0 ? "no attempts left" : `${left} left`;
  // This recording's number in the current set is only known for the newest one that counted.
  const newest = !attempt.history.some((item) => item.review_state !== "error" && item.created_at > attempt.created_at);
  const counted = attempt.review_state !== "error" && attempt.review_state !== "retraining";
  if (newest && counted && used > 0) return `Attempt ${used} of ${allowed} · ${remaining}`;
  return `${left} of ${allowed} ${allowed === 1 ? "attempt" : "attempts"} left`;
}

/**
 * The caregiver's score on a slim bar from 0 to 100, with a mark where sending opens and one
 * where "send anyway" opens, and a key that names both marks.
 */
export function ScoreMeter({ score, submitPct, forcePct }: { score: number; submitPct: number; forcePct: number }) {
  const band = bandOf(score, submitPct, forcePct);
  const hasAnyway = forcePct < submitPct;
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  // Labels under marks that sit close together lean away from each other.
  const close = hasAnyway && submitPct - forcePct < 16;
  const marks = [
    ...(hasAnyway ? [{ at: forcePct, kind: "anyway" as const }] : []),
    { at: submitPct, kind: "send" as const },
  ];

  function labelShift(at: number, kind: "anyway" | "send") {
    if (at <= 6 || (close && kind === "send")) return "translateX(0)";
    if (at >= 94 || (close && kind === "anyway")) return "translateX(-100%)";
    return "translateX(-50%)";
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink-secondary">Your score</p>
        <p className={cn("text-3xl font-semibold tracking-tight tabular-nums", bandText[band])}>{formatScore(score)}</p>
      </div>
      <div
        className="relative mt-3"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={`${formatScore(score)}. ${formatScore(submitPct)} or more is good enough to send${hasAnyway ? `, ${formatScore(forcePct)} or more can be sent anyway` : ""}.`}
        aria-label="Your score"
      >
        <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
          <div className={cn("h-full rounded-full", bandFill[band])} style={{ width: `${clamp(score)}%` }} />
        </div>
        {marks.map((mark) => (
          <span
            key={mark.kind}
            aria-hidden
            className={cn(
              "absolute -top-1 h-[18px] w-[3px] -translate-x-1/2 rounded-full ring-2 ring-white",
              mark.kind === "send" ? "bg-navy" : "bg-ink-secondary",
            )}
            style={{ left: `${clamp(mark.at)}%` }}
          />
        ))}
      </div>
      <div className="relative mt-2 h-4 text-xs font-semibold tabular-nums" aria-hidden>
        {marks.map((mark) => (
          <span
            key={mark.kind}
            className={cn("absolute top-0 whitespace-nowrap", mark.kind === "send" ? "text-navy" : "text-ink-secondary")}
            style={{ left: `${clamp(mark.at)}%`, transform: labelShift(mark.at, mark.kind) }}
          >
            {formatScore(mark.at)}
          </span>
        ))}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-ink-secondary">
        <li className="flex items-center gap-2">
          <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-navy" aria-hidden />
          <span>
            <span className="font-semibold text-navy">{formatScore(submitPct)}</span> or more: good enough to send to your nurse
          </span>
        </li>
        {hasAnyway ? (
          <li className="flex items-center gap-2">
            <span className="h-3.5 w-[3px] shrink-0 rounded-full bg-ink-secondary" aria-hidden />
            <span>
              <span className="font-semibold text-ink">{formatScore(forcePct)}</span> or more: send it anyway, with a note
            </span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function SendAnywayForm({
  sending,
  error,
  onSend,
  onCancel,
}: {
  sending: boolean;
  error: string | null;
  onSend: (note: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const length = note.trim().length;
  const short = length < FORCE_NOTE_MIN;
  const toGo = FORCE_NOTE_MIN - length;

  function submit(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (short) return;
    onSend(note.trim());
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-[12px] border border-border bg-page p-4" aria-label="Send it anyway">
      <div>
        <label htmlFor={`${id}-note`} className="block text-sm font-semibold text-navy">
          What did the automatic check get wrong?
        </label>
        <p className="mt-0.5 text-xs text-ink-secondary">
          For example, a step it marked as missed that you did, or one it couldn&apos;t see clearly.
        </p>
      </div>
      <Textarea
        id={`${id}-note`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        maxLength={2000}
        autoFocus
        required
        aria-invalid={tried && short ? true : undefined}
        aria-describedby={`${id}-count ${id}-who`}
        className="min-h-24 text-base"
      />
      <p
        id={`${id}-count`}
        aria-live="polite"
        className={cn("text-xs font-medium", short ? (tried ? "text-danger" : "text-ink-secondary") : "text-success")}
      >
        {short
          ? length === 0
            ? `Write at least ${FORCE_NOTE_MIN} characters.`
            : `${toGo} more ${toGo === 1 ? "character" : "characters"} needed.`
          : "That's enough to send."}
      </p>
      <p id={`${id}-who`} className="flex gap-2 text-sm text-ink">
        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
        Your nurse will see that you sent it anyway, along with your note.
      </p>
      {error ? <ErrorNote message={error} /> : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" size="lg" loading={sending} className="sm:flex-1">
          <Send className="h-4 w-4" aria-hidden />
          Send
        </Button>
        <Button variant="ghost" size="lg" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AttemptsNote({ attempt }: { attempt: Attempt }) {
  return <p className="text-xs font-medium text-ink-secondary">{attemptsSummary(attempt)}</p>;
}

/** Their choices for a graded recording they have not sent: send it, send it anyway, or record again. */
function Decide({ attempt, skillId, onSent }: { attempt: Attempt; skillId: string; onSent: (attempt: Attempt) => void }) {
  const { submission } = attempt;
  const [mode, setMode] = useState<"choose" | "anyway">("choose");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRecord = attempt.attempts.left !== 0;

  async function send(body: SubmitRequest) {
    setSending(true);
    setError(null);
    try {
      onSent(await api<Attempt>(`/attempts/${attempt.id}/submit`, { json: body }));
    } catch (problem) {
      setError(errorMessage(problem));
      setSending(false);
    }
  }

  let actions: ReactNode;
  if (submission.can_submit) {
    actions = (
      <>
        <p className="text-[15px] leading-relaxed text-ink">
          We suggest sending this one to your nurse.{canRecord ? " You can record again first if you'd rather." : ""}
        </p>
        {error ? <ErrorNote message={error} /> : null}
        <Button onClick={() => send({})} loading={sending} size="xl" className="w-full">
          <Send className="h-4 w-4" aria-hidden />
          Send to my nurse
        </Button>
        <p className="text-sm text-ink-secondary">
          Your nurse watches it and makes the final decision. The automatic check is only a suggestion. Nothing is
          sent until you press the button.
        </p>
        {canRecord ? (
          <>
            <Button href={practiceHref(skillId)} variant="secondary" size="lg" className="w-full">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Record again instead
            </Button>
            <p className="text-sm text-ink-secondary">
              If you record again, this recording is kept and you can still send it later.
              {attempt.attempts.allowed !== null ? " A new recording uses one of your attempts." : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink">{noAttemptsLeft(attempt.attempts.allowed ?? 0)}</p>
        )}
      </>
    );
  } else if (submission.can_force) {
    actions =
      mode === "anyway" ? (
        <SendAnywayForm
          sending={sending}
          error={error}
          onSend={(note) => send({ force: true, note })}
          onCancel={() => {
            setMode("choose");
            setError(null);
          }}
        />
      ) : (
        <>
          {canRecord ? (
            <Button href={practiceHref(skillId)} size="xl" className="w-full">
              <RotateCcw className="h-4 w-4" aria-hidden />
              Record again
            </Button>
          ) : (
            <p className="text-sm text-ink">{noAttemptsLeft(attempt.attempts.allowed ?? 0)}</p>
          )}
          <Button variant={canRecord ? "ghost" : "secondary"} size="lg" onClick={() => setMode("anyway")} className="w-full">
            Send it anyway
          </Button>
        </>
      );
  } else {
    actions = canRecord ? (
      <Button href={practiceHref(skillId)} size="xl" className="w-full">
        <RotateCcw className="h-4 w-4" aria-hidden />
        Record again
      </Button>
    ) : (
      <p className="flex gap-2 rounded-[12px] bg-secondary px-3 py-2.5 text-sm text-ink">
        <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
        {noAttemptsLeft(attempt.attempts.allowed ?? 0)}
      </p>
    );
  }

  return (
    <Card className="p-5 lg:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-10">
        <div className="space-y-4">
          <ScoreMeter score={attempt.score_pct ?? 0} submitPct={submission.submit_pct} forcePct={submission.force_pct} />
          <p className="text-[15px] leading-relaxed text-ink">{submission.reason}</p>
        </div>
        <div className="space-y-3 lg:border-l lg:border-border lg:pl-10">
          <h2 className="text-sm font-semibold text-navy">What to do next</h2>
          {actions}
          <AttemptsNote attempt={attempt} />
        </div>
      </div>
    </Card>
  );
}

function SentNote({ attempt }: { attempt: Attempt }) {
  const note = attempt.submit_note.trim();
  if (!note) return null;
  return (
    <div className="rounded-[12px] bg-page px-4 py-3">
      <p className="text-xs font-semibold text-ink-secondary">
        {attempt.submit_kind === "forced" ? "Why you sent it anyway" : "Your note"}
      </p>
      <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{note}</p>
    </div>
  );
}

/** A card with an icon beside its heading and the rest at full width, kept to a readable measure. */
function StatusCard({ icon, iconTone, title, subtitle, children }: { icon: ReactNode; iconTone: string; title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-5 lg:p-6">
      <div className="max-w-3xl space-y-3">
        <div className="flex items-center gap-3">
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", iconTone)}>{icon}</span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-navy">{title}</h2>
            <p className="text-sm text-ink-secondary">{subtitle}</p>
          </div>
        </div>
        {children}
      </div>
    </Card>
  );
}

/** A recording that is with the nurse. */
function Sent({ attempt }: { attempt: Attempt }) {
  const forced = attempt.submit_kind === "forced";
  return (
    <StatusCard
      icon={<Send className="h-5 w-5" aria-hidden />}
      iconTone="bg-success-bg text-success"
      title={forced ? "Sent to your nurse anyway" : "Sent to your nurse"}
      subtitle={formatDateTime(attempt.submitted_at)}
    >
      <p className="text-[15px] leading-relaxed text-ink">
        {forced
          ? "Your nurse can see that you sent it anyway, with your note, and will make the final decision."
          : "Your nurse will watch it and make the final decision. You'll see it here and on your home page."}
      </p>
      <SentNote attempt={attempt} />
      <p className="text-sm text-ink-secondary">
        If you record this skill again and send the new one, your nurse will review that one instead.
      </p>
      <AttemptsNote attempt={attempt} />
    </StatusCard>
  );
}

/** The newest recording of this skill that was sent, for a replaced one to point at. */
function newestSent(history: AttemptHistoryItem[]) {
  return [...history]
    .filter((item) => item.submitted_at)
    .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""))[0];
}

/** A sent recording that a newer one replaced before the nurse got to it. */
function Replaced({ attempt }: { attempt: Attempt }) {
  const newer = newestSent(attempt.history);
  return (
    <StatusCard
      icon={<Hourglass className="h-5 w-5" aria-hidden />}
      iconTone="bg-secondary text-ink-secondary"
      title="You sent a newer recording instead"
      subtitle={`You sent this one ${attempt.submit_kind === "forced" ? "anyway " : ""}on ${formatDateTime(attempt.submitted_at)}`}
    >
      <p className="text-[15px] leading-relaxed text-ink">
        {newer
          ? `Your nurse will review the one you sent on ${formatDateTime(newer.submitted_at)} instead.`
          : attempt.submission.reason}
      </p>
      <SentNote attempt={attempt} />
      {newer ? (
        <Button href={resultsHref(newer.skill_id, newer.id)} variant="secondary" size="lg" className="w-full sm:w-auto">
          See the newer recording
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      ) : null}
    </StatusCard>
  );
}

/**
 * Near the top of a result: where the recording stands with the nurse and what the caregiver
 * can do about it. Nothing for a recording the nurse has decided on; the page says that itself.
 */
export function SendPanel({ attempt, skillId, onSent }: { attempt: Attempt; skillId: string; onSent: (attempt: Attempt) => void }) {
  if (attempt.review_state === "unsubmitted") return <Decide attempt={attempt} skillId={skillId} onSent={onSent} />;
  if (attempt.review_state === "pending") return <Sent attempt={attempt} />;
  if (attempt.review_state === "superseded") return <Replaced attempt={attempt} />;
  return null;
}

function SentMark({ item }: { item: Pick<AttemptHistoryItem, "submitted_at" | "submit_kind"> }) {
  if (!item.submitted_at) return null;
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-teal">
      <Send className="h-3 w-3" aria-hidden />
      {item.submit_kind === "forced" ? "Sent anyway" : "Sent"}
    </span>
  );
}

/** Every recording of this skill, this one included, newest first: the caregiver's own history. */
export function AttemptHistory({ attempt, className }: { attempt: Attempt; className?: string }) {
  const items: AttemptHistoryItem[] = [attempt, ...attempt.history].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <section className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-sm font-semibold text-navy">Your attempts</h2>
        <p className="text-xs font-medium text-ink-secondary">{attemptsSummary(attempt)}</p>
      </div>
      <Card className="mt-2">
        <ul className="divide-y divide-border">
          {items.map((item) => {
            const current = item.id === attempt.id;
            const graded = item.score_pct !== null && item.review_state !== "processing" && item.review_state !== "error";
            return (
              <li key={item.id}>
                <Link
                  href={resultsHref(item.skill_id, item.id)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary",
                    current && "bg-secondary",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy">
                      {formatDateTime(item.created_at)}
                      {current ? <span className="font-normal text-ink-secondary"> · this one</span> : null}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-secondary">
                      <StateBadge entry={attemptStateForCaregiver[item.review_state]} />
                      {graded ? <span className="tabular-nums">Score {formatScore(item.score_pct)}</span> : null}
                      <SentMark item={item} />
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
