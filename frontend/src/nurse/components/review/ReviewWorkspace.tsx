"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, EyeOff, History, Info } from "lucide-react";
import { attemptReferenceChapters } from "@/components/media/chapters";
import { StepChapters } from "@/components/media/StepChapters";
import { formatRange, hasSpan } from "@/lib/format";
import { useVideoSegments } from "@/lib/segment";
import type { Attempt, AttemptStep } from "@/lib/types";
import { MovementPanel } from "./MovementPanel";
import { PeoplePanel } from "./PeoplePanel";
import { newestSubmission, PracticeRunNotice, SentAnywayBanner, SupersededNotice } from "./RecordingNotices";
import { RecordingHistory } from "./RecordingHistory";
import { ReviewActions } from "./ReviewActions";
import { SafetyPanel } from "./SafetyPanel";
import { StepList } from "./StepList";
import { StepTimeline } from "./StepTimeline";
import { VideoComparison } from "./VideoComparison";
import { changedSteps, initialOverrides, locatedSteps, stepAt, stepSpan, type Override, type Overrides } from "./steps";

/** The full review of a graded attempt. Mounted with key={attempt.id}. */
export function ReviewWorkspace({ attempt }: { attempt: Attempt }) {
  const player = useVideoSegments();
  const reference = useVideoSegments();
  const [overrides, setOverrides] = useState<Overrides>(() => initialOverrides(attempt.steps));
  const [reopened, setReopened] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  // A replaced recording can still be decided on, but only after the nurse says so.
  const [decideReplaced, setDecideReplaced] = useState(false);

  const available = attempt.video.available;
  const referenceAvailable = Boolean(attempt.reference_video?.available);
  const practice = attempt.review_state === "unsubmitted";
  const replaced = attempt.review_state === "superseded";
  const editing = attempt.review_state === "pending" || reopened || (replaced && decideReplaced);
  const newest = replaced ? newestSubmission(attempt) : null;
  // A step the nurse marks "Not needed" loses its place in the video straight away.
  const drafts = editing ? overrides : {};
  const located = locatedSteps(attempt.steps, drafts);
  const referenceChapters = useMemo(() => attemptReferenceChapters(attempt.steps), [attempt.steps]);
  const duration =
    attempt.video.duration_s || attempt.duration_s || Math.max(1, ...located.map(({ span }) => span.end));

  // The current step: the one last selected while the playhead is still in it (or always,
  // with no video to follow), otherwise the one under the playhead.
  const selectedStep = selected ? (attempt.steps.find((s) => s.step_id === selected) ?? null) : null;
  let activeId: string | null = selected;
  if (available) {
    const span = selectedStep ? stepSpan(selectedStep, drafts[selectedStep.step_id]) : null;
    const t = player.time;
    const inSelected = selectedStep && (!span || (t >= span.start - 0.5 && t < span.end + 0.3));
    activeId = inSelected ? selected : (stepAt(attempt.steps, t, drafts)?.step_id ?? null);
  }

  function jump(step: AttemptStep) {
    setSelected(step.step_id);
    const span = stepSpan(step, drafts[step.step_id]);
    if (available && span) {
      player.play(span.start, span.end);
    } else {
      document.getElementById(`step-${step.step_id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function compare(step: AttemptStep) {
    if (!hasSpan(step.ref_start_s, step.ref_end_s)) return;
    setSelected(step.step_id);
    const span = stepSpan(step, drafts[step.step_id]);
    if (available && span) player.play(span.start, span.end);
    reference.play(step.ref_start_s, step.ref_end_s);
    setComparing(`Step ${step.ord}, ${formatRange(step.ref_start_s, step.ref_end_s)}`);
  }

  function move(direction: 1 | -1) {
    const list = located.map(({ step }) => step);
    if (!list.length) return;
    const index = list.findIndex((s) => s.step_id === activeId);
    let target: AttemptStep | undefined;
    if (index !== -1) {
      target = list[index + direction];
    } else if (available) {
      const t = player.time;
      target =
        direction > 0
          ? located.find(({ span }) => span.start > t + 0.3)?.step
          : [...located].reverse().find(({ span }) => span.start < t - 1)?.step;
    } else {
      target = direction > 0 ? list[0] : list[list.length - 1];
    }
    if (target) jump(target);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "j" && event.key !== "k") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      move(event.key === "j" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function setOverride(stepId: string, value: Override) {
    setOverrides((previous) => ({ ...previous, [stepId]: value }));
  }

  const changed = changedSteps(attempt.steps, overrides);

  return (
    <div className="space-y-5">
      <PracticeRunNotice attempt={attempt} />
      <SupersededNotice attempt={attempt} />
      <SentAnywayBanner attempt={attempt} />

      <div className="flex items-start gap-3 rounded-[12px] border border-info/20 bg-info-bg px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">AI recommendation — not a certification</p>
          {/* The summary is written to the caregiver ("You..."), so say whose words these are. */}
          <p className="mt-1 text-sm text-ink-secondary">
            {attempt.overall_feedback ? (
              <>
                <span className="font-medium text-ink">What the caregiver was told: </span>
                {attempt.overall_feedback}
              </>
            ) : (
              "The AI did not write a summary for this attempt."
            )}
          </p>
          {attempt.reasons.length ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-secondary">
              {attempt.reasons.map((reason, i) => (
                <li key={i}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      {attempt.skill_match === false ? (
        <div role="alert" className="flex items-start gap-3 rounded-[12px] border border-danger/20 bg-danger-bg px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <div>
            <p className="text-sm font-semibold text-danger">This recording may not show {attempt.skill_name}</p>
            <p className="mt-1 text-sm text-ink-secondary">
              {attempt.skill_match_note || "The AI judged that the recording shows a different task."} Check the video
              before deciding.
            </p>
          </div>
        </div>
      ) : null}

      <VideoComparison
        video={attempt.video}
        videoRef={player.ref}
        time={player.time}
        reference={attempt.reference_video}
        referenceRef={reference.ref}
        referenceCaption={comparing}
        referenceTimeline={
          attempt.reference_video ? (
            <StepChapters
              chapters={referenceChapters}
              duration={attempt.reference_video.duration_s}
              time={reference.playhead}
              onSelect={(chapter) => {
                // The caption names a step chosen with "Compare"; the bar names its own.
                setComparing(null);
                reference.play(Number(chapter.start), chapter.end);
              }}
              label="Steps in the approved reference"
              emptyText="The steps have no times in the reference video."
              missingText="No time in the reference"
            />
          ) : null
        }
        timeline={
          <>
            <StepTimeline
              steps={attempt.steps}
              overrides={drafts}
              flags={attempt.safety_flags}
              duration={duration}
              activeId={activeId}
              playhead={available ? player.time : null}
              onSelect={jump}
              onPlayFlag={available ? player.play : undefined}
            />
            <p className="mt-3 border-t border-border pt-3 text-xs text-ink-secondary">
              {available
                ? "Click a step to play it; the video stops at the end of the step. Keyboard: j next step, k previous step."
                : "There is no recording to play, so times are shown as labels. Click a step to highlight it below. Keyboard: j next step, k previous step."}
            </p>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] xl:items-start">
        <div className="min-w-0 space-y-6">
          <SafetyPanel flags={attempt.safety_flags} people={attempt.people} onPlay={available ? player.play : undefined} />

          <section>
            <h3 className="text-base font-semibold text-navy">Steps</h3>
            <p className="mt-1 text-sm text-ink-secondary">
              {editing
                ? "Status is the AI reading — you still decide. Change a step's reading if you see it differently."
                : "Status is the AI reading unless a nurse changed it."}
              {attempt.order_matters ? " Order matters for this skill." : ""}
            </p>
            <div className="mt-3">
              <StepList
                attempt={attempt}
                overrides={overrides}
                editing={editing}
                onOverride={setOverride}
                activeId={activeId}
                videoAvailable={available}
                referenceAvailable={referenceAvailable}
                onJump={jump}
                onCompare={compare}
                onPlay={available ? player.play : undefined}
              />
            </div>
          </section>

          <section>
            <h3 className="text-base font-semibold text-navy">People identified</h3>
            <p className="mt-1 text-sm text-ink-secondary">Who the AI saw in the recording, and in what role.</p>
            <div className="mt-3">
              <PeoplePanel people={attempt.people} />
            </div>
          </section>
        </div>

        {/* Sticks beside the steps on a wide screen, scrolling on its own if it is taller than the window. */}
        <aside className="space-y-5 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-y-auto xl:overscroll-contain">
          <div className="rounded-[12px] border border-border bg-white p-4 shadow-[var(--shadow-card)]">
            <h3 className="text-base font-semibold text-navy">Nurse decision</h3>
            {practice ? (
              <div className="mt-3 flex items-start gap-2 text-sm text-ink-secondary">
                <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <p>
                  Not sent to you, so there is nothing to decide. If the caregiver sends it, it appears in pending
                  reviews.
                </p>
              </div>
            ) : replaced && !decideReplaced ? (
              <div className="mt-3 space-y-3 text-sm">
                <div className="flex items-start gap-2 text-ink-secondary">
                  <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <p>Replaced by a newer recording. Decide on the newest one, unless you mean to decide on this one.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {newest ? (
                    <Link
                      href={`/dashboard/reviews/${newest.id}`}
                      className="inline-flex h-10 items-center rounded-[12px] bg-teal px-4 text-sm font-semibold text-white hover:bg-teal-hover"
                    >
                      Open the newest
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDecideReplaced(true)}
                    className="h-10 rounded-[12px] px-3 text-sm font-medium text-ink-secondary hover:bg-secondary hover:text-ink"
                  >
                    Decide on this one anyway
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink-secondary">
                  Only a registered nurse can approve this skill for independent work.
                </p>
                <div className="mt-4">
                  <ReviewActions
                    attempt={attempt}
                    editing={editing}
                    onEdit={() => setReopened(true)}
                    onCancel={() => {
                      setReopened(false);
                      setDecideReplaced(false);
                      setOverrides(initialOverrides(attempt.steps));
                    }}
                    changedSteps={changed}
                  />
                </div>
              </>
            )}
          </div>
          <RecordingHistory attempt={attempt} />
        </aside>
      </div>

      <section>
        <h3 className="text-base font-semibold text-navy">Movement and balance</h3>
        <p className="mt-1 text-sm text-ink-secondary">
          Measured by body tracking on this recording. These readings guide your review; nobody has confirmed them on
          video.
        </p>
        <div className="mt-3">
          <MovementPanel
            videoId={attempt.video_id}
            duration={duration}
            notes={attempt.extras?.movement}
            playhead={available ? player.time : null}
            onSeek={available ? player.seek : undefined}
          />
        </div>
      </section>
    </div>
  );
}
