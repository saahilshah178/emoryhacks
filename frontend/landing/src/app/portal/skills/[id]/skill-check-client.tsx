"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SkillIntro } from "@/caregiver/components/recording/SkillIntro";
import { ReferencePlayer } from "@/caregiver/components/recording/ReferencePlayer";
import { CameraStage } from "@/caregiver/components/recording/CameraStage";
import { ReviewScreen } from "@/caregiver/components/recording/ReviewScreen";
import { ProcessingScreen } from "@/caregiver/components/recording/ProcessingScreen";
import { useCaregiver } from "@/caregiver/context/CaregiverContext";
import type { Skill } from "@/caregiver/types/skill";

type Step = "intro" | "reference" | "record" | "review" | "processing";

const stepOrder: Step[] = ["intro", "reference", "record", "review"];

function WizardProgress({ step }: { step: Step }) {
  if (step === "processing") return null;
  const current = stepOrder.indexOf(step);

  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Skill check steps">
      {stepOrder.map((item, index) => (
        <li
          key={item}
          className={`h-1.5 flex-1 rounded-full ${
            index <= current ? "bg-teal" : "bg-bg-secondary"
          }`}
        >
          <span className="sr-only">
            {item}
            {index === current ? " (current)" : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function SkillCheckClient({ skill }: { skill: Skill }) {
  const router = useRouter();
  const { saveRecording, submitForReview, recordings } = useCaregiver();
  const [step, setStep] = useState<Step>("intro");
  const [recordingUrl, setRecordingUrl] = useState<string | null>(
    recordings[skill.id] ?? null,
  );

  function handleRecordingReady(url: string | null) {
    if (url) saveRecording(skill.id, url);
    setRecordingUrl(url);
  }

  function handleSubmit() {
    setStep("processing");
    submitForReview(skill.id);
    window.setTimeout(() => {
      router.push(`/portal/skills/${skill.id}/results`);
    }, 2800);
  }

  const body =
    step === "intro" ? (
      <SkillIntro skill={skill} onContinue={() => setStep("reference")} />
    ) : step === "reference" ? (
      <ReferencePlayer
        skill={skill}
        onContinue={() => setStep("record")}
        onBack={() => setStep("intro")}
      />
    ) : step === "record" ? (
      <CameraStage
        skill={skill}
        onBack={() => setStep("reference")}
        onContinue={() => setStep("review")}
        onRecordingReady={handleRecordingReady}
      />
    ) : step === "processing" ? (
      <ProcessingScreen skillName={skill.name} />
    ) : (
      <ReviewScreen
        skill={skill}
        recordingUrl={recordingUrl}
        onSubmit={handleSubmit}
        onRetake={() => setStep("record")}
      />
    );

  return (
    <div>
      <WizardProgress step={step} />
      {body}
    </div>
  );
}
