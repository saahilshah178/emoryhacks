"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Field, Input, Textarea } from "@/components/ui";
import { TimeChip } from "@/components/media/TimeChip";
import { api, errorMessage } from "@/lib/api";
import { formatClock } from "@/lib/format";
import type { Skill, SkillStep, StepEvals, Video } from "@/lib/types";
import { isTimed, sameList, tenth, toLines, toList } from "./text";

type Draft = {
  title: string;
  description: string;
  critical: boolean;
  start: string;
  end: string;
  mustFollow: string[];
  pass: string;
  fail: string;
  unverified: string;
  cues: string;
};

type StepPatch = Partial<Pick<SkillStep, "title" | "description" | "critical" | "start_s" | "end_s" | "must_follow">> & {
  evals?: StepEvals;
};

function earlierSteps(step: SkillStep, steps: SkillStep[]) {
  return steps.filter((other) => other.ord < step.ord);
}

function fromStep(step: SkillStep, steps: SkillStep[]): Draft {
  const earlier = new Set(earlierSteps(step, steps).map((other) => other.step_id));
  return {
    title: step.title,
    description: step.description,
    critical: step.critical,
    start: tenth(step.start_s),
    end: tenth(step.end_s),
    mustFollow: step.must_follow.filter((id) => earlier.has(id)),
    pass: toLines(step.evals?.pass_criteria),
    fail: toLines(step.evals?.fail_criteria),
    unverified: toLines(step.evals?.unverified_when),
    cues: toLines(step.evals?.visual_cues),
  };
}

function sameDraft(a: Draft, b: Draft) {
  return (
    a.title === b.title &&
    a.description === b.description &&
    a.critical === b.critical &&
    a.start === b.start &&
    a.end === b.end &&
    sameList([...a.mustFollow].sort(), [...b.mustFollow].sort()) &&
    a.pass === b.pass &&
    a.fail === b.fail &&
    a.unverified === b.unverified &&
    a.cues === b.cues
  );
}

/** Only what changed, or a sentence saying what to fix first. */
function buildPatch(step: SkillStep, draft: Draft, original: Draft): { patch: StepPatch } | { error: string } {
  const patch: StepPatch = {};
  const title = draft.title.trim();
  if (!title) return { error: "Give the step a title." };
  if (title !== step.title) patch.title = title;
  const description = draft.description.trim();
  if (description !== step.description) patch.description = description;
  if (draft.critical !== step.critical) patch.critical = draft.critical;

  if (draft.start !== original.start || draft.end !== original.end) {
    const start = Number(draft.start);
    const end = Number(draft.end);
    if (draft.start.trim() === "" || draft.end.trim() === "" || Number.isNaN(start) || Number.isNaN(end)) {
      return { error: "Enter the start and the end in seconds." };
    }
    patch.start_s = start;
    patch.end_s = end;
  }

  if (!sameList([...draft.mustFollow].sort(), [...original.mustFollow].sort())) {
    patch.must_follow = draft.mustFollow;
  }

  const evals: StepEvals = {
    pass_criteria: toList(draft.pass),
    fail_criteria: toList(draft.fail),
    unverified_when: toList(draft.unverified),
    visual_cues: toList(draft.cues),
  };
  const current = step.evals;
  if (
    !sameList(evals.pass_criteria, current?.pass_criteria ?? []) ||
    !sameList(evals.fail_criteria, current?.fail_criteria ?? []) ||
    !sameList(evals.unverified_when, current?.unverified_when ?? []) ||
    !sameList(evals.visual_cues, current?.visual_cues ?? [])
  ) {
    patch.evals = evals;
  }
  return { patch };
}

type Status = { kind: "saved" } | { kind: "error"; message: string } | null;

/** Edit one step and save it on its own. Typed text stays put when a save fails. */
export function StepEditor({
  skillId,
  step,
  steps,
  video,
  onSaved,
  onPlay,
}: {
  skillId: string;
  step: SkillStep;
  steps: SkillStep[];
  video: Video | null;
  onSaved: (skill: Skill) => void;
  onPlay: (start: number, end?: number | null) => void;
}) {
  const original = fromStep(step, steps);
  const [draft, setDraft] = useState<Draft>(original);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const dirty = !sameDraft(draft, original);
  const earlier = earlierSteps(step, steps);
  const id = (name: string) => `step-${step.step_id}-${name}`;

  function change(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
    setStatus(null);
  }

  async function save() {
    const result = buildPatch(step, draft, original);
    if ("error" in result) {
      setStatus({ kind: "error", message: result.error });
      return;
    }
    if (Object.keys(result.patch).length === 0) {
      setDraft(original);
      setStatus({ kind: "saved" });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const updated = await api<Skill>(`/skills/${skillId}/steps/${step.step_id}`, {
        method: "PATCH",
        json: result.patch,
      });
      const fresh = updated.steps.find((other) => other.step_id === step.step_id);
      if (fresh) setDraft(fromStep(fresh, updated.steps));
      onSaved(updated);
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  const draftStart = Number(draft.start);
  const draftEnd = Number(draft.end);
  const draftTimed = draft.start.trim() !== "" && draft.end.trim() !== "" && draftEnd > draftStart && draftStart >= 0;

  return (
    <article className="rounded-[12px] border border-border bg-white p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-navy">
          Step {step.ord}
          {step.critical ? (
            <Badge tone="danger" className="ml-2 align-middle">
              Critical
            </Badge>
          ) : null}
        </h3>
        <label className="inline-flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 accent-teal"
            checked={draft.critical}
            onChange={(event) => change({ critical: event.target.checked })}
          />
          Critical step
        </label>
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <Field label="Title" className="md:col-span-2">
          <Input value={draft.title} onChange={(event) => change({ title: event.target.value })} />
        </Field>
        <Field label="Description" className="md:col-span-2">
          <Textarea
            rows={2}
            value={draft.description}
            onChange={(event) => change({ description: event.target.value })}
          />
        </Field>

        <div className="md:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-ink">Where it happens in the reference video</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block" htmlFor={id("start")}>
              <span className="mb-1 block text-xs text-ink-secondary">Start (seconds)</span>
              <Input
                id={id("start")}
                type="number"
                inputMode="decimal"
                step={0.1}
                min={0}
                className="w-28"
                value={draft.start}
                onChange={(event) => change({ start: event.target.value })}
              />
            </label>
            <label className="block" htmlFor={id("end")}>
              <span className="mb-1 block text-xs text-ink-secondary">End (seconds)</span>
              <Input
                id={id("end")}
                type="number"
                inputMode="decimal"
                step={0.1}
                min={0}
                className="w-28"
                value={draft.end}
                onChange={(event) => change({ end: event.target.value })}
              />
            </label>
            {draftTimed && video?.available ? (
              <TimeChip
                start={draftStart}
                end={draftEnd}
                onPlay={onPlay}
                title="Play these times, then stop"
                className="mb-1.5"
              />
            ) : null}
          </div>
          <p className="mt-1 text-xs text-ink-secondary">
            {isTimed(step)
              ? video
                ? `The reference video is ${formatClock(video.duration_s)} long.`
                : "This skill has no reference video."
              : "This step has no time in the reference video yet. Add a start and an end to save changes to it."}
          </p>
        </div>

        <fieldset className="md:col-span-2">
          <legend className="mb-1.5 text-sm font-medium text-ink">Must come after</legend>
          {earlier.length === 0 ? (
            <p className="text-sm text-ink-secondary">This is the first step, so nothing comes before it.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {earlier.map((other) => (
                <label key={other.step_id} className="inline-flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-teal"
                    checked={draft.mustFollow.includes(other.step_id)}
                    onChange={(event) =>
                      change({
                        mustFollow: event.target.checked
                          ? [...draft.mustFollow, other.step_id]
                          : draft.mustFollow.filter((value) => value !== other.step_id),
                      })
                    }
                  />
                  <span>
                    {other.ord}. {other.title}
                  </span>
                </label>
              ))}
              <p className="text-xs text-ink-secondary">
                Doing this step before a ticked step is flagged as out of order.
              </p>
            </div>
          )}
        </fieldset>

        <Field label="Passes when" hint="One item per line.">
          <Textarea rows={3} value={draft.pass} onChange={(event) => change({ pass: event.target.value })} />
        </Field>
        <Field label="Fails when" hint="One item per line.">
          <Textarea rows={3} value={draft.fail} onChange={(event) => change({ fail: event.target.value })} />
        </Field>
        <Field label="Cannot be verified when" hint="When the camera can't show the step. One per line.">
          <Textarea
            rows={3}
            value={draft.unverified}
            onChange={(event) => change({ unverified: event.target.value })}
          />
        </Field>
        <Field label="What to look for" hint="What shows the step is happening. One per line.">
          <Textarea rows={3} value={draft.cues} onChange={(event) => change({ cues: event.target.value })} />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
        {status?.kind === "error" ? (
          <p role="alert" className="mr-auto text-sm text-danger">
            {status.message}
          </p>
        ) : null}
        {status?.kind === "saved" ? (
          <p role="status" className="mr-auto inline-flex items-center gap-1 text-sm text-success">
            <Check className="h-4 w-4" aria-hidden />
            Saved
          </p>
        ) : null}
        {dirty ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={saving}
            onClick={() => {
              setDraft(original);
              setStatus(null);
            }}
          >
            Undo changes
          </Button>
        ) : null}
        <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
          Save step {step.ord}
        </Button>
      </div>
    </article>
  );
}
