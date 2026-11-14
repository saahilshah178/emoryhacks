"use client";

import { Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Card, CardBody, CardDescription, CardHeader, CardTitle, Field, Input, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { Skill } from "@/lib/types";
import { sameList, toLines, toList } from "./text";

type Status = { kind: "saved" } | { kind: "error"; message: string } | null;

/** Save, undo and the inline result, shared by the two forms below. */
function SaveRow({
  status,
  dirty,
  saving,
  label,
  onSave,
  onUndo,
}: {
  status: Status;
  dirty: boolean;
  saving: boolean;
  label: string;
  onSave: () => void;
  onUndo: () => void;
}) {
  return (
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
        <Button variant="ghost" size="sm" disabled={saving} onClick={onUndo}>
          Undo changes
        </Button>
      ) : null}
      <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
        {label}
      </Button>
    </div>
  );
}

function useSave(skillId: string, onSaved: (skill: Skill) => void) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  async function save(body: Record<string, unknown>, after: (skill: Skill) => void) {
    setSaving(true);
    setStatus(null);
    try {
      const updated = await api<Skill>(`/skills/${skillId}`, { method: "PATCH", json: body });
      after(updated);
      onSaved(updated);
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({ kind: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }
  return { saving, status, setStatus, save };
}

function FormCard({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="text-navy">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

type DetailsDraft = { name: string; summary: string; orderMatters: boolean; safety: string };

const detailsFrom = (skill: Skill): DetailsDraft => ({
  name: skill.name,
  summary: skill.summary,
  orderMatters: skill.order_matters,
  safety: toLines(skill.safety_criteria),
});

/** Name, summary, whether order matters and the safety points (PATCH /skills/{id}). */
export function SkillDetailsForm({ skill, onSaved }: { skill: Skill; onSaved: (skill: Skill) => void }) {
  const original = detailsFrom(skill);
  const [draft, setDraft] = useState(original);
  const { saving, status, setStatus, save } = useSave(skill.id, onSaved);
  const dirty =
    draft.name !== original.name ||
    draft.summary !== original.summary ||
    draft.orderMatters !== original.orderMatters ||
    draft.safety !== original.safety;

  function change(next: Partial<DetailsDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setStatus(null);
  }

  function submit() {
    const name = draft.name.trim();
    if (!name) {
      setStatus({ kind: "error", message: "The skill needs a name." });
      return;
    }
    const body: Record<string, unknown> = {};
    if (name !== skill.name) body.name = name;
    if (draft.summary.trim() !== skill.summary) body.summary = draft.summary.trim();
    if (draft.orderMatters !== skill.order_matters) body.order_matters = draft.orderMatters;
    const safety = toList(draft.safety);
    if (!sameList(safety, skill.safety_criteria ?? [])) body.safety_criteria = safety;
    if (Object.keys(body).length === 0) {
      setDraft(original);
      setStatus({ kind: "saved" });
      return;
    }
    void save(body, (updated) => setDraft(detailsFrom(updated)));
  }

  return (
    <FormCard title="Skill details" description="What nurses see in the skill list and on review screens.">
      <div className="grid gap-4">
        <Field label="Skill name">
          <Input value={draft.name} onChange={(event) => change({ name: event.target.value })} />
        </Field>
        <Field label="Summary">
          <Textarea rows={2} value={draft.summary} onChange={(event) => change({ summary: event.target.value })} />
        </Field>
        <label className="inline-flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-teal"
            checked={draft.orderMatters}
            onChange={(event) => change({ orderMatters: event.target.checked })}
          />
          <span>
            Order matters
            <span className="block text-xs text-ink-secondary">
              When ticked, steps done before the steps they must come after are flagged as out of order.
            </span>
          </span>
        </label>
        <Field label="Safety points" hint="Checked throughout the whole recording. One per line.">
          <Textarea rows={3} value={draft.safety} onChange={(event) => change({ safety: event.target.value })} />
        </Field>
      </div>
      <SaveRow
        status={status}
        dirty={dirty}
        saving={saving}
        label="Save details"
        onSave={submit}
        onUndo={() => {
          setDraft(original);
          setStatus(null);
        }}
      />
    </FormCard>
  );
}

type GuideDraft = { description: string; safetyReminder: string };

const guideFrom = (skill: Skill): GuideDraft => ({
  description: skill.guide?.description ?? "",
  safetyReminder: skill.guide?.safety_reminder ?? "",
});

/** The short description and safety reminder caregivers read before recording. */
export function CaregiverCopyForm({ skill, onSaved }: { skill: Skill; onSaved: (skill: Skill) => void }) {
  const original = guideFrom(skill);
  const [draft, setDraft] = useState(original);
  const { saving, status, setStatus, save } = useSave(skill.id, onSaved);
  const dirty = draft.description !== original.description || draft.safetyReminder !== original.safetyReminder;

  function change(next: Partial<GuideDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setStatus(null);
  }

  function submit() {
    const guide: Record<string, string> = {};
    if (draft.description.trim() !== original.description.trim()) guide.description = draft.description.trim();
    if (draft.safetyReminder.trim() !== original.safetyReminder.trim()) {
      guide.safety_reminder = draft.safetyReminder.trim();
    }
    if (Object.keys(guide).length === 0) {
      setDraft(original);
      setStatus({ kind: "saved" });
      return;
    }
    void save({ guide }, (updated) => setDraft(guideFrom(updated)));
  }

  return (
    <FormCard
      title="What caregivers see"
      description="Caregivers read these before they record this skill. Leave a box empty to use the text written from the reference video."
    >
      <div className="grid gap-4">
        <Field label="Short description">
          <Textarea
            rows={2}
            value={draft.description}
            onChange={(event) => change({ description: event.target.value })}
          />
        </Field>
        <Field label="Safety reminder">
          <Textarea
            rows={2}
            value={draft.safetyReminder}
            onChange={(event) => change({ safetyReminder: event.target.value })}
          />
        </Field>
      </div>
      <SaveRow
        status={status}
        dirty={dirty}
        saving={saving}
        label="Save caregiver text"
        onSave={submit}
        onUndo={() => {
          setDraft(original);
          setStatus(null);
        }}
      />
    </FormCard>
  );
}
