"use client";

import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui";
import { TimeChip } from "@/components/media/TimeChip";
import { thumbUrl } from "@/lib/api";
import { cn } from "@/lib/cn";
import { onlyNeededWhen } from "@/lib/steps";
import type { SkillStep, StepEvals, Video } from "@/lib/types";
import { SkillThumb } from "./SkillThumb";
import { isTimed, stepFrameTime } from "./text";

const criteria: Array<{ key: keyof StepEvals; label: string; tone: string }> = [
  { key: "pass_criteria", label: "Passes when", tone: "text-success" },
  { key: "fail_criteria", label: "Fails when", tone: "text-danger" },
  { key: "unverified_when", label: "Cannot be verified when", tone: "text-warning" },
  { key: "visual_cues", label: "What to look for", tone: "text-ink-secondary" },
];

/** A step as caregivers are checked against it: where it is in the reference and its criteria. */
export function StepCard({
  step,
  steps,
  video,
  active,
  open,
  onToggle,
  onPlay,
}: {
  step: SkillStep;
  steps: SkillStep[];
  video: Video | null;
  /** The playhead is inside this step. */
  active: boolean;
  open: boolean;
  onToggle: () => void;
  onPlay: (start: number, end?: number | null) => void;
}) {
  const timed = isTimed(step);
  const playable = timed && Boolean(video?.available);
  const after = step.must_follow
    .map((id) => steps.find((other) => other.step_id === id))
    .filter((other): other is SkillStep => Boolean(other));
  const panelId = `criteria-${step.step_id}`;
  const condition = onlyNeededWhen(step);

  return (
    <article
      data-step-id={step.step_id}
      aria-current={active ? "step" : undefined}
      className={cn(
        "rounded-[12px] border bg-white p-4 shadow-[var(--shadow-card)] transition-colors",
        active ? "border-teal ring-1 ring-teal" : "border-border",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row">
        {timed && video ? (
          playable ? (
            <button
              type="button"
              onClick={() => onPlay(step.start_s, step.end_s)}
              aria-label={`Play step ${step.ord}`}
              className="w-full shrink-0 overflow-hidden rounded-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal sm:w-44"
            >
              <SkillThumb src={thumbUrl(video.id, stepFrameTime(step))} />
            </button>
          ) : (
            <SkillThumb src={null} className="w-full shrink-0 rounded-[10px] sm:w-44" />
          )
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-base font-semibold text-navy">
              <span className="mr-1.5 text-ink-secondary">{step.ord}.</span>
              {step.title}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {step.critical ? <Badge tone="danger">Critical</Badge> : null}
              {timed ? (
                <TimeChip start={step.start_s} end={step.end_s} onPlay={video?.available ? onPlay : undefined} />
              ) : null}
            </div>
          </div>
          {step.description ? <p className="mt-1 text-sm text-ink-secondary">{step.description}</p> : null}
          {condition ? <p className="mt-2 text-xs text-ink-secondary">{condition}</p> : null}
          {after.length > 0 ? (
            <p className="mt-2 text-xs text-ink-secondary">
              <span className="font-medium text-ink">Must come after:</span>{" "}
              {after.map((other) => `${other.ord}. ${other.title}`).join(", ")}
            </p>
          ) : null}

          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-teal hover:underline"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
            {open ? "Hide criteria" : "Show criteria"}
          </button>
        </div>
      </div>

      {open ? (
        <div id={panelId} className="mt-3 grid gap-3 border-t border-border pt-3 md:grid-cols-2">
          {criteria.map(({ key, label, tone }) => {
            const items = step.evals?.[key] ?? [];
            return (
              <div key={key} className="rounded-[10px] bg-page p-3">
                <h4 className={cn("text-xs font-semibold uppercase tracking-wide", tone)}>{label}</h4>
                {items.length ? (
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-ink">
                    {items.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-sm text-ink-secondary">None written.</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
