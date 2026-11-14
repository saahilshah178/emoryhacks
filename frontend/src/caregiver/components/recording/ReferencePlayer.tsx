"use client";

import { Play, RotateCcw, Video } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { VideoFrame } from "@/components/media/VideoFrame";
import { StepChecklist } from "@/caregiver/components/recording/StepChecklist";
import { useVideoSegments } from "@/lib/segment";
import type { Skill } from "@/lib/types";

export function ReferencePlayer({
  skill,
  onContinue,
  onBack,
}: {
  skill: Skill;
  onContinue: () => void;
  onBack: () => void;
}) {
  const player = useVideoSegments();
  const available = Boolean(skill.video?.available);

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal">Reference demonstration</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy">
          {available ? "Watch it once, then try it" : "Read the steps, then try it"}
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {available
            ? `This is your nurse's example of ${skill.name.toLowerCase()}.`
            : `These are the steps your nurse expects for ${skill.name.toLowerCase()}.`}
        </p>
      </header>

      <VideoFrame
        video={skill.video}
        videoRef={player.ref}
        missing={
          <>
            <Video className="h-8 w-8 text-teal" aria-hidden />
            <p className="text-sm text-white/80">
              {skill.video ? "The demonstration video isn't available right now." : "Demonstration coming soon"}
            </p>
          </>
        }
      />

      {available ? (
        <Button variant="secondary" size="lg" className="w-full" onClick={() => player.play(0)}>
          {player.playing || player.time > 0 ? (
            <RotateCcw className="h-4 w-4" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
          {player.playing || player.time > 0 ? "Replay the demonstration" : "Play the demonstration"}
        </Button>
      ) : null}

      <Card className="p-4">
        <StepChecklist
          steps={skill.steps}
          orderMatters={skill.order_matters}
          onPlay={available ? player.play : undefined}
        />
      </Card>

      <div className="flex flex-col gap-3">
        <Button onClick={onContinue} className="w-full" size="xl">
          I&apos;m ready to record
        </Button>
        <Button variant="ghost" size="lg" onClick={onBack} className="w-full">
          Back
        </Button>
      </div>
    </div>
  );
}
