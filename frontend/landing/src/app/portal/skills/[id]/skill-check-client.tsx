"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CameraStage } from "@/caregiver/components/recording/CameraStage";
import { ProcessingScreen } from "@/caregiver/components/recording/ProcessingScreen";
import { ReferencePlayer } from "@/caregiver/components/recording/ReferencePlayer";
import { ReviewScreen } from "@/caregiver/components/recording/ReviewScreen";
import { SkillIntro } from "@/caregiver/components/recording/SkillIntro";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import { resultsHref } from "@/caregiver/skills";
import { errorMessage, uploadVideo } from "@/lib/api";
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
    <ol className="mb-5 flex items-center gap-2" aria-label="Skill check steps">
      {stepOrder.map((item, index) => (
        <li
          key={item}
          aria-current={index === current ? "step" : undefined}
          className={`h-1.5 flex-1 rounded-full ${index <= current ? "bg-teal" : "bg-secondary"}`}
        >
          <span className="sr-only">{stepNames[item]}</span>
        </li>
      ))}
    </ol>
  );
}

type Upload = { progress: number; jobId: string | null; attemptId: string | null; error: string | null };
const freshUpload: Upload = { progress: 0, jobId: null, attemptId: null, error: null };

/**
 * The practice flow: what the skill is, the nurse's demonstration, recording, review,
 * then sending the video and following its grading until the result page can open.
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
        setUpload({ progress: 1, jobId: result.job_id, attemptId: result.attempt_id, error: null });
        reload();
      },
      (error: unknown) => {
        abortUpload.current = null;
        setUpload({ ...freshUpload, error: errorMessage(error) });
        setStep("review");
      },
    );
  }

  function handleDone(job: Job) {
    reload();
    router.replace(resultsHref(skill.id, job.attempt_id ?? upload.attemptId));
  }

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
        error={upload.error}
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
      <WizardProgress step={step} />
      {body}
    </div>
  );
}
