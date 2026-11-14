"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Button, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/cn";
import { firstName, plural } from "@/lib/format";
import type { CaregiverDetail, CaregiverSkillLimits, CaregiverSkillPatch, LimitMode } from "@/lib/types";
import { NumberStepper } from "./NumberStepper";
import { MAX_ATTEMPTS, MIN_ATTEMPTS, parseCount } from "./words";

/** What a nurse changes about one caregiver on one skill. Returns the caregiver as the API sends it back. */
export async function patchCaregiverSkill(caregiverId: string, skillId: string, patch: CaregiverSkillPatch) {
  return api<CaregiverDetail>(`/caregivers/${caregiverId}/skills/${skillId}`, { method: "PATCH", json: patch });
}

/** A sentence about where the caregiver stands on the skill after a change. */
function standing(name: string, limits: CaregiverSkillLimits | undefined) {
  if (!limits) return "Saved.";
  if (limits.attempts_allowed === null) return `${firstName(name)} now has unlimited attempts.`;
  return `${firstName(name)} now has ${plural(limits.attempts_allowed, "attempt")}, ${limits.attempts_left ?? 0} left.`;
}

/**
 * One caregiver's attempts allowed on one skill: the skill's number, their own number or
 * unlimited, and "Give 1 more" (or more) when they have run out or have one left. Each
 * change is saved straight away and says what it did.
 */
export function CaregiverLimitControls({
  caregiverId,
  name,
  skillId,
  slug,
  limits,
  skillMax,
  onSaved,
  className,
}: {
  caregiverId: string;
  name: string;
  skillId: string;
  slug: string;
  limits: CaregiverSkillLimits;
  /** The skill's own number, null for unlimited; undefined while it is not known. */
  skillMax: number | null | undefined;
  onSaved: (caregiver: CaregiverDetail) => void;
  className?: string;
}) {
  // Drafts: null shows what is saved, so a reload from elsewhere is never hidden behind them.
  const [modeDraft, setModeDraft] = useState<LimitMode | null>(null);
  const [ownDraft, setOwnDraft] = useState<string | null>(null);
  const mode = modeDraft ?? limits.limit_mode;
  const own = ownDraft ?? String(limits.max_attempts ?? limits.attempts_allowed ?? skillMax ?? 3);
  const [grant, setGrant] = useState("1");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ownNumber = parseCount(own);
  const grantNumber = parseCount(grant);
  const ownChanged = limits.limit_mode !== "limited" || ownNumber !== limits.max_attempts;
  const limited = limits.attempts_allowed !== null;
  const low = limited && (limits.attempts_left ?? 0) <= 1;
  const who = firstName(name);

  async function save(key: string, patch: CaregiverSkillPatch) {
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      const caregiver = await patchCaregiverSkill(caregiverId, skillId, patch);
      const after = caregiver.skills.find((skill) => skill.slug === slug);
      setMessage(standing(name, after));
      setModeDraft(null);
      setOwnDraft(null);
      if (patch.grant) setGrant("1");
      onSaved(caregiver);
    } catch (e) {
      setError(errorMessage(e));
      setModeDraft(null);
    } finally {
      setBusy(null);
    }
  }

  function choose(next: LimitMode) {
    setModeDraft(next);
    setMessage(null);
    setError(null);
    // "Their own number" waits for the number; the other two apply straight away.
    if (next !== "limited" && next !== limits.limit_mode) void save("mode", { limit_mode: next });
  }

  const skillLabel =
    skillMax === undefined ? "The skill's number" : skillMax === null ? "The skill's (unlimited)" : `The skill's (${skillMax})`;

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`Attempts allowed for ${name}`}
          value={mode}
          disabled={busy !== null}
          onChange={(event) => choose(event.target.value as LimitMode)}
          className="h-8 w-auto min-w-0 rounded-[10px] pr-8 text-xs"
        >
          <option value="inherit">{skillLabel}</option>
          <option value="limited">Their own number</option>
          <option value="unlimited">Unlimited</option>
        </Select>
        {mode === "limited" ? (
          <>
            <NumberStepper
              size="sm"
              value={own}
              onChange={(next) => {
                setOwnDraft(next);
                setMessage(null);
              }}
              min={MIN_ATTEMPTS}
              max={MAX_ATTEMPTS}
              label={`Attempts allowed for ${name}`}
              invalid={ownNumber === null}
              disabled={busy !== null}
            />
            {ownChanged ? (
              <Button
                size="sm"
                loading={busy === "own"}
                disabled={ownNumber === null || busy !== null}
                onClick={() => ownNumber !== null && void save("own", { limit_mode: "limited", max_attempts: ownNumber })}
              >
                Set
              </Button>
            ) : null}
          </>
        ) : null}
      </div>

      {limited && low && mode === limits.limit_mode ? (
        <div className="flex flex-wrap items-center gap-2">
          <NumberStepper
            size="sm"
            value={grant}
            onChange={setGrant}
            min={MIN_ATTEMPTS}
            max={MAX_ATTEMPTS}
            label={`More attempts to give ${name}`}
            invalid={grantNumber === null}
            disabled={busy !== null}
          />
          <Button
            size="sm"
            variant={limits.attempts_left === 0 ? "primary" : "secondary"}
            loading={busy === "grant"}
            disabled={grantNumber === null || busy !== null}
            onClick={() => grantNumber !== null && void save("grant", { grant: grantNumber })}
          >
            Give {grantNumber ?? ""} more
          </Button>
        </div>
      ) : null}

      {mode === "limited" && ownNumber === null ? (
        <p className="text-xs text-danger">Choose a number from {MIN_ATTEMPTS} to {MAX_ATTEMPTS}.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="flex items-center gap-1 text-xs text-success">
          <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {message}
        </p>
      ) : null}
      {!message && !error && limits.attempts_left === 0 ? (
        <p className="text-xs text-ink-secondary">{who} cannot record this skill again until you give more.</p>
      ) : null}
    </div>
  );
}
