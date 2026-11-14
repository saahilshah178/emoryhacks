// Camera recorder and file picker shared by the nurse (record.html) and caregiver
// (attempt.html) pages, plus an upload helper that reports progress.
//
//   const rec = createRecorder(document.querySelector("#recorder"), {
//     onVideo: async (file) => { ... upload it ... },   // called on "Use this video"
//   });
//
// The recorder shows a live camera preview, counts down 3-2-1, records up to
// maxSeconds, then lets the person review the clip before handing it over. A video
// file can be chosen instead at any point. The camera is released as soon as a clip
// is recorded, a file is chosen, or the page is left.
import { esc, fmtTime, pollJob, stagesHtml } from "/js/common.js";

// First supported type wins. MP4/H.264 is preferred because the server can convert it fastest.
const MIME_TYPES = [
  "video/mp4;codecs=avc1.64003E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const VIDEO_CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
const COUNTDOWN_S = 3;

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

// A sentence for the person, given a getUserMedia failure.
function cameraErrorMessage(err) {
  switch (err && err.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera permission was denied. Allow camera access in your browser's address bar and try again, or upload a video file instead.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found. Connect a camera and try again, or upload a video file instead.";
    case "NotReadableError":
    case "AbortError":
      return "The camera is busy or could not start. Close other apps that use the camera (Zoom, FaceTime, another tab) and try again.";
    default:
      return `Could not start the camera${err && err.message ? `: ${err.message}` : ""}. You can upload a video file instead.`;
  }
}

// Why recording cannot work on this page at all, or null if it can.
function recordingUnavailableReason() {
  if (!window.isSecureContext) {
    return `Camera recording only works on a secure page (https or localhost). Open the app at http://localhost:${location.port || "8000"} instead, or upload a video file.`;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return "This browser cannot use a camera. Upload a video file instead.";
  if (pickMimeType() === null) return "This browser cannot record video. Try Chrome, Edge or Safari, or upload a video file instead.";
  return null;
}

// Ask for camera and microphone; if the microphone is refused or missing, record video only.
async function openCamera() {
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: true }), audio: true };
  } catch (err) {
    if (!["NotAllowedError", "NotFoundError", "NotReadableError", "OverconstrainedError"].includes(err.name)) throw err;
    return { stream: await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS, audio: false }), audio: false };
  }
}

export function createRecorder(root, { onVideo, maxSeconds = 600 }) {
  injectStyles();
  root.classList.add("recorder");
  root.innerHTML = `
    <div class="rec-stage">
      <video class="rec-live" muted playsinline hidden></video>
      <video class="rec-review" controls playsinline hidden></video>
      <div class="rec-placeholder">
        <p>Set up the camera so the whole person and the space around them are in view.</p>
        <button class="btn primary" data-act="camera">Turn on camera</button>
      </div>
      <div class="rec-countdown" hidden></div>
      <div class="rec-timer" hidden><span class="rec-dot"></span><span class="rec-elapsed">0:00</span> / ${fmtTime(maxSeconds)}</div>
    </div>
    <p class="rec-message small" role="status"></p>
    <div class="rec-controls">
      <button class="btn primary" data-act="start" hidden>Start recording</button>
      <button class="btn primary" data-act="stop" hidden>Stop</button>
      <button class="btn primary" data-act="use" hidden>Use this video</button>
      <button class="btn" data-act="again" hidden>Record again</button>
      <label class="btn link rec-file">Upload a video file instead<input type="file" accept="video/*" hidden></label>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const live = $(".rec-live");
  const review = $(".rec-review");
  const buttons = Object.fromEntries([...root.querySelectorAll("[data-act]")].map((b) => [b.dataset.act, b]));
  const fileInput = $(".rec-file input");

  let stream = null;
  let recorder = null;
  let chunks = [];
  let clip = null; // the File the person is reviewing
  let clipFromFile = false;
  let reviewUrl = null;
  let timers = [];
  let busy = false;
  let hitLimit = false;

  function message(text, isError = false) {
    $(".rec-message").innerHTML = text ? `<span class="${isError ? "error" : "muted"}">${esc(text)}</span>` : "";
  }

  // Show exactly the buttons and panels for one state: idle, preview, countdown, recording, review.
  function show(state) {
    const visible = {
      idle: [], preview: ["start"], countdown: ["stop"], recording: ["stop"], review: ["use", "again"],
    }[state];
    for (const [act, b] of Object.entries(buttons)) b.hidden = act !== "camera" && !visible.includes(act);
    $(".rec-placeholder").hidden = state !== "idle";
    live.hidden = !["preview", "countdown", "recording"].includes(state);
    review.hidden = state !== "review";
    $(".rec-countdown").hidden = state !== "countdown";
    $(".rec-timer").hidden = state !== "recording";
    $(".rec-file").hidden = ["countdown", "recording"].includes(state);
    buttons.again.textContent = clipFromFile ? "Record instead" : "Record again";
    buttons.stop.textContent = state === "countdown" ? "Cancel" : "Stop";
  }

  function clearTimers() {
    timers.forEach((t) => clearInterval(t));
    timers = [];
  }

  function releaseCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    live.srcObject = null;
  }

  async function startCamera() {
    const reason = recordingUnavailableReason();
    if (reason) return message(reason, true);
    message("Starting the camera…");
    // getUserMedia waits silently while a browser or operating-system permission prompt is open.
    const slow = setTimeout(() => message("Still waiting for the camera. Check for a permission prompt from the browser or the operating system."), 8000);
    try {
      const opened = await openCamera();
      clearTimeout(slow);
      stream = opened.stream;
      live.srcObject = stream;
      await live.play().catch(() => {});
      show("preview");
      message(opened.audio ? "" : "Microphone unavailable: the recording will have no sound.");
    } catch (err) {
      clearTimeout(slow);
      show("idle");
      message(cameraErrorMessage(err), true);
    }
  }

  function countdownThenRecord() {
    show("countdown");
    let left = COUNTDOWN_S;
    $(".rec-countdown").textContent = left;
    const t = setInterval(() => {
      left -= 1;
      if (left > 0) { $(".rec-countdown").textContent = left; return; }
      clearTimers();
      beginRecording();
    }, 1000);
    timers.push(t);
  }

  function beginRecording() {
    const mimeType = pickMimeType();
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 128_000,
        videoKeyFrameIntervalDuration: 2000, // ignored by browsers that do not support it
      });
    } catch (err) {
      show("preview");
      return message(`This browser could not start recording: ${err.message}`, true);
    }
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = finishRecording;
    recorder.onerror = (e) => message(`Recording failed: ${e.error ? e.error.message : "unknown error"}`, true);
    recorder.start(1000); // deliver data every second so a long recording is not held in one piece
    const started = performance.now();
    hitLimit = false;
    show("recording");
    message("");
    const tick = () => {
      const elapsed = (performance.now() - started) / 1000;
      $(".rec-elapsed").textContent = fmtTime(elapsed);
      if (elapsed >= maxSeconds) {
        hitLimit = true;
        stopRecording();
      }
    };
    timers.push(setInterval(tick, 250));
  }

  function stopRecording() {
    clearTimers();
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else show(stream ? "preview" : "idle"); // stopped during the countdown
  }

  function finishRecording() {
    const type = (recorder.mimeType || chunks[0]?.type || "video/webm").split(";")[0];
    const ext = type.includes("mp4") ? "mp4" : "webm";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    recorder = null;
    releaseCamera();
    if (!chunks.length) {
      show("idle");
      return message("Nothing was recorded. Turn on the camera and try again.", true);
    }
    setClip(new File(chunks, `recording-${stamp}.${ext}`, { type }), false);
    chunks = [];
  }

  function setClip(file, fromFile) {
    clip = file;
    clipFromFile = fromFile;
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    reviewUrl = URL.createObjectURL(file);
    review.src = reviewUrl;
    show("review");
    const limit = !fromFile && hitLimit ? `Recording stopped at the ${fmtTime(maxSeconds)} limit. ` : "";
    message(fromFile ? `${file.name} · ${(file.size / 1e6).toFixed(1)} MB` : `${limit}Watch it back, then use it or record again.`);
  }

  // Chrome reports a WebM recording's duration as Infinity until it has seen the end,
  // which makes the review player's seek bar useless. Seeking far ahead fixes it.
  review.addEventListener("loadedmetadata", () => {
    if (review.duration !== Infinity) return;
    review.addEventListener("durationchange", () => { review.currentTime = 0; }, { once: true });
    review.currentTime = 1e9;
  });

  async function useClip() {
    if (busy || !clip) return;
    busy = true;
    buttons.use.disabled = buttons.again.disabled = fileInput.disabled = true;
    try {
      await onVideo(clip);
    } finally {
      busy = false;
      buttons.use.disabled = buttons.again.disabled = fileInput.disabled = false;
    }
  }

  buttons.camera.addEventListener("click", startCamera);
  buttons.start.addEventListener("click", countdownThenRecord);
  buttons.stop.addEventListener("click", stopRecording);
  buttons.use.addEventListener("click", useClip);
  buttons.again.addEventListener("click", () => { review.pause(); startCamera(); });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    if (file.type && !file.type.startsWith("video/")) return message(`${file.name} is not a video file.`, true);
    releaseCamera();
    setClip(file, true);
  });
  window.addEventListener("pagehide", () => { clearTimers(); releaseCamera(); });

  show("idle");
  const reason = recordingUnavailableReason();
  if (reason) message(reason, true);
  return { releaseCamera };
}

// An Error for the page to show; retryable says whether sending the same file again could help.
function uploadError(message, retryable) {
  return Object.assign(new Error(message), { retryable });
}

// POST a FormData to /api/videos with upload progress. Resolves with the JSON body;
// rejects with an Error whose message is the server's explanation.
export function uploadVideo(form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/videos");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.upload.onload = () => onProgress && onProgress(1);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response);
      const detail = xhr.response && xhr.response.detail;
      const fallback = xhr.status === 413 ? "That video is too large to upload." : `Upload failed (${xhr.status} ${xhr.statusText}).`;
      reject(uploadError(typeof detail === "string" ? detail : fallback, xhr.status >= 500));
    };
    xhr.onerror = () => reject(uploadError("The upload was interrupted. Check that the server is running and try again.", true));
    xhr.send(form);
  });
}

// Upload the form, then follow the pipeline job, rendering progress into panel.
// Resolves with the upload response plus the finished job; rejects with a readable Error.
export async function uploadAndWait(form, panel) {
  panel.hidden = false;
  panel.innerHTML = `
    <p class="upload-status">Uploading… 0%</p>
    <progress class="upload-progress" max="1" value="0"></progress>
    <div class="upload-stages"></div>`;
  const status = panel.querySelector(".upload-status");
  const bar = panel.querySelector(".upload-progress");
  let body;
  try {
    body = await uploadVideo(form, (fraction) => {
      bar.value = fraction;
      status.textContent = fraction < 1 ? `Uploading… ${Math.round(fraction * 100)}%` : "Uploaded. Preparing the video for playback…";
    });
  } catch (err) {
    panel.hidden = true;
    throw err;
  }
  bar.hidden = true;
  status.textContent = "Analysing the video. This can take a minute or two.";
  const job = await pollJob(body.job_id, (j) => { panel.querySelector(".upload-stages").innerHTML = stagesHtml(j); });
  if (job.status === "error") {
    status.textContent = "Analysis stopped.";
    const firstLine = String(job.error || "unknown error").split("\n")[0];
    throw uploadError(`Analysis failed: ${firstLine}`, true);
  }
  status.textContent = "Done.";
  return { ...body, job };
}

function injectStyles() {
  if (document.getElementById("recorder-styles")) return;
  const style = document.createElement("style");
  style.id = "recorder-styles";
  style.textContent = RECORDER_CSS;
  document.head.append(style);
}

const RECORDER_CSS = `
  .recorder .rec-stage { position: relative; aspect-ratio: 16 / 9; background: #2a241e; border-radius: 14px; overflow: hidden;
    display: flex; align-items: center; justify-content: center; }
  .recorder .rec-stage video { width: 100%; height: 100%; object-fit: contain; border-radius: 0; }
  .recorder .rec-live { transform: scaleX(-1); }
  .recorder .rec-placeholder { color: #efe7da; text-align: center; padding: 1.5rem; max-width: 30rem; }
  .recorder .rec-placeholder p { margin-bottom: 1rem; }
  .recorder .rec-countdown { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-family: var(--serif); font-size: 7rem; color: #fff; background: rgba(0,0,0,0.35); }
  .recorder .rec-timer { position: absolute; top: 0.75rem; left: 0.75rem; background: rgba(0,0,0,0.6); color: #fff;
    border-radius: 999px; padding: 0.2rem 0.75rem; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 0.45rem; }
  .recorder .rec-timer[hidden], .recorder .rec-countdown[hidden], .recorder [hidden] { display: none; }
  .recorder .rec-dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: #e0412f; animation: rec-blink 1s infinite; }
  @keyframes rec-blink { 50% { opacity: 0.2; } }
  .recorder .rec-controls { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; margin-top: 0.6rem; }
  .recorder .rec-file { margin: 0; color: var(--accent); font-size: 1rem; cursor: pointer; }
  .recorder .rec-message { min-height: 1.4rem; margin: 0.5rem 0 0; }
  .upload-progress { width: 100%; height: 0.6rem; accent-color: var(--accent); }
`;
