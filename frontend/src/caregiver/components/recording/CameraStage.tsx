"use client";

import { useEffect, useRef } from "react";
import { Circle, FileVideo, Square, VideoOff } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { PortalHeading } from "@/caregiver/components/layout/PortalHeading";
import { CoachingCue } from "@/caregiver/components/recording/CoachingCue";
import { StepChecklist } from "@/caregiver/components/recording/StepChecklist";
import { RecordingCountdown, recordingLimitNote } from "@/components/media/RecordingCountdown";
import { formatClock } from "@/lib/format";
import { useRecorder, type Recording } from "@/lib/recorder";
import type { Skill } from "@/lib/types";

/** The server needs at least this much video to grade. */
const MIN_SECONDS = 2;

/**
 * The camera preview and the record button. Nothing is analysed here: the video is
 * checked after it is uploaded. Hands the finished take (or a chosen file) to onRecorded.
 * The camera is released when this component unmounts.
 */
export function CameraStage({
  skill,
  onRecorded,
  onBack,
}: {
  skill: Skill;
  onRecorded: (recording: Recording) => void;
  onBack: () => void;
}) {
  // Destructured once: the result holds the preview ref, so its other fields are read as plain values.
  const {
    previewRef,
    phase,
    problem,
    fileProblem,
    seconds,
    remaining,
    warning,
    recording,
    start,
    stop,
    useFile: chooseFile,
  } = useRecorder({ facingMode: "user" });
  const fileInput = useRef<HTMLInputElement>(null);

  // A finished take (or a chosen file) moves the wizard on to the review step.
  useEffect(() => {
    if (recording) onRecorded(recording);
  }, [recording, onRecorded]);

  const cues = [...(skill.guide.cues ?? [])].sort((a, b) => a.at_s - b.at_s);
  const cue = phase === "recording" ? cues.filter((item) => item.at_s <= seconds).at(-1) : undefined;
  const cameraOn = phase === "ready" || phase === "recording";

  return (
    <div className="space-y-5">
      <PortalHeading
        eyebrow="Your turn"
        title={`Record ${skill.name.toLowerCase()}`}
        description="Set up the camera so your whole body and the space around you are in view. You'll watch it back before it is checked."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        {/* A phone held upright gets a tall picture; a laptop's camera is wide, so its picture is too. */}
        <div className="md:mx-auto md:w-full md:max-w-[390px] lg:mx-0 lg:max-w-none">
          <div className="relative overflow-hidden rounded-[14px] bg-navy shadow-[var(--shadow-card)] md:rounded-[28px] lg:rounded-[14px]">
            <div className="relative aspect-[3/4] w-full lg:aspect-video">
              {phase === "unavailable" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_30%,#238C91_0%,#17324D_62%)] px-6 text-center">
                  <VideoOff className="h-10 w-10 text-white/70" aria-hidden />
                  <p className="text-sm text-white/85">The camera isn&apos;t available. You can choose a video file instead.</p>
                </div>
              ) : (
                <video
                  ref={previewRef}
                  className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
                  muted
                  playsInline
                  autoPlay
                  aria-label="Camera preview"
                />
              )}

              {phase === "starting" ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <p className="text-sm text-white/80">Getting your camera ready…</p>
                </div>
              ) : null}

              {cameraOn ? (
                <div className="pointer-events-none absolute inset-6 border border-teal/40" aria-hidden>
                  <span className="absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 border-teal" />
                  <span className="absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 border-teal" />
                  <span className="absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-teal" />
                  <span className="absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-teal" />
                </div>
              ) : null}

              {cue ? <CoachingCue message={cue.message} /> : null}

              {cameraOn ? (
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-navy/90 to-transparent px-4 pb-4 pt-10">
                  <p className="font-mono text-lg font-semibold tabular-nums text-white" aria-live="off">
                    {formatClock(seconds)}
                  </p>
                  <RecordingCountdown remaining={remaining} warning={warning} className="ml-auto mr-2" />
                  {phase === "recording" ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-navy">
                      <span className="relative flex h-2 w-2" aria-hidden>
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-70" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
                      </span>
                      Recording
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-white/70">Preview</span>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {problem ? (
            <p role="alert" className="rounded-[12px] bg-warning-bg px-4 py-3 text-sm text-warning">
              {problem}
            </p>
          ) : null}
          {fileProblem ? (
            <p role="alert" className="rounded-[12px] bg-danger-bg px-4 py-3 text-sm text-danger">
              {fileProblem}
            </p>
          ) : null}

          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) chooseFile(file);
            }}
          />

          {phase === "recording" ? (
            <div className="space-y-2">
              <Button
                onClick={stop}
                variant="destructive"
                className="w-full"
                size="xl"
                disabled={seconds < MIN_SECONDS}
              >
                <Square className="h-4 w-4 fill-current" aria-hidden />
                Stop recording
              </Button>
              {seconds < MIN_SECONDS ? (
                <p className="text-center text-xs text-ink-secondary">Keep going for a moment…</p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {phase !== "unavailable" ? (
                <Button onClick={start} className="w-full" size="xl" disabled={phase !== "ready"}>
                  <Circle className="h-4 w-4 fill-current" aria-hidden />
                  Start recording
                </Button>
              ) : null}
              <Button
                variant={phase === "unavailable" ? "primary" : "secondary"}
                size={phase === "unavailable" ? "xl" : "lg"}
                className="w-full"
                onClick={() => fileInput.current?.click()}
              >
                <FileVideo className="h-4 w-4" aria-hidden />
                {phase === "unavailable" ? "Choose a video file" : "Choose a video file instead"}
              </Button>
              <Button variant="ghost" size="lg" onClick={onBack} className="w-full">
                Back
              </Button>
              {phase !== "unavailable" ? (
                <p className="text-center text-xs text-ink-secondary">{recordingLimitNote()}</p>
              ) : null}
            </div>
          )}

          {cues.length === 0 ? (
            <Card className="p-4">
              <StepChecklist
                steps={skill.steps}
                orderMatters={skill.order_matters}
                title="Steps to show"
                compact
              />
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
