"use client";

import { CircleAlert, HeartHandshake, ShieldCheck, Sparkles, TriangleAlert, Users } from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";
import { Avatar, Badge, Button, Card, ErrorNote, Skeleton, StateBadge } from "@/components/ui";
import { attemptChapters, attemptReferenceChapters, attemptStepSpan } from "@/components/media/chapters";
import { JobProgress } from "@/components/media/JobProgress";
import { StepChapters, useCurrentChapter } from "@/components/media/StepChapters";
import { TimeChip } from "@/components/media/TimeChip";
import { VideoFrame } from "@/components/media/VideoFrame";
import { BackToSkills, PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { StepResult } from "@/caregiver/components/results/StepResult";
import { AttemptHistory, SendPanel } from "@/caregiver/components/results/SendPanel";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { practiceHref } from "@/caregiver/skills";
import { attemptStateForCaregiver, formatScore, readyToSend } from "@/caregiver/status";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime } from "@/lib/format";
import { useApi, useJob, useTitle } from "@/lib/hooks";
import { flagTitle, personRole, stepStatusForCaregiver, toneClass } from "@/lib/status";
import { useVideoSegments } from "@/lib/segment";
import type { Attempt, Status } from "@/lib/types";

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
            <StateBadge
              entry={
                attempt.review_state === "unsubmitted" && attempt.submission.can_submit
                  ? readyToSend
                  : attemptStateForCaregiver[attempt.review_state]
              }
              className="normal-case tracking-normal"
            />
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

/** How the two ways on from a result are offered: which comes first, and whether practice is one. */
type WaysOn = { practiceFirst: boolean; canPractice: boolean };

/**
 * The same two ways on, as the smaller buttons that sit beside a heading on a laptop. quiet:
 * the page has its own main action below (sending, or recording again), so neither stands out.
 */
function HeadingActions({ skillId, practiceFirst, canPractice, quiet = false }: { skillId: string; quiet?: boolean } & WaysOn) {
  const first = practiceFirst && canPractice;
  if (quiet) {
    return (
      <>
        <Button href="/portal" variant="secondary">
          Back to home
        </Button>
        {canPractice ? (
          <Button href={practiceHref(skillId)} variant="secondary">
            Practice again
          </Button>
        ) : null}
      </>
    );
  }
  return (
    <>
      <Button href="/portal" variant={first ? "secondary" : "primary"}>
        Back to home
      </Button>
      {canPractice ? (
        <Button href={practiceHref(skillId)} variant={first ? "primary" : "secondary"}>
          Practice again
        </Button>
      ) : null}
    </>
  );
}

/** The two ways on from a result, as full-width buttons at the end of the page on a phone. */
function Actions({ skillId, practiceFirst, canPractice }: { skillId: string } & WaysOn) {
  const first = practiceFirst && canPractice;
  const practice = canPractice ? (
    <Button href={practiceHref(skillId)} variant={first ? "primary" : "secondary"} size={first ? "xl" : "lg"} className="w-full">
      Practice again
    </Button>
  ) : null;
  const home = (
    <Button href="/portal" variant={first ? "secondary" : "primary"} size={first ? "lg" : "xl"} className="w-full">
      Back to home
    </Button>
  );
  return (
    <div className="flex flex-col gap-3 lg:hidden">
      {first ? practice : home}
      {first ? home : practice}
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
        actions={<HeadingActions skillId={skillId} practiceFirst canPractice />}
      >
        <p className="text-[15px] leading-relaxed">
          This was a problem on our side while processing the video. It is not a result for your attempt, and it did
          not use one of your attempts. Please record the skill again.
        </p>
      </Header>
      {reason ? (
        <Card className="flex gap-3 p-4">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
          <p className="text-sm text-ink">{reason}</p>
        </Card>
      ) : null}
      <Actions skillId={skillId} practiceFirst canPractice />
    </div>
  );
}

function Graded({ attempt, skillId, onSent }: { attempt: Attempt; skillId: string; onSent: (attempt: Attempt) => void }) {
  const player = useVideoSegments();
  const demo = useVideoSegments();
  const playable = attempt.video.available;
  const reference = attempt.reference_video?.available ? attempt.reference_video : null;
  // Only one of the two videos plays at a time: starting a step in one stops the other.
  const playMine = useCallback(
    (start: number, end?: number | null) => {
      demo.video?.pause();
      player.play(start, end);
    },
    [demo.video, player],
  );
  const playDemo = useCallback(
    (start: number, end?: number | null) => {
      player.video?.pause();
      demo.play(start, end);
    },
    [demo, player.video],
  );
  const onPlay = playable ? playMine : undefined;
  const chapters = useMemo(
    () =>
      attemptChapters(attempt.steps, (step) => {
        const status = step.nurse_status ?? step.status;
        return status ? { tone: stepStatusForCaregiver[status].tone, hint: stepStatusForCaregiver[status].label } : null;
      }),
    [attempt.steps],
  );
  const demoChapters = useMemo(() => attemptReferenceChapters(attempt.steps), [attempt.steps]);
  const current = useCurrentChapter(chapters, player.playhead, playMine);
  const flags = attempt.safety_flags.filter((flag) => flag.counts_toward_score);
  const reviewed = attempt.review_state === "approved" || attempt.review_state === "retraining";
  const steps = [...attempt.steps].sort((a, b) => a.ord - b.ord);

  const state = attempt.review_state;
  const canPractice = attempt.attempts.left !== 0;
  // Practice comes first when the nurse asked for it, or when this recording can't be sent as it is.
  const practiceFirst = state === "retraining" || (state === "unsubmitted" && !attempt.submission.can_submit);

  let title: string;
  let line: ReactNode;
  if (state === "approved") {
    title = "A nurse verified this skill";
    line = `${attempt.reviewer_name || "A nurse"} reviewed your recording${
      attempt.reviewed_at ? ` on ${formatDate(attempt.reviewed_at)}` : ""
    } and verified it. Well done.`;
  } else if (state === "retraining") {
    title = "Your nurse would like you to practice this again";
    line = `That's a normal part of learning. ${
      attempt.nurse_note.trim() ? "Read their note below, then" : "Look over the steps below, then"
    } record again when you feel ready.`;
  } else if (state === "pending") {
    title = "Your recording is with your nurse";
    line = "Below is what the automatic check saw. It's a suggestion, not a certification: your nurse makes the final decision.";
  } else if (state === "superseded") {
    title = "This recording was replaced";
    line = "It stays here for you to look back on, with what the automatic check saw.";
  } else if (attempt.submission.can_submit) {
    title = "Your recording is ready to send";
    line = "Look over what the automatic check saw, then send it to your nurse. Only your nurse can verify a skill.";
  } else {
    title = "Your result is ready";
    line = "Look over what the automatic check saw. Your nurse only sees a recording once you send it.";
  }

  return (
    <div className="space-y-6 lg:space-y-5">
      <Header
        attempt={attempt}
        title={title}
        actions={
          <HeadingActions
            skillId={skillId}
            practiceFirst={practiceFirst}
            canPractice={canPractice}
            quiet={state === "unsubmitted" || state === "pending" || state === "superseded"}
          />
        }
      >
        <p className="text-[15px] leading-relaxed">{line}</p>
        {state !== "unsubmitted" && attempt.score_pct !== null ? (
          <p className="mt-1 text-sm text-ink-secondary">
            Automatic check score: <span className="font-semibold tabular-nums text-navy">{formatScore(attempt.score_pct)}</span>
          </p>
        ) : null}
      </Header>

      <SendPanel attempt={attempt} skillId={skillId} onSent={onSent} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start lg:gap-5">
        {/* On a laptop this column stays in view, so pressing a time on the right plays where you can see it. */}
        <div className="space-y-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:space-y-5 lg:overflow-y-auto">
          <NurseNote attempt={attempt} />

          {playable ? (
            <div className="space-y-3">
              <VideoFrame video={attempt.video} videoRef={player.ref} label="Your recording" />
              <Card className="p-4">
                <StepChapters
                  chapters={chapters}
                  duration={attempt.video.duration_s || attempt.duration_s}
                  time={player.playhead}
                  activeId={current.id}
                  onSelect={current.select}
                  label="Steps in your recording"
                  emptyText="The check didn't find the steps in your recording, so there are no times to jump to."
                  missingText="Not seen in your recording"
                />
              </Card>
            </div>
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

          {reference ? (
            <div className="space-y-3">
              <VideoFrame video={reference} videoRef={demo.ref} label="Your nurse's demonstration" />
              <Card className="p-4">
                <StepChapters
                  chapters={demoChapters}
                  duration={reference.duration_s}
                  time={demo.playhead}
                  onPlay={playDemo}
                  label="Steps in the demonstration"
                  emptyText="Your nurse hasn't marked where each step is in the demonstration."
                />
              </Card>
            </div>
          ) : null}
        </div>

        <div className="space-y-6 lg:space-y-5">
          <Section
            title="Step by step"
            description={
              steps.some((step) => attemptStepSpan(step))
                ? playable
                  ? reference
                    ? "Press “Your recording” to watch that part of what you recorded, or “Demonstration” to see the same step done by your nurse."
                    : "Press a time to watch that part of your recording."
                  : "Times show where each step was found in your recording."
                : reference
                  ? "Press “Demonstration” to see a step done by your nurse."
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
                      onPlayDemo={reference ? playDemo : undefined}
                      active={step.step_id === current.id}
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
                  Something to keep in mind next time.{" "}
                  {state === "unsubmitted"
                    ? `If you send this recording, your nurse will see ${flags.length === 1 ? "this" : "these"} too.`
                    : state === "superseded"
                      ? ""
                      : `Your nurse will look at ${flags.length === 1 ? "this" : "these"} too.`}
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

          <AttemptHistory attempt={attempt} />

          <Actions skillId={skillId} practiceFirst={practiceFirst} canPractice={canPractice} />
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
  const { data: attempt, error, status, loading, reload, setData } = useApi<Attempt>(`/attempts/${attemptId}`);
  const { reload: reloadSkills } = useCaregiver();
  useTitle(attempt ? `${attempt.skill_name} result` : "Result");

  if (attempt === undefined) {
    if (error) {
      return (
        <div className="space-y-4 py-6">
          <h1 className="text-xl font-semibold text-navy">We couldn&apos;t open this result</h1>
          {status === 404 ? (
            <ErrorNote message="We couldn't find that recording. The link may be old, or the recording may not be yours." />
          ) : (
            <ErrorNote message={error} onRetry={reload} />
          )}
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
  return (
    <Graded
      attempt={attempt}
      skillId={skillId}
      onSent={(sent) => {
        // The page changes in place to "sent"; the rest of the portal fetches its standing again.
        setData(sent);
        reloadSkills();
      }}
    />
  );
}

