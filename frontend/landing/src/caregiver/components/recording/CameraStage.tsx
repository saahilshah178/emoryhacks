"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, RotateCcw, Square, UserRound } from "lucide-react";
import { Button } from "@/caregiver/components/ui/Button";
import { CoachingCue } from "@/caregiver/components/recording/CoachingCue";
import { formatTimer } from "@/caregiver/lib/format";
import { APP_NAME } from "@/config/branding";
import type { Skill } from "@/caregiver/types/skill";

type Phase = "preparing" | "ready" | "recording" | "stopped";

export function CameraStage({
  skill,
  onContinue,
  onBack,
  onRecordingReady,
}: {
  skill: Skill;
  onContinue: () => void;
  onBack: () => void;
  onRecordingReady: (objectUrl: string | null) => void;
}) {
  const liveRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>("preparing");
  const [seconds, setSeconds] = useState(0);
  const [cameraError, setCameraError] = useState(false);
  const [cue, setCue] = useState<string | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError(true);
        setPhase("ready");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (liveRef.current) {
          liveRef.current.srcObject = stream;
          await liveRef.current.play().catch(() => undefined);
        }
        window.setTimeout(() => {
          const width = liveRef.current?.videoWidth ?? 0;
          if (width === 0) setCameraError(true);
        }, 1200);
        setPhase("ready");
      } catch {
        if (!cancelled) {
          setCameraError(true);
          setPhase("ready");
        }
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      stopTimer();
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [stopTimer]);

  function startTimer() {
    setSeconds(0);
    setCue(null);
    timerRef.current = window.setInterval(() => {
      setSeconds((current) => {
        const next = current + 1;
        const match = skill.coachingCues.find((item) => item.atSeconds === next);
        if (match) setCue(match.message);
        return next;
      });
    }, 1000);
  }

  function startRecording() {
    chunksRef.current = [];
    const stream = streamRef.current;

    if (stream && typeof MediaRecorder !== "undefined") {
      try {
        const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : MediaRecorder.isTypeSupported("video/webm")
            ? "video/webm"
            : undefined;
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        recorder.start(200);
        recorderRef.current = recorder;
      } catch {
        recorderRef.current = null;
      }
    }

    setPhase("recording");
    startTimer();
  }

  function stopRecording() {
    stopTimer();
    const recorder = recorderRef.current;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      const blob = new Blob(chunksRef.current, {
        type: recorder?.mimeType || "video/webm",
      });
      const url = blob.size > 0 ? URL.createObjectURL(blob) : null;
      onRecordingReady(url);
      setPhase("stopped");
    };

    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = finish;
      try {
        recorder.stop();
      } catch {
        finish();
        return;
      }
      window.setTimeout(finish, 1200);
      return;
    }

    finish();
  }

  function retake() {
    onRecordingReady(null);
    setCue(null);
    setSeconds(0);
    setPhase("ready");
  }

  const trackingOn = phase === "ready" || phase === "recording";

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-teal">
          Your turn
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">
          Record {skill.name}
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {APP_NAME} watches body positioning to offer gentle coaching as you move.
        </p>
      </header>

      <div className="md:mx-auto md:max-w-[390px]">
        <div className="relative overflow-hidden rounded-[14px] bg-navy shadow-[0_1px_3px_rgba(23,50,77,0.12)] md:rounded-[28px]">
          <div className="relative aspect-[3/4] w-full">
            {cameraError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_30%,#238C91_0%,#17324D_62%)]">
                <span className="flex h-24 w-24 items-center justify-center rounded-full border-2 border-dashed border-teal/70 text-teal">
                  <UserRound className="h-12 w-12" aria-hidden />
                </span>
                <p className="px-6 text-center text-sm text-white/80">
                  Camera preview isn&apos;t available, so we&apos;ll use a practice
                  view. You can still record a timed run.
                </p>
              </div>
            ) : (
              <video
                ref={liveRef}
                className="absolute inset-0 h-full w-full object-cover"
                muted
                playsInline
                autoPlay
              />
            )}

            <div className="pointer-events-none absolute inset-6 border border-teal/40">
              <span className="absolute -left-1 -top-1 h-4 w-4 border-l-2 border-t-2 border-teal" />
              <span className="absolute -right-1 -top-1 h-4 w-4 border-r-2 border-t-2 border-teal" />
              <span className="absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-teal" />
              <span className="absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-teal" />
            </div>

            {phase === "recording" && cue ? <CoachingCue message={cue} /> : null}

            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-navy/90 to-transparent px-4 pb-4 pt-10">
              <p className="font-mono text-lg font-semibold tabular-nums text-white">
                {formatTimer(seconds)}
              </p>
              {trackingOn ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-card/95 px-2.5 py-1 text-[11px] font-semibold text-navy">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-teal" />
                  </span>
                  Movement tracking on
                </span>
              ) : (
                <span className="text-xs font-medium text-white/70">Preview</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {phase === "preparing" ? (
        <p className="text-center text-sm text-text-secondary">
          Getting your camera ready…
        </p>
      ) : null}

      {phase === "ready" || phase === "preparing" ? (
        <div className="flex flex-col gap-3">
          <Button
            onClick={startRecording}
            className="w-full"
            size="lg"
            disabled={phase === "preparing"}
          >
            <Circle className="h-4 w-4 fill-white" aria-hidden />
            Start Recording
          </Button>
          <Button variant="ghost" onClick={onBack} className="w-full">
            Back
          </Button>
        </div>
      ) : null}

      {phase === "recording" ? (
        <Button onClick={stopRecording} variant="destructive" className="w-full" size="lg">
          <Square className="h-4 w-4 fill-white" aria-hidden />
          Stop Recording
        </Button>
      ) : null}

      {phase === "stopped" ? (
        <div className="flex flex-col gap-3">
          <Button onClick={onContinue} className="w-full" size="lg">
            Review recording
          </Button>
          <Button variant="secondary" onClick={retake} className="w-full">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Retake
          </Button>
        </div>
      ) : null}
    </div>
  );
}
