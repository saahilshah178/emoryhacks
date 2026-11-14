"use client";

import Link from "next/link";
import { ChevronRight, CircleAlert, HeartHandshake, ShieldCheck, Sparkles, TriangleAlert, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, Badge, Button, Card, ErrorNote, Skeleton, StateBadge } from "@/components/ui";
import { JobProgress } from "@/components/media/JobProgress";
import { TimeChip } from "@/components/media/TimeChip";
import { VideoFrame } from "@/components/media/VideoFrame";
import { BackToSkills, PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { StepResult, stepSpan } from "@/caregiver/components/results/StepResult";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { practiceHref, resultsHref } from "@/caregiver/skills";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, hasSpan } from "@/lib/format";
import { useApi, useJob, useTitle } from "@/lib/hooks";
import { flagTitle, personRole, reviewState, skillState, stepStatusForCaregiver, toneClass, type Tone } from "@/lib/status";
import { useVideoSegments } from "@/lib/segment";
import type { Attempt, AttemptSummary, ReviewState, Status } from "@/lib/types";

/** An attempt's state in the caregiver's words, taken from the skill states. */
export const attemptStateForCaregiver: Record<ReviewState, { label: string; tone: Tone }> = {
  processing: { label: "Checking", tone: reviewState.processing.tone },
  error: reviewState.error,
  pending: skillState.in_review,
  approved: skillState.verified,
  retraining: skillState.needs_practice,
};

const STATUS_ORDER: Status[] = ["passed", "unverified", "failed"];

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-navy">{title}</h2>
      {description ? <p className="mt-0.5 text-sm text-ink-secondary">{description}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Header({
  attempt,
  title,
  actions,
  children,
}: {
  attempt: Attempt;
  title: string;
  /** Buttons beside the heading on a laptop. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <BackToSkills />
      <PortalHeading
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            {attempt.skill_name}
            <StateBadge entry={attemptStateForCaregiver[attempt.review_state]} className="normal-case tracking-normal" />
          </span>
        }
        title={title}
        description={
          <>
            {children}
            <p className="mt-1 text-xs">Recorded {formatDateTime(attempt.created_at)}</p>
          </>
        }
        actions={actions ? <div className="hidden items-center gap-2 lg:flex">{actions}</div> : undefined}
      />
    </>
  );
}

function NurseNote({ attempt }: { attempt: Attempt }) {
  if (!attempt.nurse_note.trim()) return null;
  const name = attempt.reviewer_name || "Your nurse";
  return (
    <div className="rounded-[12px] border border-teal/30 bg-white p-5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-3">
        <Avatar name={name} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy">Note from {name}</p>
          {attempt.reviewed_at ? (
            <p className="text-xs text-ink-secondary">{formatDate(attempt.reviewed_at)}</p>
          ) : null}
        </div>
      </div>
      <p className="mt-3 whitespace-pre-line text-[15px] leading-relaxed text-ink">{attempt.nurse_note}</p>
    </div>
  );
}

/** The same two ways on, as the smaller buttons that sit beside a heading on a laptop. */
function HeadingActions({ skillId, practiceFirst }: { skillId: string; practiceFirst: boolean }) {
  return (
    <>
      <Button href="/portal" variant={practiceFirst ? "secondary" : "primary"}>
        Back to home
      </Button>
      <Button href={practiceHref(skillId)} variant={practiceFirst ? "primary" : "secondary"}>
        Practice again
      </Button>
    </>
  );
}

/** The two ways on from a result, as full-width buttons at the end of the page on a phone. */
function Actions({ skillId, practiceFirst }: { skillId: string; practiceFirst: boolean }) {
  return (
    <div className="flex flex-col gap-3 lg:hidden">
      {practiceFirst ? (
        <>
          <Button href={practiceHref(skillId)} size="xl" className="w-full">
            Practice again
          </Button>
          <Button href="/portal" variant="secondary" size="lg" className="w-full">
            Back to home
          </Button>
        </>
      ) : (
        <>
          <Button href="/portal" size="xl" className="w-full">
            Back to home
          </Button>
          <Button href={practiceHref(skillId)} variant="secondary" size="lg" className="w-full">
            Practice again
          </Button>
        </>
      )}
    </div>
  );
}

function StepTally({ attempt }: { attempt: Attempt }) {
  const counts = new Map<Status, number>();
  for (const step of attempt.steps) {
    const status = step.nurse_status ?? step.status;
    if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const present = STATUS_ORDER.filter((status) => counts.has(status));
  if (present.length === 0) return null;
  return (
    <div className={cn("mt-4 grid gap-2", present.length === 1 ? "grid-cols-1" : present.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
      {present.map((status) => {
        const entry = stepStatusForCaregiver[status];
        return (
          <div key={status} className={cn("rounded-[12px] px-3 py-2.5", toneClass[entry.tone])}>
            <p className="text-xl font-semibold tabular-nums">{counts.get(status)}</p>
            <p className="text-xs font-medium leading-snug">{entry.label}</p>
          </div>
        );
      })}
    </div>
  );
}

function History({ attempt, skillId }: { attempt: Attempt; skillId: string }) {
  // Every attempt at this skill, across its versions (the API lists only the caregiver's own).
  const { data } = useApi<AttemptSummary[]>("/attempts");
  const attempts = (data ?? []).filter((item) => item.skill_slug === attempt.skill_slug);
  if (attempts.length <= 1) return null;
  return (
    <Section title="Your attempts at this skill">
      <Card>
        <ul className="divide-y divide-border">
          {attempts.map((item) => {
            const current = item.id === attempt.id;
            return (
              <li key={item.id}>
                <Link
                  href={resultsHref(skillId, item.id)}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary",
                    current && "bg-secondary",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-navy">{formatDateTime(item.created_at)}</p>
                    {current ? <p className="text-xs text-ink-secondary">You are looking at this one</p> : null}
                  </div>
                  <StateBadge entry={attemptStateForCaregiver[item.review_state]} />
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}

function Processing({ attempt, skillId, onFinished }: { attempt: Attempt; skillId: string; onFinished: () => void }) {
  const { job, failed } = useJob(attempt.job?.id ?? null, onFinished);
  if (failed) return <ProcessingFailed attempt={attempt} skillId={skillId} reason={failed} />;
  return (
    <div className="space-y-5 lg:max-w-3xl">
      <Header attempt={attempt} title="Checking your recording…">
        <p className="text-[15px] leading-relaxed">
          This usually takes a minute or two. The page updates by itself, and you can leave and come back.
        </p>
      </Header>
      <Card className="p-4">
        <JobProgress job={job ?? attempt.job} />
      </Card>
      <Button href="/portal" variant="secondary" size="lg" className="w-full lg:w-auto">
        Back to home
      </Button>
    </div>
  );
}

function ProcessingFailed({ attempt, skillId, reason }: { attempt: Attempt; skillId: string; reason: string | null }) {
  return (
    <div className="space-y-5 lg:max-w-3xl">
      <Header
        attempt={attempt}
        title="We couldn't finish checking this recording"
        actions={<HeadingActions skillId={skillId} practiceFirst />}
      >
        <p className="text-[15px] leading-relaxed">
          This was a problem on our side while processing the video. It is not a result for your attempt. Please
          record the skill again.
        </p>
      </Header>
      {reason ? (
        <Card className="flex gap-3 p-4">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
          <p className="text-sm text-ink">{reason}</p>
        </Card>
      ) : null}
      <Actions skillId={skillId} practiceFirst />
    </div>
  );
}

function Graded({ attempt, skillId }: { attempt: Attempt; skillId: string }) {
  const player = useVideoSegments();
  const playable = attempt.video.available;
  const onPlay = playable ? player.play : undefined;
  const flags = attempt.safety_flags.filter((flag) => flag.counts_toward_score);
  const reviewed = attempt.review_state === "approved" || attempt.review_state === "retraining";
  const steps = [...attempt.steps].sort((a, b) => a.ord - b.ord);

  let title: string;
  let line: ReactNode;
  if (attempt.review_state === "approved") {
    title = "A nurse verified this skill";
    line = `${attempt.reviewer_name || "A nurse"} reviewed your recording${
      attempt.reviewed_at ? ` on ${formatDate(attempt.reviewed_at)}` : ""
    } and verified it. Well done.`;
  } else if (attempt.review_state === "retraining") {
    title = "Your nurse would like you to practice this again";
    line = `That's a normal part of learning. ${
      attempt.nurse_note.trim() ? "Read their note below, then" : "Look over the steps below, then"
    } record again when you feel ready.`;
  } else {
    title = "Your skill assessment is ready";
    line = "It has been sent to a nurse for final review. An AI suggestion is not a certification.";
  }

  return (
    <div className="space-y-6 lg:space-y-5">
      <Header
        attempt={attempt}
        title={title}
        actions={<HeadingActions skillId={skillId} practiceFirst={attempt.review_state === "retraining"} />}
      >
        <p className="text-[15px] leading-relaxed">{line}</p>
      </Header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-5">
        {/* On a laptop this column stays in view, so pressing a time on the right plays where you can see it. */}
        <div className="space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:space-y-5 lg:overflow-y-auto">
          <NurseNote attempt={attempt} />

          {playable ? (
            <VideoFrame video={attempt.video} videoRef={player.ref} label="Your recording" />
          ) : null}

          <Card className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-info" aria-hidden />
              <p className="text-sm font-semibold text-navy">What the automatic check saw</p>
              <Badge tone="info">AI suggestion</Badge>
            </div>
            {attempt.overall_feedback ? (
              <p className="mt-2 text-sm leading-relaxed text-ink">{attempt.overall_feedback}</p>
            ) : null}
            {attempt.skill_match === false ? (
              <p className="mt-3 flex gap-2 rounded-[12px] bg-warning-bg px-3 py-2.5 text-sm text-warning">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  This recording didn&apos;t seem to show {attempt.skill_name.toLowerCase()}.
                  {attempt.skill_match_note ? ` ${attempt.skill_match_note}` : ""}
                </span>
              </p>
            ) : null}
            <StepTally attempt={attempt} />
            {reviewed ? (
              <p className="mt-3 text-xs text-ink-secondary">Your nurse&apos;s decision above is the one that counts.</p>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6 lg:space-y-5">
          <Section
            title="Step by step"
            description={
              steps.some((step) => hasSpan(...stepSpan(step)))
                ? playable
                  ? "Press a time to watch that part of your recording."
                  : "Times show where each step was found in your recording."
                : undefined
            }
          >
            {steps.length === 0 ? (
              <Card className="p-4 text-sm text-ink-secondary">This skill has no steps to show.</Card>
            ) : (
              <Card>
                <ol className="divide-y divide-border">
                  {steps.map((step, index) => (
                    <StepResult
                      key={step.step_id}
                      step={step}
                      number={index + 1}
                      violations={attempt.order_violations}
                      onPlay={onPlay}
                    />
                  ))}
                </ol>
              </Card>
            )}
          </Section>

          <Section title="Safety notes">
            {flags.length === 0 ? (
              <Card className="flex gap-3 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
                <p className="text-sm leading-relaxed text-ink">No safety concerns were noted. Nice work keeping your client safe.</p>
              </Card>
            ) : (
              <Card>
                <p className="px-4 pt-4 text-sm text-ink-secondary">
                  Something to keep in mind next time. Your nurse will look at {flags.length === 1 ? "this" : "these"} too.
                </p>
                <ul className="divide-y divide-border">
                  {flags.map((flag) => (
                    <li key={flag.id} className="flex gap-3 px-4 py-3.5">
                      <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-sm font-semibold text-navy">{flagTitle(flag)}</p>
                        {flag.description ? <p className="text-sm leading-relaxed text-ink">{flag.description}</p> : null}
                        <TimeChip
                          start={flag.start_s}
                          end={flag.end_s}
                          onPlay={onPlay}
                          title={onPlay ? undefined : "When this happened in your recording"}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>

          {attempt.people.length > 0 ? (
            <Section title="Who we saw">
              <Card>
                <ul className="divide-y divide-border">
                  {attempt.people.map((person) => (
                    <li key={person.label} className="flex gap-3 px-4 py-3">
                      <Users className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-navy">
                          {personRole[person.role] ?? person.role}{" "}
                          <span className="font-normal text-ink-secondary">({person.label})</span>
                        </p>
                        {person.description ? <p className="text-sm text-ink-secondary">{person.description}</p> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          ) : null}

          <History attempt={attempt} skillId={skillId} />

          <Actions skillId={skillId} practiceFirst={attempt.review_state === "retraining"} />
        </div>
      </div>
    </div>
  );
}

/** The shape of a result while it loads: a heading, then the recording beside the steps on a laptop. */
export function ResultsSkeleton() {
  return (
    <div className="space-y-4 lg:space-y-5">
      <Skeleton className="h-20 lg:w-1/2" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-5">
        <div className="space-y-4 lg:space-y-5">
          <Skeleton className="aspect-video" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64 lg:h-96" />
      </div>
    </div>
  );
}

/** A caregiver's result for one attempt (GET /attempts/{id}), in every state it can be in. */
export function AssessmentResults({ attemptId, skillId }: { attemptId: string; skillId: string }) {
  const { data: attempt, error, loading, reload } = useApi<Attempt>(`/attempts/${attemptId}`);
  const { reload: reloadSkills } = useCaregiver();
  useTitle(attempt ? `${attempt.skill_name} result` : "Result");

  if (attempt === undefined) {
    if (error) {
      return (
        <div className="space-y-4 py-6">
          <h1 className="text-xl font-semibold text-navy">We couldn&apos;t open this result</h1>
          <ErrorNote message={error} onRetry={reload} />
          <Button href="/portal/skills" variant="secondary" size="lg" className="w-full lg:w-auto">
            Back to my skills
          </Button>
        </div>
      );
    }
    if (loading) return <ResultsSkeleton />;
    return null;
  }

  if (attempt.review_state === "processing") {
    return (
      <Processing
        key={attempt.id}
        attempt={attempt}
        skillId={skillId}
        onFinished={() => {
          reload();
          reloadSkills();
        }}
      />
    );
  }
  if (attempt.review_state === "error") {
    return <ProcessingFailed attempt={attempt} skillId={skillId} reason={attempt.job?.error?.split("\n")[0] ?? null} />;
  }
  return <Graded attempt={attempt} skillId={skillId} />;
}

