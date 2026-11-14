"use client";

import Link from "next/link";
import { Check, ChevronDown, ChevronUp, Repeat2, Send, Users } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar, Badge, Button, Card, ErrorNote, Skeleton, StateBadge } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { skillState } from "@/lib/status";
import type { Skill, SkillPolicyUpdate, SkillPolicyView } from "@/lib/types";
import { CaregiverLimitControls } from "@/nurse/components/attempts/CaregiverLimitControls";
import { NumberStepper } from "@/nurse/components/attempts/NumberStepper";
import {
  attemptsEach,
  leftText,
  leftTone,
  MAX_ATTEMPTS,
  MIN_ATTEMPTS,
  parseCount,
  parsePercent,
  pct,
  usedOfAllowed,
} from "@/nurse/components/attempts/words";
import { useDashboard } from "@/nurse/context/DashboardContext";

export const ATTEMPTS_ANCHOR = "attempts";

/**
 * "Attempts and sending" on a skill's page: how many attempts each caregiver gets, the
 * scores needed to send a recording (and to send it anyway with a note), who the skill is
 * assigned to, and where each caregiver stands. A summary line until the nurse opens it.
 */
export function AttemptsSection({ skill }: { skill: Skill }) {
  const policy = useApi<SkillPolicyView>(`/skills/${skill.id}/policy`);
  // Opened from a link to #attempts, it starts open.
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.location.hash === `#${ATTEMPTS_ANCHOR}`);
  const ref = useRef<HTMLElement>(null);
  const loaded = policy.data !== undefined;

  useEffect(() => {
    if (loaded && window.location.hash === `#${ATTEMPTS_ANCHOR}`) ref.current?.scrollIntoView({ block: "start" });
  }, [loaded]);

  // A link to #attempts followed on this same page opens it too.
  useEffect(() => {
    function onHash() {
      if (window.location.hash === `#${ATTEMPTS_ANCHOR}`) setOpen(true);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const view = policy.data;
  const assigned = view?.caregivers.filter((person) => person.assigned) ?? [];
  const outOf = assigned.filter((person) => person.attempts_left === 0);

  return (
    <section ref={ref} id={ATTEMPTS_ANCHOR} aria-labelledby="attempts-title" className="scroll-mt-20">
      <Card>
        {/* The description sits under the title and button row, so on a phone it keeps the card's full width. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-5 pb-4 pt-5">
          <h2 id="attempts-title" className="self-center text-base font-semibold text-navy">
            Attempts and sending
          </h2>
          <Button
            variant={open ? "ghost" : "secondary"}
            size="sm"
            aria-expanded={open}
            aria-controls="attempts-panel"
            onClick={() => setOpen((value) => !value)}
            className="shrink-0"
          >
            {open ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
            {open ? "Close" : "Change"}
          </Button>
          <p className="col-span-2 mt-1 max-w-3xl text-sm text-ink-secondary">
            How many times caregivers can record {skill.name}, the score they need to send a recording to you, and who
            has the skill. These apply to every version of it.
          </p>
        </div>

        {view ? (
          <div className="border-t border-border px-5 py-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <Fact icon={<Repeat2 className="h-4 w-4" />} label="Attempts allowed">
                {view.max_attempts === null ? "Unlimited" : `${view.max_attempts} each`}
              </Fact>
              <Fact icon={<Send className="h-4 w-4" />} label="Score needed to send">
                {pct(view.submit_pct)}
              </Fact>
              <Fact icon={<Send className="h-4 w-4" />} label="Send anyway, with a note">
                From {pct(view.force_pct)}
              </Fact>
              <Fact icon={<Users className="h-4 w-4" />} label="Assigned to">
                {view.assign_all
                  ? "Every caregiver"
                  : assigned.length === 0
                    ? "Nobody yet"
                    : plural(assigned.length, "caregiver")}
              </Fact>
            </dl>
            {outOf.length > 0 && !open ? (
              <p className="mt-3 text-sm text-danger">
                {outOf.length === 1
                  ? `${outOf[0].name} has used every attempt.`
                  : `${plural(outOf.length, "caregiver")} have used every attempt.`}{" "}
                <button type="button" className="font-medium text-teal hover:underline" onClick={() => setOpen(true)}>
                  Give more
                </button>
              </p>
            ) : null}
          </div>
        ) : policy.error ? (
          <div className="border-t border-border px-5 py-4">
            <ErrorNote message={`The attempts and sending rules could not be loaded. ${policy.error}`} onRetry={policy.reload} />
          </div>
        ) : (
          <div className="border-t border-border px-5 py-4">
            <Skeleton className="h-10" />
          </div>
        )}

        {open && view ? (
          <div id="attempts-panel" className="grid gap-6 border-t border-border px-5 py-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <RulesForm key={view.skill_id} skill={skill} view={view} onSaved={policy.setData} />
            <CaregiverStanding skill={skill} view={view} onChanged={policy.reload} />
          </div>
        ) : null}
      </Card>
    </section>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0 text-teal" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-xs text-ink-secondary">{label}</dt>
        <dd className="font-semibold text-ink">{children}</dd>
      </div>
    </div>
  );
}

type Draft = {
  unlimited: boolean;
  max: string;
  submit: string;
  force: string;
  assignAll: boolean;
  picked: string[];
};

function draftFrom(view: SkillPolicyView): Draft {
  return {
    unlimited: view.max_attempts === null,
    max: String(view.max_attempts ?? 3),
    submit: String(view.submit_pct),
    force: String(view.force_pct),
    assignAll: view.assign_all,
    picked: view.caregivers.filter((person) => person.assigned).map((person) => person.id),
  };
}

function sameDraft(a: Draft, b: Draft) {
  return (
    a.unlimited === b.unlimited &&
    (a.unlimited || Number(a.max) === Number(b.max)) &&
    Number(a.submit) === Number(b.submit) &&
    Number(a.force) === Number(b.force) &&
    a.assignAll === b.assignAll &&
    (a.assignAll || [...a.picked].sort().join() === [...b.picked].sort().join())
  );
}

/** The skill's own rules, saved together. */
function RulesForm({
  skill,
  view,
  onSaved,
}: {
  skill: Skill;
  view: SkillPolicyView;
  onSaved: (next: SkillPolicyView) => void;
}) {
  const { reloadOverview, showFlash } = useDashboard();
  const [saved, setSaved] = useState<Draft>(() => draftFrom(view));
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const max = parseCount(draft.max);
  const submit = parsePercent(draft.submit);
  const force = parsePercent(draft.force);
  const maxError = !draft.unlimited && max === null ? `Choose a number from ${MIN_ATTEMPTS} to ${MAX_ATTEMPTS}.` : null;
  const submitError = submit === null ? "Enter a score from 0% to 100%." : null;
  const forceError =
    force === null
      ? "Enter a score from 0% to 100%."
      : submit !== null && force > submit
        ? `This can't be higher than the score needed to send (${pct(submit)}). Lower it, or raise that one.`
        : null;
  const invalid = Boolean(maxError || submitError || forceError);
  const dirty = !sameDraft(draft, saved);
  const everyone = view.caregivers.map((person) => person.id);
  const allSelected = everyone.length > 0 && (draft.assignAll || everyone.every((id) => draft.picked.includes(id)));
  // With no caregivers yet, a skill for everyone is still for everyone who joins.
  const nobody = !draft.assignAll && !allSelected && draft.picked.length === 0;

  function change(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setConfirmed(false);
    setError(null);
  }

  async function save() {
    if (invalid || submit === null || force === null) return;
    setSaving(true);
    setError(null);
    const body: SkillPolicyUpdate = {
      max_attempts: draft.unlimited ? null : max,
      submit_pct: submit,
      force_pct: force,
      assign_all: draft.assignAll,
      ...(draft.assignAll ? {} : { assigned_ids: draft.picked }),
    };
    try {
      const next = await api<SkillPolicyView>(`/skills/${skill.id}/policy`, { method: "PUT", json: body });
      const fresh = draftFrom(next);
      setSaved(fresh);
      setDraft(fresh);
      setConfirmed(true);
      onSaved(next);
      reloadOverview();
      showFlash({ tone: "success", message: `Saved the attempts and sending rules for ${skill.name}.` });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="min-w-0 space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Attempts allowed</legend>
        <p className="mt-1 text-xs text-ink-secondary">
          Every recording that gets graded uses one, whether or not the caregiver sends it to you. A recording that
          could not be processed does not count. When you ask for retraining, the caregiver gets a fresh set.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Segmented
            label="Attempts allowed"
            value={draft.unlimited ? "unlimited" : "number"}
            options={[
              { value: "unlimited", label: "Unlimited" },
              { value: "number", label: "A set number" },
            ]}
            onChange={(value) => change({ unlimited: value === "unlimited" })}
          />
          {draft.unlimited ? null : (
            <span className="inline-flex items-center gap-2 text-sm text-ink">
              <NumberStepper
                value={draft.max}
                onChange={(value) => change({ max: value })}
                min={MIN_ATTEMPTS}
                max={MAX_ATTEMPTS}
                label="Attempts each caregiver gets"
                invalid={Boolean(maxError)}
              />
              {max === 1 ? "attempt each" : "attempts each"}
            </span>
          )}
        </div>
        {maxError ? <p className="mt-2 text-xs text-danger">{maxError}</p> : null}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Scores for sending a recording to you</legend>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="submit-pct" className="block text-sm font-medium text-ink">
              Score needed to send
            </label>
            <div className="mt-1.5">
              <NumberStepper
                id="submit-pct"
                value={draft.submit}
                onChange={(value) => change({ submit: value })}
                min={0}
                max={100}
                step={5}
                suffix="%"
                label="Score needed to send"
                invalid={Boolean(submitError)}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-secondary">
              At this score or above, a caregiver can send a recording to you.
            </p>
            {submitError ? <p className="mt-1 text-xs text-danger">{submitError}</p> : null}
          </div>
          <div>
            <label htmlFor="force-pct" className="block text-sm font-medium text-ink">
              Score needed to send anyway
            </label>
            <div className="mt-1.5">
              <NumberStepper
                id="force-pct"
                value={draft.force}
                onChange={(value) => change({ force: value })}
                min={0}
                max={100}
                step={5}
                suffix="%"
                label="Score needed to send anyway"
                invalid={Boolean(forceError)}
              />
            </div>
            <p className="mt-1.5 text-xs text-ink-secondary">
              From here up to the score above, they can still send it with a note saying why the automatic check got
              it wrong. Below it, they record again.
            </p>
            {forceError ? <p className="mt-1 text-xs text-danger">{forceError}</p> : null}
          </div>
        </div>
        {submit !== null && force !== null && force <= submit ? <ScoreScale submit={submit} force={force} /> : null}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-ink">Assigned to</legend>
        <p className="mt-1 text-xs text-ink-secondary">
          Pick the caregivers who should have this skill. Assign all selects every caregiver. Click it again when everyone
          is already selected to clear the list.
        </p>
        {view.caregivers.length > 0 ? (
          <div className="mt-3">
            <Button
              type="button"
              size="sm"
              variant={allSelected ? "primary" : "secondary"}
              aria-pressed={allSelected}
              onClick={() => {
                const ids = view.caregivers.map((person) => person.id);
                change(allSelected ? { assignAll: false, picked: [] } : { assignAll: true, picked: ids });
              }}
            >
              Assign all
            </Button>
          </div>
        ) : null}
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-[12px] border border-border">
          {view.caregivers.map((person) => {
            const checked = draft.assignAll || draft.picked.includes(person.id);
            return (
              <li key={person.id}>
                <label className="flex cursor-pointer items-center gap-3 bg-white px-3 py-2.5 text-sm hover:bg-page">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal"
                    checked={checked}
                    onChange={() => {
                      const ids = view.caregivers.map((item) => item.id);
                      const selected = new Set(draft.assignAll ? ids : draft.picked);
                      if (selected.has(person.id)) selected.delete(person.id);
                      else selected.add(person.id);
                      const picked = ids.filter((id) => selected.has(id));
                      change({ assignAll: picked.length === ids.length && ids.length > 0, picked });
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{person.name}</span>
                    {person.title ? <span className="block truncate text-xs text-ink-secondary">{person.title}</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
          {view.caregivers.length === 0 ? (
            <li className="px-3 py-3 text-sm text-ink-secondary">Your agency has no caregivers yet.</li>
          ) : null}
        </ul>
        {nobody ? (
          <p className="mt-2 text-xs text-warning">Nobody is picked, so no caregiver will see this skill.</p>
        ) : null}
      </fieldset>

      {error ? <ErrorNote message={error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={saving} disabled={!dirty || invalid}>
          Save
        </Button>
        {dirty ? (
          <Button variant="ghost" disabled={saving} onClick={() => change(saved)}>
            Undo changes
          </Button>
        ) : null}
        {confirmed && !dirty ? (
          <p role="status" className="flex items-center gap-1.5 text-sm text-success">
            <Check className="h-4 w-4" aria-hidden />
            Saved for every version of {skill.name}.
          </p>
        ) : dirty ? (
          <p className="text-sm text-ink-secondary">{invalid ? "Fix the marked field to save." : "Not saved yet."}</p>
        ) : null}
      </div>
    </form>
  );
}

/** A bar from 0 to 100% showing what each score lets a caregiver do. */
function ScoreScale({ submit, force }: { submit: number; force: number }) {
  return (
    <div className="mt-4" aria-hidden>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-secondary">
        <span className="h-full bg-danger/50" style={{ width: `${force}%` }} />
        <span className="h-full bg-warning/70" style={{ width: `${submit - force}%` }} />
        <span className="h-full bg-success/70" style={{ width: `${100 - submit}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-danger/50" />
          {force > 0 ? `Under ${pct(force)}: record again` : "No score is too low to send anyway"}
        </span>
        {submit > force ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-warning/70" />
            {pct(force)} to {pct(submit)}: send anyway with a note
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success/70" />
          {pct(submit)} and up: send
        </span>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-[12px] border border-border bg-white p-1">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-8 rounded-[10px] px-3 text-sm font-medium transition-colors",
              selected ? "bg-teal text-white" : "text-ink-secondary hover:bg-secondary hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Every caregiver: where they stand, attempts used of allowed, and their own limit. */
function CaregiverStanding({
  skill,
  view,
  onChanged,
}: {
  skill: Skill;
  view: SkillPolicyView;
  onChanged: () => void;
}) {
  const people = [...view.caregivers].sort((a, b) => Number(b.assigned) - Number(a.assigned));
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-semibold text-ink">Where each caregiver stands</h3>
      <p className="mt-1 text-xs text-ink-secondary">
        Give one caregiver their own number on this skill, unlimited attempts, or more when they run out. A number for
        every skill they have is set on their page.
      </p>
      {people.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">Your agency has no caregivers yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-[12px] border border-border">
          <li
            aria-hidden
            className="hidden bg-secondary px-3 py-2 text-xs font-medium text-ink-secondary md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)] md:gap-3"
          >
            <span>Caregiver</span>
            <span>Attempts used</span>
            <span>Attempts allowed</span>
          </li>
          {people.map((person) => (
            <li
              key={person.id}
              className={cn(
                "grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.6fr)] md:items-start",
                person.assigned ? "bg-white" : "bg-page",
              )}
            >
              <div className="flex min-w-0 items-start gap-2.5">
                <Avatar name={person.name} size="sm" />
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/caregivers/${person.id}`}
                    className="block truncate text-sm font-medium text-ink hover:text-teal"
                  >
                    {person.name}
                  </Link>
                  <div className="mt-1">
                    {person.assigned ? (
                      <StateBadge entry={skillState[person.state]} />
                    ) : (
                      <Badge tone="neutral">Not assigned</Badge>
                    )}
                  </div>
                </div>
              </div>
              {person.assigned ? (
                <>
                  <div className="text-sm">
                    <span className="text-xs text-ink-secondary md:hidden">Attempts used: </span>
                    <span className="font-medium text-ink">{usedOfAllowed(person.attempts_used, person.attempts_allowed)}</span>
                    {leftText(person.attempts_left) ? (
                      <Badge tone={leftTone(person.attempts_left)} className="ml-2 md:ml-0 md:mt-1 md:flex md:w-fit">
                        {leftText(person.attempts_left)}
                      </Badge>
                    ) : null}
                  </div>
                  <CaregiverLimitControls
                    caregiverId={person.id}
                    name={person.name}
                    skillId={skill.id}
                    slug={skill.slug}
                    limits={person}
                    skillMax={view.max_attempts}
                    caregiverLimit={person.skill_attempt_limit}
                    onSaved={onChanged}
                  />
                </>
              ) : (
                <p className="text-xs text-ink-secondary md:col-span-2">
                  {person.attempts_used > 0
                    ? `Recorded it ${plural(person.attempts_used, "time")} before it was unassigned. `
                    : ""}
                  Pick them under “Assigned to” to give them this skill.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {view.max_attempts !== null ? (
        <p className="mt-2 text-xs text-ink-secondary">
          The skill&apos;s number is {attemptsEach(view.max_attempts).toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}
