"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ErrorNote, StateBadge, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { firstName, formatDateTime, plural } from "@/lib/format";
import { reviewState, stepStatus } from "@/lib/status";
import type { Attempt, ReviewRequest, StepReview } from "@/lib/types";
import { freshSet } from "@/nurse/components/attempts/words";
import { useDashboard } from "@/nurse/context/DashboardContext";

/** "Jamie gets a fresh set of 3 attempts", or null for a recording with no caregiver account. */
function freshSetSentence(attempt: Attempt) {
  if (attempt.attempts.used === null) return null;
  const name = firstName(attempt.caregiver_name || "") || "The caregiver";
  return `${name} gets a fresh set of ${freshSet(attempt.attempts.allowed)} for this skill.`;
}

type Decision = "approved" | "retraining";

/**
 * The nurse's decision. Approving sends overall "passed", requesting retraining sends
 * "failed"; the per-step overrides the nurse changed go with it.
 */
export function ReviewActions({
  attempt,
  editing,
  onEdit,
  onCancel,
  changedSteps,
}: {
  attempt: Attempt;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  changedSteps: StepReview[];
}) {
  const reviewed = attempt.review_state === "approved" || attempt.review_state === "retraining";

  if (reviewed && !editing) {
    const overridden = [...attempt.steps].filter((s) => s.nurse_status).sort((a, b) => a.ord - b.ord);
    return (
      <div className="space-y-3 text-sm">
        <StateBadge entry={reviewState[attempt.review_state]} />
        <p className="text-ink-secondary">
          {attempt.reviewer_name ? (
            <>
              By <span className="font-medium text-ink">{attempt.reviewer_name}</span>
              {attempt.reviewer_credentials ? `, ${attempt.reviewer_credentials}` : ""}
            </>
          ) : (
            "Decided by a nurse"
          )}
          {attempt.reviewed_at ? ` · ${formatDateTime(attempt.reviewed_at)}` : ""}
        </p>
        {attempt.nurse_note ? (
          <p className="rounded-[12px] bg-page px-3 py-2 text-ink">{attempt.nurse_note}</p>
        ) : (
          <p className="text-ink-secondary">No note was added.</p>
        )}
        {overridden.length ? (
          <div>
            <p className="text-xs font-medium text-ink-secondary">Step readings changed by the nurse</p>
            <ul className="mt-1 space-y-1">
              {overridden.map((s) => (
                <li key={s.step_id} className="text-ink">
                  {s.ord}. {s.title}: {s.nurse_status ? stepStatus[s.nurse_status].label : null}
                  {s.nurse_note ? <span className="text-ink-secondary"> — {s.nurse_note}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <Button variant="secondary" onClick={onEdit}>
          Change decision
        </Button>
      </div>
    );
  }

  return <DecisionForm attempt={attempt} reviewed={reviewed} onCancel={onCancel} changedSteps={changedSteps} />;
}

function DecisionForm({
  attempt,
  reviewed,
  onCancel,
  changedSteps,
}: {
  attempt: Attempt;
  reviewed: boolean;
  onCancel: () => void;
  changedSteps: StepReview[];
}) {
  const router = useRouter();
  const { showFlash, reloadOverview } = useDashboard();
  const [notes, setNotes] = useState(reviewed ? attempt.nurse_note : "");
  const [error, setError] = useState("");
  const [apiError, setApiError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Decision | null>(null);
  const [saving, setSaving] = useState(false);
  const fresh = freshSetSentence(attempt);
  const replaced = attempt.review_state === "superseded";

  async function submit(decision: Decision) {
    if (decision === "retraining" && notes.trim().length < 8) {
      setError("Add a short note so the caregiver knows what to practice.");
      setConfirm(null);
      return;
    }
    setSaving(true);
    setApiError(null);
    try {
      const body: ReviewRequest = {
        overall: decision === "approved" ? "passed" : "failed",
        note: notes.trim(),
        steps: changedSteps,
      };
      await api<Attempt>(`/attempts/${attempt.id}/review`, { json: body });
      showFlash(
        decision === "approved"
          ? { tone: "success", message: "Skill approved. The caregiver can perform this task independently once scheduled." }
          : {
              tone: "danger",
              message: `Retraining requested. The caregiver will be notified and this skill stays restricted.${
                fresh ? ` ${fresh}` : ""
              }`,
            },
      );
      reloadOverview();
      router.push("/dashboard/pending");
    } catch (e) {
      setApiError(errorMessage(e));
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="review-notes" className="text-sm font-medium text-ink">
          Review notes
        </label>
        <p className="mt-1 text-xs text-ink-secondary">
          Visible to the caregiver and the next supervising nurse. Required when requesting retraining.
        </p>
        <Textarea
          id="review-notes"
          rows={4}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            setError("");
          }}
          placeholder="Example: Brakes were never locked. Please rewatch the reference video and resubmit focusing on brake order before the gait belt."
          className="mt-2"
        />
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </div>

      <p className="text-xs text-ink-secondary">
        {changedSteps.length
          ? `${plural(changedSteps.length, "step reading")} you changed will be saved with this decision.`
          : "To change the AI's reading of a step, use “Your reading” under that step."}
      </p>

      {apiError ? <ErrorNote message={apiError} /> : null}

      {confirm ? (
        <div className="rounded-[12px] border border-border bg-page p-4">
          <p className="text-sm font-medium text-ink">
            {confirm === "approved"
              ? "Approve this skill? The caregiver will be cleared for independent performance."
              : "Request retraining? This skill stays restricted until a new demonstration is approved."}
          </p>
          {confirm === "retraining" && fresh ? <p className="mt-1 text-sm text-ink-secondary">{fresh}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant={confirm === "approved" ? "primary" : "destructive"} loading={saving} onClick={() => submit(confirm)}>
              Confirm {confirm === "approved" ? "approval" : "retraining"}
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button size="lg" onClick={() => setConfirm("approved")}>
            Approve skill
          </Button>
          <Button
            size="lg"
            variant="destructive"
            onClick={() => {
              if (notes.trim().length < 8) {
                setError("Add a short note so the caregiver knows what to practice.");
                return;
              }
              setConfirm("retraining");
            }}
          >
            Request retraining
          </Button>
          {reviewed || replaced ? (
            <Button variant="ghost" onClick={onCancel}>
              {reviewed ? "Keep current decision" : "Back"}
            </Button>
          ) : null}
        </div>
      )}
      {fresh && !confirm ? (
        <p className="text-xs text-ink-secondary">If you request retraining, {fresh.replace(/^The caregiver/, "the caregiver")}</p>
      ) : null}
    </div>
  );
}
