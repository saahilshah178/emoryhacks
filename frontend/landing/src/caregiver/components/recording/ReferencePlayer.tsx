"use client";

import { useRef, useState } from "react";
import { Play, RotateCcw, Video } from "lucide-react";
import { Button } from "@/caregiver/components/ui/Button";
import { Card } from "@/caregiver/components/ui/Card";
import { StepChecklist } from "@/caregiver/components/recording/StepChecklist";
import type { Skill } from "@/caregiver/types/skill";

export function ReferencePlayer({
  skill,
  onContinue,
  onBack,
}: {
  skill: Skill;
  onContinue: () => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  function replay() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play();
  }

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal">
          Reference demonstration
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">
          Watch it once, then try it
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          This is a nurse-approved example of {skill.name.toLowerCase()}.
        </p>
      </header>

      <Card className="overflow-hidden">
        {skill.referenceVideo ? (
          <video
            ref={videoRef}
            className="aspect-video w-full bg-navy"
            src={skill.referenceVideo}
            controls
            playsInline
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        ) : (
          <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-navy text-white">
            <Video className="h-8 w-8 text-teal" aria-hidden />
            <p className="text-sm text-white/80">Demonstration coming soon</p>
          </div>
        )}
      </Card>

      <Button
        variant="secondary"
        className="w-full"
        onClick={replay}
        disabled={!skill.referenceVideo}
      >
        {playing ? (
          <RotateCcw className="h-4 w-4" aria-hidden />
        ) : (
          <Play className="h-4 w-4" aria-hidden />
        )}
        Replay the demonstration
      </Button>

      <Card className="p-4">
        <StepChecklist steps={skill.steps} />
      </Card>

      <div className="flex flex-col gap-3">
        <Button onClick={onContinue} className="w-full" size="lg">
          I&apos;m ready to record
        </Button>
        <Button variant="ghost" onClick={onBack} className="w-full">
          Back
        </Button>
      </div>
    </div>
  );
}
