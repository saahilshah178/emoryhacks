"use client";

import Link from "next/link";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, CardBody, CardDescription, CardHeader, CardTitle, EmptyState, StateBadge } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { firstName, plural } from "@/lib/format";
import { useApi } from "@/lib/hooks";
import { categoryLabel, skillState } from "@/lib/status";
import type { CaregiverDetail, SkillSummary } from "@/lib/types";
import { CaregiverLimitControls, patchCaregiverSkill } from "@/nurse/components/attempts/CaregiverLimitControls";
import { leftText, leftTone, usedOfAllowed } from "@/nurse/components/attempts/words";
import { useDashboard } from "@/nurse/context/DashboardContext";

type Row = CaregiverDetail["skills"][number];

/**
 * The skills assigned to one caregiver, with attempts used of allowed and the controls to
 * change their number, give more or unassign; then the agency's other skills, to assign.
 */
export function CaregiverSkills({
  person,
  onSaved,
  onShowHistory,
}: {
  person: CaregiverDetail;
  onSaved: (next: CaregiverDetail) => void;
  /** Show this skill's recordings in the history below. */
  onShowHistory: (slug: string) => void;
}) {
  // The skills' own numbers, for "The skill's (3)".
  const skills = useApi<SkillSummary[]>("/skills");
  const skillMax = (slug: string) => {
    if (!skills.data) return undefined;
    const found = skills.data.find((skill) => skill.slug === slug);
    return found ? found.policy.max_attempts : undefined;
  };
  const assignAll = (slug: string) => skills.data?.find((skill) => skill.slug === slug)?.policy.assign_all;
  const who = firstName(person.name);

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Skills assigned to {who}</CardTitle>
          <CardDescription>
            Where {who} stands on each skill and how many attempts they have. Every recording that gets graded uses
            one; asking for retraining gives a fresh set.
          </CardDescription>
        </div>
      </CardHeader>
      <CardBody className="space-y-5">
        {person.skills.length === 0 ? (
          <EmptyState title="No skills assigned">
            {person.unassigned_skills.length > 0
              ? `Assign ${who} a skill below and it appears in their portal.`
              : "Skills appear here once you add one to the library from a reference recording."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-[12px] border border-border">
            <li
              aria-hidden
              className="hidden bg-secondary px-4 py-2 text-xs font-medium text-ink-secondary lg:grid lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] lg:gap-4"
            >
              <span>Skill</span>
              <span>Attempts used</span>
              <span>Attempts allowed</span>
              <span className="w-24 text-right">Recordings</span>
            </li>
            {person.skills.map((skill) => (
              <SkillRow
                key={skill.skill_id}
                person={person}
                skill={skill}
                skillMax={skillMax(skill.slug)}
                assignAll={assignAll(skill.slug)}
                onShowHistory={() => onShowHistory(skill.slug)}
                onSaved={(next) => {
                  onSaved(next);
                  skills.reload();
                }}
              />
            ))}
          </ul>
        )}

        {person.unassigned_skills.length > 0 ? (
          <Unassigned person={person} onSaved={onSaved} onAssigned={skills.reload} />
        ) : null}
      </CardBody>
    </Card>
  );
}

function SkillRow({
  person,
  skill,
  skillMax,
  assignAll,
  onShowHistory,
  onSaved,
}: {
  person: CaregiverDetail;
  skill: Row;
  skillMax: number | null | undefined;
  assignAll: boolean | undefined;
  onShowHistory: () => void;
  onSaved: (next: CaregiverDetail) => void;
}) {
  const { reloadOverview, showFlash } = useDashboard();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = firstName(person.name);

  async function unassign() {
    setBusy(true);
    setError(null);
    try {
      const next = await patchCaregiverSkill(person.id, skill.skill_id, { assigned: false });
      onSaved(next);
      reloadOverview();
      showFlash({ tone: "success", message: `${skill.name} is no longer assigned to ${person.name}.` });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <li className="grid gap-3 bg-white px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] lg:items-start lg:gap-4">
      <div className="min-w-0">
        <Link href={`/dashboard/skills/${skill.skill_id}#attempts`} className="font-medium text-ink hover:text-teal">
          {skill.name}
        </Link>
        <p className="text-xs text-ink-muted">{categoryLabel[skill.category] ?? categoryLabel.other}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StateBadge entry={skillState[skill.state]} />
          {skill.state === "in_review" && skill.attempt_id ? (
            <Link href={`/dashboard/reviews/${skill.attempt_id}`} className="text-xs font-medium text-teal hover:underline">
              Review
            </Link>
          ) : null}
        </div>
      </div>

      <div className="text-sm">
        <span className="text-xs text-ink-secondary lg:hidden">Attempts used: </span>
        <span className="font-medium text-ink">{usedOfAllowed(skill.attempts_used, skill.attempts_allowed)}</span>
        {leftText(skill.attempts_left) ? (
          <Badge tone={leftTone(skill.attempts_left)} className="ml-2 lg:ml-0 lg:mt-1 lg:flex lg:w-fit">
            {leftText(skill.attempts_left)}
          </Badge>
        ) : null}
      </div>

      <CaregiverLimitControls
        caregiverId={person.id}
        name={person.name}
        skillId={skill.skill_id}
        slug={skill.slug}
        limits={skill}
        skillMax={skillMax}
        onSaved={onSaved}
      />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm lg:w-24 lg:flex-col lg:items-end">
        {skill.attempts > 0 ? (
          <button type="button" onClick={onShowHistory} className="font-medium text-teal hover:underline">
            {plural(skill.attempts, "recording")}
          </button>
        ) : (
          <span className="text-xs text-ink-muted">No recordings</span>
        )}
        {asking ? null : (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="text-xs font-medium text-ink-secondary hover:text-danger hover:underline"
          >
            Unassign
          </button>
        )}
      </div>

      {asking ? (
        <div className="rounded-[12px] border border-border bg-page p-3 text-sm lg:col-span-4">
          <p className="text-ink">
            Unassign {skill.name} from {who}? It leaves their portal, and they can no longer record or send it. Their
            recordings stay here.
            {assignAll ? " The skill is assigned to every caregiver now, so it switches to picked caregivers, with everyone else still assigned." : ""}
          </p>
          {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" loading={busy} onClick={() => void unassign()}>
              Unassign
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Unassigned({
  person,
  onSaved,
  onAssigned,
}: {
  person: CaregiverDetail;
  onSaved: (next: CaregiverDetail) => void;
  onAssigned: () => void;
}) {
  const { reloadOverview } = useDashboard();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const who = firstName(person.name);

  async function assign(skillId: string, name: string) {
    setBusy(skillId);
    setError(null);
    setDone(null);
    try {
      const next = await patchCaregiverSkill(person.id, skillId, { assigned: true });
      onSaved(next);
      onAssigned();
      reloadOverview();
      setDone(`${name} is now assigned to ${who}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-ink">Not assigned to {who}</h3>
      <p className="mt-1 text-xs text-ink-secondary">{who} does not see these skills in their portal.</p>
      {done ? (
        <p role="status" className="mt-2 flex items-center gap-1.5 text-sm text-success">
          <Check className="h-4 w-4" aria-hidden />
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-[12px] border border-border">
        {person.unassigned_skills.map((skill) => (
          <li key={skill.skill_id} className="flex flex-wrap items-center gap-3 bg-page px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <Link href={`/dashboard/skills/${skill.skill_id}#attempts`} className="text-sm font-medium text-ink hover:text-teal">
                {skill.name}
              </Link>
              <p className="text-xs text-ink-muted">{categoryLabel[skill.category] ?? categoryLabel.other}</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={busy === skill.skill_id}
              disabled={busy !== null}
              onClick={() => void assign(skill.skill_id, skill.name)}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Assign
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
