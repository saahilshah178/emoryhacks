"use client";

import { useMemo, useRef } from "react";
import { Play, RotateCcw, Video } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { referenceChapters } from "@/components/media/chapters";
import { StepChapters, useCurrentChapter, useRevealInList } from "@/components/media/StepChapters";
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
  const chapters = useMemo(() => referenceChapters(skill.steps), [skill.steps]);
  const current = useCurrentChapter(chapters, player.playhead, player.play);
  const listRef = useRef<HTMLDivElement>(null);
  useRevealInList(listRef, current.id);
  // Shown once: under the video on a laptop, after the steps on a phone.
  const actions = (
    <>
      <Button onClick={onContinue} className="w-full" size="xl">
        I&apos;m ready to record
      </Button>
      <Button variant="ghost" size="lg" onClick={onBack} className="w-full">
        Back
      </Button>
    </>
  );

  return (
    <div className="space-y-5">
      <PortalHeading
        eyebrow="Reference demonstration"
        title={available ? "Watch it once, then try it" : "Read the steps, then try it"}
        description={
          available
            ? `This is your nurse's example of ${skill.name.toLowerCase()}.`
            : `These are the steps your nurse expects for ${skill.name.toLowerCase()}.`
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {/* On a laptop the video stays in view while the steps beside it scroll. */}
        <div className="space-y-5 lg:sticky lg:top-20">
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

          {available && skill.video ? (
            <Card className="p-4">
              <StepChapters
                chapters={chapters}
                duration={skill.video.duration_s}
                time={player.playhead}
                activeId={current.id}
                onSelect={current.select}
                label="Steps in the demonstration"
                emptyText="Your nurse hasn't marked where each step is in this video yet. Watch it from the start."
              />
            </Card>
          ) : null}

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

          <div className="hidden flex-col gap-3 lg:flex">{actions}</div>
        </div>

        <div className="space-y-5">
          {/* On a laptop the steps scroll in their own box, which follows the step playing. */}
          <Card className="overflow-hidden">
            <div
              ref={listRef}
              className="p-4 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-5"
            >
              <StepChecklist
                steps={skill.steps}
                orderMatters={skill.order_matters}
                onPlay={available ? player.play : undefined}
                activeId={available ? current.id : null}
              />
            </div>
          </Card>

          <div className="flex flex-col gap-3 lg:hidden">{actions}</div>
        </div>
      </div>
    </div>
  );
}
