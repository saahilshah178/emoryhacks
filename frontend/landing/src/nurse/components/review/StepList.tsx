"use client";

import { Columns2, ShieldCheck } from "lucide-react";
import { TimeChip } from "@/components/media/TimeChip";
import { Badge, Input, StateBadge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatRange, hasSpan, percent } from "@/lib/format";
import { stepStatus } from "@/lib/status";
import type { Attempt, AttemptStep, Status } from "@/lib/types";
import { nameStepIds, ordinal, stepSpan, violationsFor, type Override, type Overrides } from "./steps";

const CHOICES: Status[] = ["passed", "failed", "unverified"];

/** Every step in rubric order with the AI's reading, where it happened, and the nurse's override. */
export function StepList({
  attempt,
  overrides,
  editing,
  onOverride,
  activeId,
  videoAvailable,
  referenceAvailable,
  onJump,
  onCompare,
  onPlay,
}: {
  attempt: Attempt;
  overrides: Overrides;
  /** True while the decision form is open; the per-step controls show only then. */
  editing: boolean;
  onOverride: (stepId: string, value: Override) => void;
  activeId: string | null;
  videoAvailable: boolean;
  referenceAvailable: boolean;
  /** Select a step (and play it when there is a video). */
  onJump: (step: AttemptStep) => void;
  onCompare: (step: AttemptStep) => void;
  /** Plays a stretch of the attempt video; omitted when there is no video. */
  onPlay?: (start: number, end?: number | null) => void;
}) {
  const steps = [...attempt.steps].sort((a, b) => a.ord - b.ord);
  return (
    <ol className="space-y-3">
      {steps.map((step) => (
        <StepCard
          key={step.step_id}
          step={step}
          attempt={attempt}
          override={overrides[step.step_id]}
          editing={editing}
          onOverride={(value) => onOverride(step.step_id, value)}
          active={step.step_id === activeId}
          videoAvailable={videoAvailable}
          referenceAvailable={referenceAvailable}
          onJump={() => onJump(step)}
          onCompare={() => onCompare(step)}
          onPlay={onPlay}
        />
      ))}
    </ol>
  );
}

function StepCard({
  step,
  attempt,
  override,
  editing,
  onOverride,
  active,
  videoAvailable,
  referenceAvailable,
  onJump,
  onCompare,
  onPlay,
}: {
  step: AttemptStep;
  attempt: Attempt;
  override: Override | undefined;
  editing: boolean;
  onOverride: (value: Override) => void;
  active: boolean;
  videoAvailable: boolean;
  referenceAvailable: boolean;
  onJump: () => void;
  onCompare: () => void;
  onPlay?: (start: number, end?: number | null) => void;
}) {
  const span = stepSpan(step);
  const violations = violationsFor(attempt, step.step_id);
  const nurseStatus = editing ? (override?.status ?? null) : step.nurse_status;
  const ai = step.status ? stepStatus[step.status] : null;
  const evidenceDiffers =
    span &&
    !span.byGrader &&
    hasSpan(step.evidence_start_s, step.evidence_end_s) &&
    (step.evidence_start_s !== span.start || step.evidence_end_s !== span.end);
  const canCompare = referenceAvailable && hasSpan(step.ref_start_s, step.ref_end_s);
  const criteria = step.evals;
  const hasCriteria =
    criteria && (criteria.pass_criteria.length || criteria.fail_criteria.length || criteria.unverified_when.length);

  return (
    <li
      id={`step-${step.step_id}`}
      className={cn(
        "scroll-mt-24 rounded-[12px] border bg-white p-4 transition-colors",
        active ? "border-teal bg-teal-soft/40 shadow-[var(--shadow-card)]" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button
          type="button"
          onClick={onJump}
          aria-current={active ? "step" : undefined}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          title={videoAvailable && span ? "Play this step" : "Select this step"}
        >
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              active ? "bg-teal text-white" : "bg-secondary text-ink",
            )}
          >
            {step.ord}
          </span>
          <span className="min-w-0 pt-0.5 text-sm font-semibold text-ink hover:text-teal">{step.title}</span>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {step.critical ? <Badge tone="danger">Critical</Badge> : null}
          {nurseStatus ? (
            <>
              <StateBadge entry={stepStatus[nurseStatus]} label={`Nurse: ${stepStatus[nurseStatus].label}`} />
              {ai ? (
                <span className="text-xs text-ink-secondary line-through" title="The AI's reading, superseded by the nurse">
                  AI: {ai.label}
                </span>
              ) : null}
            </>
          ) : ai ? (
            <StateBadge entry={ai} label={`AI: ${ai.label}`} />
          ) : (
            <Badge>Not graded</Badge>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 pl-10 text-xs text-ink-secondary">
        {span ? (
          <>
            {span.byGrader ? <span>Not placed by the timeline; seen by the grader at</span> : null}
            <TimeChip start={span.start} end={span.end} onPlay={videoAvailable ? () => onJump() : undefined} />
          </>
        ) : (
          <span className="font-medium text-ink">Not found in the recording</span>
        )}
        {step.performed_index && step.performed_index !== step.ord ? (
          <span>
            Done {ordinal(step.performed_index)}, expected {ordinal(step.ord)}
          </span>
        ) : null}
        {step.confidence !== null ? <span>AI confidence {percent(step.confidence)}</span> : null}
        {step.double_checked ? (
          <span className="inline-flex items-center gap-1 text-info">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Checked twice
          </span>
        ) : null}
        {canCompare ? (
          <button
            type="button"
            onClick={onCompare}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 font-medium text-ink hover:border-teal hover:text-teal"
            title={`Play the reference at ${formatRange(step.ref_start_s, step.ref_end_s)}${videoAvailable && span ? " beside this step" : ""}`}
          >
            <Columns2 className="h-3.5 w-3.5" aria-hidden />
            Compare with reference
          </button>
        ) : null}
      </div>

      <div className="mt-3 space-y-2 pl-10 text-sm">
        {violations.map((v, i) => (
          <p key={i} className="rounded-[10px] bg-warning-bg px-3 py-2 text-warning">
            Out of order: {nameStepIds(v.message, attempt.steps)}
          </p>
        ))}
        {step.feedback ? <p className="text-ink">{step.feedback}</p> : null}
        {step.evidence ? (
          <p className="text-ink-secondary">
            <span className="font-medium text-ink">What was seen: </span>
            {step.evidence}
            {evidenceDiffers ? (
              <>
                {" "}
                <TimeChip
                  start={step.evidence_start_s}
                  end={step.evidence_end_s}
                  onPlay={onPlay}
                  className="h-6 align-middle"
                />
              </>
            ) : null}
          </p>
        ) : null}
        {!span && step.timeline_note ? (
          <p className="text-xs text-ink-secondary">Timeline: {nameStepIds(step.timeline_note, attempt.steps)}</p>
        ) : null}
        {!editing && step.nurse_note ? (
          <p className="text-ink-secondary">
            <span className="font-medium text-ink">Nurse note: </span>
            {step.nurse_note}
          </p>
        ) : null}

        {hasCriteria ? (
          <details className="group rounded-[10px] border border-border bg-page px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-secondary hover:text-ink">Criteria</summary>
            <div className="mt-2 grid gap-3 text-xs md:grid-cols-3">
              <CriteriaList title="Passes when" items={criteria.pass_criteria} />
              <CriteriaList title="Fails when" items={criteria.fail_criteria} />
              <CriteriaList title="Can't be verified when" items={criteria.unverified_when} />
            </div>
          </details>
        ) : null}

        {editing ? (
          <fieldset className="mt-1 flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-border px-3 py-2">
            <legend className="sr-only">Your reading of step {step.ord}</legend>
            <span className="text-xs font-medium text-ink-secondary">Your reading</span>
            <div className="flex gap-1" role="group" aria-label={`Your reading of step ${step.ord}`}>
              {CHOICES.map((choice) => {
                const on = override?.status === choice;
                const tone = stepStatus[choice].tone;
                return (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onOverride({ status: on ? null : choice, note: override?.note ?? "" })}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-xs font-medium transition-colors",
                      on
                        ? tone === "success"
                          ? "border-success bg-success-bg text-success"
                          : tone === "danger"
                            ? "border-danger bg-danger-bg text-danger"
                            : "border-warning bg-warning-bg text-warning"
                        : "border-border bg-white text-ink-secondary hover:bg-secondary",
                    )}
                  >
                    {stepStatus[choice].label}
                  </button>
                );
              })}
            </div>
            <Input
              value={override?.note ?? ""}
              onChange={(event) => onOverride({ status: override?.status ?? null, note: event.target.value })}
              placeholder="Note for this step (optional)"
              aria-label={`Note for step ${step.ord}`}
              className="h-8 min-w-0 flex-1 basis-48 text-xs"
            />
          </fieldset>
        ) : null}
      </div>
    </li>
  );
}

function CriteriaList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="font-medium text-ink">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-secondary">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
