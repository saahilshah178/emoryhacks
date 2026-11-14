"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackToSkills } from "@/caregiver/components/layout/PortalHeading";
import { CameraStage } from "@/caregiver/components/recording/CameraStage";
import { ProcessingScreen } from "@/caregiver/components/recording/ProcessingScreen";
import { ReferencePlayer } from "@/caregiver/components/recording/ReferencePlayer";
import { ReviewScreen } from "@/caregiver/components/recording/ReviewScreen";
import { SkillIntro } from "@/caregiver/components/recording/SkillIntro";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { resultsHref } from "@/caregiver/skills";
import { skillAllowance } from "@/caregiver/status";
import { cn } from "@/lib/cn";
import { ApiError, errorMessage, uploadVideo } from "@/lib/api";
import type { Recording } from "@/lib/recorder";
import type { Job, MySkill, Skill } from "@/lib/types";

type Step = "intro" | "reference" | "record" | "review" | "sending";

const stepOrder: Step[] = ["intro", "reference", "record", "review"];
const stepNames: Record<Step, string> = {
  intro: "About the skill",
  reference: "Demonstration",
  record: "Record",
  review: "Review",
  sending: "Sending",
};

function WizardProgress({ step }: { step: Step }) {
  if (step === "sending") return null;
  const current = stepOrder.indexOf(step);

  return (
    <ol className="mb-5 flex items-start gap-2 lg:gap-3" aria-label="Skill check steps">
      {stepOrder.map((item, index) => (
        <li key={item} aria-current={index === current ? "step" : undefined} className="flex-1">
          <span className={cn("block h-1.5 rounded-full", index <= current ? "bg-teal" : "bg-secondary")} />
          {/* A laptop has room to name the steps; a phone shows the bars alone. */}
          <span
            className={cn(
              "sr-only lg:not-sr-only lg:mt-2 lg:block lg:text-xs lg:font-medium",
              index === current ? "lg:text-teal" : index < current ? "lg:text-ink" : "lg:text-ink-muted",
            )}
          >
            {index + 1}. {stepNames[item]}
          </span>
        </li>
      ))}
    </ol>
  );
}

type Upload = {
  progress: number;
  jobId: string | null;
  attemptId: string | null;
  error: string | null;
  /** The server refused the recording for good: 409 (no attempts left) or 403 (not their skill). */
  refused: boolean;
};
const freshUpload: Upload = { progress: 0, jobId: null, attemptId: null, error: null, refused: false };

/**
 * The practice flow: what the skill is, the nurse's demonstration, recording, review,
 * then uploading the video and following its check until the result page can open. The
 * result page is where the caregiver chooses whether to send it to their nurse.
 * The camera is only on during the record step (CameraStage owns it).
 */
export function SkillCheckClient({ skill, standing }: { skill: Skill; standing: MySkill | undefined }) {
  const router = useRouter();
  const { reload } = useCaregiver();
  const [step, setStep] = useState<Step>("intro");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [upload, setUpload] = useState<Upload>(freshUpload);
  const abortUpload = useRef<(() => void) | null>(null);

  // The take lives in memory until it is replaced or the page is left.
  useEffect(() => {
    if (!recording) return;
    const url = recording.url;
    return () => URL.revokeObjectURL(url);
  }, [recording]);

  // Leaving the page while the file is still being sent stops the upload.
  useEffect(() => () => abortUpload.current?.(), []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const handleRecorded = useCallback((take: Recording) => {
    setRecording(take);
    setUpload(freshUpload);
    setStep("review");
  }, []);

  function recordAgain() {
    setRecording(null);
    setUpload(freshUpload);
    setStep("record");
  }

  function submit() {
    if (!recording) return;
    setUpload(freshUpload);
    setStep("sending");
    const { promise, abort } = uploadVideo(
      { file: recording.blob, filename: recording.filename, kind: "attempt", skillId: skill.id },
      (fraction) => setUpload((current) => ({ ...current, progress: fraction })),
    );
    abortUpload.current = abort;
    promise.then(
      (result) => {
        abortUpload.current = null;
        setUpload({ ...freshUpload, progress: 1, jobId: result.job_id, attemptId: result.attempt_id });
        reload();
      },
      (error: unknown) => {
        abortUpload.current = null;
        const refused = error instanceof ApiError && (error.status === 409 || error.status === 403);
        setUpload({ ...freshUpload, error: errorMessage(error), refused });
        setStep("review");
        // A refusal means the portal's idea of their attempts is out of date.
        if (refused) reload();
      },
    );
  }

  function handleDone(job: Job) {
    reload();
    router.replace(resultsHref(skill.id, job.attempt_id ?? upload.attemptId));
  }

  // After a refusal, their results are the way on (the one ready to send, if any).
  const resultId = standing ? (standing.ready_attempt_id ?? standing.attempt_id ?? standing.latest_attempt_id) : null;
  const refusedWayOn = resultId
    ? { href: resultsHref(skill.id, resultId), label: standing?.ready_attempt_id ? "Review and send your recording" : "See your results" }
    : { href: "/portal/skills", label: "Back to my skills" };

  let body;
  if (step === "intro") {
    body = <SkillIntro skill={skill} standing={standing} onContinue={() => setStep("reference")} />;
  } else if (step === "reference") {
    body = <ReferencePlayer skill={skill} onContinue={() => setStep("record")} onBack={() => setStep("intro")} />;
  } else if (step === "record" || !recording) {
    body = <CameraStage skill={skill} onRecorded={handleRecorded} onBack={() => setStep("reference")} />;
  } else if (step === "review") {
    body = (
      <ReviewScreen
        skill={skill}
        recording={recording}
        allowance={standing ? skillAllowance(standing) : null}
        error={upload.error}
        blocked={upload.refused ? refusedWayOn : null}
        onSubmit={submit}
        onRetake={recordAgain}
      />
    );
  } else {
    body = (
      <ProcessingScreen
        skillName={skill.name}
        progress={upload.progress}
        jobId={upload.jobId}
        attemptHref={upload.attemptId ? resultsHref(skill.id, upload.attemptId) : null}
        onDone={handleDone}
        onSendAgain={() => {
          reload();
          submit();
        }}
        onRecordAgain={() => {
          reload();
          recordAgain();
        }}
      />
    );
  }

  return (
    <div>
      <div className="lg:mb-5">
        <BackToSkills />
      </div>
      <WizardProgress step={step} />
      {body}
    </div>
  );
}
