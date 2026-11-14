"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { formatRange, hasSpan } from "@/lib/format";
import { useVideoSegments } from "@/lib/segment";
import type { Attempt, AttemptStep } from "@/lib/types";
import { MovementPanel } from "./MovementPanel";
import { PeoplePanel } from "./PeoplePanel";
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

  const available = attempt.video.available;
  const referenceAvailable = Boolean(attempt.reference_video?.available);
  const editing = attempt.review_state === "pending" || reopened;
  const located = locatedSteps(attempt.steps);
  const duration =
    attempt.video.duration_s || attempt.duration_s || Math.max(1, ...located.map(({ span }) => span.end));

  // The current step: the one last selected while the playhead is still in it (or always,
  // with no video to follow), otherwise the one under the playhead.
  const selectedStep = selected ? (attempt.steps.find((s) => s.step_id === selected) ?? null) : null;
  let activeId: string | null = selected;
  if (available) {
    const span = selectedStep ? stepSpan(selectedStep) : null;
    const t = player.time;
    const inSelected = selectedStep && (!span || (t >= span.start - 0.5 && t < span.end + 0.3));
    activeId = inSelected ? selected : (stepAt(attempt.steps, t)?.step_id ?? null);
  }

  function jump(step: AttemptStep) {
    setSelected(step.step_id);
    const span = stepSpan(step);
    if (available && span) {
      player.play(span.start, span.end);
    } else {
      document.getElementById(`step-${step.step_id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function compare(step: AttemptStep) {
    if (!hasSpan(step.ref_start_s, step.ref_end_s)) return;
    setSelected(step.step_id);
    const span = stepSpan(step);
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
      <div className="flex items-start gap-3 rounded-[12px] border border-info/20 bg-info-bg px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">AI recommendation — not a certification</p>
          <p className="mt-1 text-sm text-ink-secondary">
            {attempt.overall_feedback || "The AI did not write a summary for this attempt."}
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
        timeline={
          <>
            <StepTimeline
              steps={attempt.steps}
              overrides={editing ? overrides : {}}
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

        <aside className="xl:sticky xl:top-20">
          <div className="rounded-[12px] border border-border bg-white p-4 shadow-[var(--shadow-card)]">
            <h3 className="text-base font-semibold text-navy">Nurse decision</h3>
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
                  setOverrides(initialOverrides(attempt.steps));
                }}
                changedSteps={changed}
              />
            </div>
          </div>
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
