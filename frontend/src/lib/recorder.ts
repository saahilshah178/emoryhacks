// Recording from the device camera with MediaRecorder. Works on a laptop webcam and on a
// phone. The backend converts whatever container the browser produces, so the recorded
// blob is uploaded as it is.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkUploadSize } from "./api";
import { MAX_UPLOAD_BYTES, uploadTooLarge } from "./upload";

export type RecorderPhase = "starting" | "ready" | "recording" | "recorded" | "unavailable";

export type Recording = {
  blob: Blob;
  url: string;
  seconds: number;
  filename: string;
  /** The recorder stopped it at RECORDING_MAX_SECONDS rather than the person pressing Stop. */
  stoppedAtLimit?: boolean;
};

// Size budget. Left to itself the browser records 1280x720 at 2.5 Mbps or more, about 20 MB
// a minute, which the live site's upload limit (MAX_UPLOAD_BYTES, 19 MB) can't take.
//
//   video  450,000 bit/s + audio 32,000 bit/s = 482,000 bit/s = 60,250 bytes/s
//   x 240 s (RECORDING_MAX_SECONDS)          = 14.5 MB nominal
//
// Browsers treat these as targets; WebM/MP4 framing adds about 1% and busy scenes can run
// over by 10-20%, which still lands at 16-17.5 MB, under MAX_UPLOAD_BYTES. (In Chrome, real
// care footage at 854x480 came out near 330 kbit/s; a picture of pure noise overshot to
// about 1 Mbit/s, which is why the recorder also stops on size, below.)
//
// Why that is enough to grade: grading looks at about one frame a second and pose tracking
// scales frames down to a few hundred pixels before finding limbs, so 854x480 keeps people,
// hands and limbs clearly visible. 24 frames a second instead of 30 gives each frame about a
// quarter more bits. 32 kbit/s Opus/AAC is plenty for speech.
export const RECORDING_WIDTH = 854;
export const RECORDING_HEIGHT = 480;
export const RECORDING_FPS = 24;
export const VIDEO_BITS_PER_SECOND = 450_000;
export const AUDIO_BITS_PER_SECOND = 32_000;
/** A recording stops by itself at 4 minutes, which keeps it under MAX_UPLOAD_BYTES. */
export const RECORDING_MAX_SECONDS = 240;
/** A countdown shows for this long before the limit. */
export const RECORDING_WARN_SECONDS = 30;
/** A recording also stops this far below MAX_UPLOAD_BYTES, should the browser overshoot badly. */
const SIZE_MARGIN_BYTES = 500_000;

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
 * which, in words for the user. Choosing a file still works in that case. A file that isn't
 * a video, or is too large to send (MAX_UPLOAD_BYTES), is refused and `fileProblem` says why.
 *
 * A recording stops by itself at maxSeconds; `remaining` counts down to it, and `warning`
 * turns true for the last RECORDING_WARN_SECONDS so the screen can show the countdown.
 */
export function useRecorder(options: { facingMode?: "user" | "environment"; maxSeconds?: number } = {}) {
  const { facingMode = "user", maxSeconds = RECORDING_MAX_SECONDS } = options;
  const limitHitRef = useRef(false);
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(0);
  const cameraRequestRef = useRef(0);

  const [phase, setPhase] = useState<RecorderPhase>("starting");
  const [problem, setProblem] = useState<string | null>(null);
  // Why the last chosen file was refused (not a video, or too large to send). Kept apart from
  // `problem` so the camera's own message stays in place.
  const [fileProblem, setFileProblem] = useState<string | null>(null);
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

  // Every state change happens once the browser has answered, never while rendering. Each
  // request takes a number; closing the camera moves the number on, so a request that is
  // answered after the camera was closed (the screen was left, or React's development mode
  // mounted it twice) stops its stream at once instead of leaving the camera on.
  const openCamera = useCallback(() => {
    const requestId = ++cameraRequestRef.current;
    const current = () => requestId === cameraRequestRef.current;
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const request: Promise<MediaStream> = devices?.getUserMedia
      ? devices.getUserMedia({
          video: {
            facingMode,
            width: { ideal: RECORDING_WIDTH },
            height: { ideal: RECORDING_HEIGHT },
            frameRate: { ideal: RECORDING_FPS, max: 30 },
          },
          audio: true,
        })
      : Promise.reject(new DOMException("No camera API", "NotSupportedError"));
    return request.then(
      (stream) => {
        if (!current()) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        attachPreview();
        setProblem(null);
        setPhase("ready");
      },
      (error: unknown) => {
        if (!current()) return;
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
    cameraRequestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    void openCamera();
    return () => {
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
      // The camera isn't needed to watch the take back, so it is switched off; reset() turns
      // it on again for another take.
      closeCamera();
      setRecording({
        blob,
        url: URL.createObjectURL(blob),
        seconds: elapsed,
        filename: `recording.${extensionFor(mime)}`,
        stoppedAtLimit: limitHitRef.current,
      });
      setPhase("recorded");
    },
    [closeCamera, stopTimer],
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
      recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
    } catch {
      setProblem("Recording couldn't start. Choose a video file instead.");
      setPhase("unavailable");
      return;
    }
    chunksRef.current = [];
    let bytes = 0;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
      bytes += event.data.size;
      // Bitrates are only targets, and a very busy picture can overshoot them, so the size
      // itself is watched too: stop before the take could no longer be sent.
      if (bytes >= MAX_UPLOAD_BYTES - SIZE_MARGIN_BYTES && !limitHitRef.current && recorder.state === "recording") {
        limitHitRef.current = true;
        recorder.stop();
      }
    };
    recorder.onstop = () => finish(recorder.mimeType || mime || "video/webm");
    recorder.start(250);
    recorderRef.current = recorder;
    startedAtRef.current = performance.now();
    limitHitRef.current = false;
    setSeconds(0);
    setProblem(null);
    setFileProblem(null);
    setPhase("recording");
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= maxSeconds && !limitHitRef.current) {
        limitHitRef.current = true;
        stop();
      }
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
        setFileProblem("That file isn't a video. Choose an MP4, MOV or WebM file.");
        return;
      }
      const accept = () => {
        stop();
        closeCamera();
        discard();
        setProblem(null);
        setFileProblem(null);
        setRecording({ blob: file, url: URL.createObjectURL(file), seconds: 0, filename: file.name });
        setPhase("recorded");
      };
      // A file above the cautious limit may still be fine where uploads go straight to the
      // API, so the API is asked before it is refused.
      if (!uploadTooLarge(file.size)) {
        accept();
        return;
      }
      setFileProblem(null);
      void checkUploadSize(file.size).then(
        (tooLarge) => (tooLarge ? setFileProblem(tooLarge) : accept()),
        () => setFileProblem(uploadTooLarge(file.size)),
      );
    },
    [closeCamera, discard, stop],
  );

  const remaining = Math.max(0, maxSeconds - seconds);
  const warning = phase === "recording" && remaining <= RECORDING_WARN_SECONDS;

  return {
    previewRef,
    phase,
    problem,
    fileProblem,
    seconds,
    maxSeconds,
    remaining,
    warning,
    recording,
    start,
    stop,
    reset,
    useFile,
  };
}
