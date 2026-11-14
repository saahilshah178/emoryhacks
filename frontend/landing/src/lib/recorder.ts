// Recording from the device camera with MediaRecorder. Works on a laptop webcam and on a
// phone. The backend converts whatever container the browser produces, so the recorded
// blob is uploaded as it is.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderPhase = "starting" | "ready" | "recording" | "recorded" | "unavailable";

export type Recording = { blob: Blob; url: string; seconds: number; filename: string };

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(mime: string) {
  return mime.includes("mp4") ? "mp4" : "webm";
}

/**
 * Camera preview and recording.
 *
 *   const r = useRecorder({ facingMode: "user" });
 *   <video ref={r.previewRef} muted playsInline autoPlay />
 *   r.start(); r.stop();            // -> r.recording = { blob, url, seconds, filename }
 *   r.reset();                      // discard and go back to the live preview
 *   r.useFile(file);                // use a video file instead of the camera
 *
 * phase "unavailable" means there is no camera or permission was refused; `problem` says
 * which, in words for the user. Choosing a file still works in that case.
 */
export function useRecorder(options: { facingMode?: "user" | "environment"; maxSeconds?: number } = {}) {
  const { facingMode = "user", maxSeconds = 600 } = options;
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(0);

  const [phase, setPhase] = useState<RecorderPhase>("starting");
  const [problem, setProblem] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);

  const stopTimer = useCallback(() => {
    window.clearInterval(timerRef.current);
    timerRef.current = 0;
  }, []);

  const attachPreview = useCallback(() => {
    const preview = previewRef.current;
    if (preview && streamRef.current && preview.srcObject !== streamRef.current) {
      preview.srcObject = streamRef.current;
      void preview.play().catch(() => undefined);
    }
  }, []);

  // Every state change happens once the browser has answered, never while rendering.
  const openCamera = useCallback(() => {
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const request: Promise<MediaStream> = devices?.getUserMedia
      ? devices.getUserMedia({
          video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        })
      : Promise.reject(new DOMException("No camera API", "NotSupportedError"));
    return request.then(
      (stream) => {
        streamRef.current = stream;
        attachPreview();
        setProblem(null);
        setPhase("ready");
      },
      (error: unknown) => {
        const name = error instanceof DOMException ? error.name : "";
        setProblem(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera for this site in your browser, or choose a video file instead."
            : name === "NotFoundError"
              ? "No camera was found. Connect one, or choose a video file instead."
              : name === "NotSupportedError"
                ? "This browser can't use a camera here. Choose a video file instead."
                : "The camera couldn't be started. Close other apps that use it, or choose a video file instead.",
        );
        setPhase("unavailable");
      },
    );
  }, [attachPreview, facingMode]);

  const closeCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void openCamera().then(() => {
      if (cancelled) closeCamera();
    });
    return () => {
      cancelled = true;
      stopTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.stop();
      }
      closeCamera();
    };
  }, [openCamera, closeCamera, stopTimer]);

  // The preview element may mount after the stream is ready (or be remounted).
  useEffect(() => {
    if (phase === "ready" || phase === "recording") attachPreview();
  });

  const finish = useCallback(
    (mime: string) => {
      stopTimer();
      const elapsed = Math.max(1, Math.round((performance.now() - startedAtRef.current) / 1000));
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      if (blob.size === 0) {
        setProblem("Nothing was recorded. Please try again.");
        setPhase("ready");
        return;
      }
      setRecording({
        blob,
        url: URL.createObjectURL(blob),
        seconds: elapsed,
        filename: `recording.${extensionFor(mime)}`,
      });
      setPhase("recorded");
    },
    [stopTimer],
  );

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const start = useCallback(() => {
    const stream = streamRef.current;
    const mime = pickMime();
    if (!stream || typeof MediaRecorder === "undefined") {
      setProblem("Recording isn't supported in this browser. Choose a video file instead.");
      setPhase("unavailable");
      return;
    }
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      setProblem("Recording couldn't start. Choose a video file instead.");
      setPhase("unavailable");
      return;
    }
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => finish(recorder.mimeType || mime || "video/webm");
    recorder.start(250);
    recorderRef.current = recorder;
    startedAtRef.current = performance.now();
    setSeconds(0);
    setProblem(null);
    setPhase("recording");
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds) stop();
    }, 250);
  }, [finish, maxSeconds, stop]);

  const discard = useCallback(() => {
    setRecording((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setSeconds(0);
  }, []);

  const reset = useCallback(() => {
    discard();
    if (streamRef.current) {
      setPhase("ready");
    } else {
      setPhase("starting");
      void openCamera();
    }
  }, [discard, openCamera]);

  const useFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("video/") && !/\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(file.name)) {
        setProblem("That file isn't a video. Choose an MP4, MOV or WebM file.");
        return;
      }
      stop();
      discard();
      setProblem(null);
      setRecording({ blob: file, url: URL.createObjectURL(file), seconds: 0, filename: file.name });
      setPhase("recorded");
    },
    [discard, stop],
  );

  return { previewRef, phase, problem, seconds, recording, start, stop, reset, useFile };
}
