"use client";

import { Camera, CameraOff, Circle, FileVideo, RotateCcw, Square, Upload } from "lucide-react";
import { useId } from "react";
import { Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";
import type { useRecorder } from "@/lib/recorder";

type Recorder = ReturnType<typeof useRecorder>;

const fileButton =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[12px] px-4 text-sm font-semibold transition-colors focus-within:ring-2 focus-within:ring-teal focus-within:ring-offset-2";

/**
 * The camera stage for a reference video: live preview, record and stop, then a playback
 * of the take to keep or redo. Choosing a file is always possible, and is the way in when
 * there is no camera.
 */
export function ReferenceRecorder({
  recorder,
  onUse,
  busy,
}: {
  recorder: Recorder;
  /** "Use this video": send the take. */
  onUse: () => void;
  busy?: boolean;
}) {
  const inputId = useId();
  const { previewRef, phase, recording, problem, seconds, start, stop, reset, useFile: chooseFile } = recorder;
  const live = phase === "starting" || phase === "ready" || phase === "recording";
  const fromFile = recording !== null && recording.seconds === 0;

  const filePicker = (primary: boolean) => (
    <label
      htmlFor={inputId}
      className={cn(
        fileButton,
        primary
          ? "bg-teal text-white shadow-sm hover:bg-teal-hover"
          : "border border-teal bg-white text-teal hover:bg-teal-soft",
      )}
    >
      <FileVideo className="h-4 w-4" aria-hidden />
      {recording ? "Choose a different file" : "Choose a video file instead"}
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-[12px] border border-border bg-navy shadow-[var(--shadow-card)]">
        {live ? (
          <video
            ref={previewRef}
            muted
            playsInline
            autoPlay
            aria-label="Camera preview"
            className="aspect-video w-full bg-black object-cover"
          />
        ) : null}
        {phase === "recorded" && recording ? (
          <video
            key={recording.url}
            src={recording.url}
            controls
            playsInline
            aria-label="Your recording"
            className="aspect-video w-full bg-black object-contain"
          />
        ) : null}
        {phase === "unavailable" ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 px-6 text-center text-white">
            <CameraOff className="h-8 w-8 text-white/60" aria-hidden />
            <p className="max-w-md text-sm text-white/85">{problem ?? "The camera isn't available."}</p>
          </div>
        ) : null}

        {phase === "starting" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-navy text-sm text-white/85">
            <Spinner className="border-white/30 border-t-white" label="Starting the camera" />
            Starting the camera…
          </div>
        ) : null}
        {phase === "recording" ? (
          <div className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold tabular-nums text-white">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden />
            Recording {formatClock(seconds)}
          </div>
        ) : null}
        {phase === "ready" ? (
          <div className="absolute left-3 top-3 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
            Camera ready
          </div>
        ) : null}
      </div>

      {problem && phase !== "unavailable" ? (
        <p role="alert" className="rounded-[12px] bg-danger-bg px-3 py-2 text-sm text-danger">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {phase === "ready" ? (
          <Button onClick={start}>
            <Circle className="h-4 w-4 fill-current" aria-hidden />
            Start recording
          </Button>
        ) : null}
        {phase === "recording" ? (
          <Button variant="destructive" onClick={stop}>
            <Square className="h-4 w-4 fill-current" aria-hidden />
            Stop · {formatClock(seconds)}
          </Button>
        ) : null}
        {phase === "recorded" && recording ? (
          <>
            <Button onClick={onUse} loading={busy}>
              <Upload className="h-4 w-4" aria-hidden />
              Use this video
            </Button>
            <Button variant="secondary" onClick={reset} disabled={busy}>
              {fromFile ? <Camera className="h-4 w-4" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {fromFile ? "Record with the camera" : "Record again"}
            </Button>
          </>
        ) : null}

        {phase !== "recording" ? filePicker(phase === "unavailable") : null}
        <input
          id={inputId}
          type="file"
          accept="video/*"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) chooseFile(file);
          }}
        />
      </div>

      {phase === "recorded" && recording ? (
        <p className="text-sm text-ink-secondary">
          {fromFile
            ? `Chosen file: ${recording.filename}`
            : `Your recording · ${formatClock(recording.seconds)}`}
          {" · "}Watch it back, then use it or record again.
        </p>
      ) : null}
    </div>
  );
}
