"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { useDashboard } from "@/context/DashboardContext";

export function ReviewActions({
  submissionId,
  initialNotes,
  alreadyResolved,
}: {
  submissionId: string;
  initialNotes?: string;
  alreadyResolved: boolean;
}) {
  const router = useRouter();
  const { resolveReview } = useDashboard();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<"approved" | "retraining_requested" | null>(null);

  function submit(status: "approved" | "retraining_requested") {
    if (status === "retraining_requested" && notes.trim().length < 8) {
      setError("Add a short note so the caregiver knows what to practice.");
      return;
    }
    resolveReview(submissionId, status, notes.trim());
    router.push("/pending");
  }

  if (alreadyResolved) {
    return (
      <div className="rounded-[12px] border border-border bg-secondary p-4 text-sm text-ink-secondary">
        This submission already has a nurse decision. Notes remain on the caregiver record.
      </div>
    );
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
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>

      {confirm ? (
        <div className="rounded-[12px] border border-border bg-page p-4">
          <p className="text-sm font-medium text-ink">
            {confirm === "approved"
              ? "Approve this skill? The caregiver will be cleared for independent performance."
              : "Request retraining? This skill stays restricted until a new demonstration is approved."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant={confirm === "approved" ? "primary" : "destructive"}
              onClick={() => submit(confirm)}
            >
              Confirm {confirm === "approved" ? "approval" : "retraining"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button size="lg" onClick={() => setConfirm("approved")}>
            Approve Skill
          </Button>
          <Button
            size="lg"
            variant="destructive"
            onClick={() => setConfirm("retraining_requested")}
          >
            Request Retraining
          </Button>
        </div>
      )}
    </div>
  );
}
