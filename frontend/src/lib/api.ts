// The one place the app talks to the backend. Paths are relative to /api, which Next
// forwards to the FastAPI server (see next.config.ts), so the session cookie is sent
// automatically and <video>/<img> tags can use the same URLs.

import { MAX_UPLOAD_BYTES, rememberUploadLimit, uploadLimit, uploadTooLarge, type UploadTarget } from "./upload";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Options = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit | null };

function messageFrom(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc, msg}]
    const first = detail[0] as { msg?: string } | undefined;
    if (first?.msg) return first.msg;
  }
  return fallback;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  if (json !== undefined) {
    init.method = init.method ?? "POST";
    init.body = JSON.stringify(json);
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    let detail: unknown;
    try {
      detail = (await response.json()).detail;
    } catch {
      detail = undefined;
    }
    const fallback =
      response.status >= 500
        ? "The server is not responding. Make sure the API is running, then try again."
        : response.statusText || "Request failed";
    throw new ApiError(response.status, messageFrom(detail, fallback));
  }
  if (response.status === 204) return null as T;
  return (await response.json()) as T;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** The stored MP4. Supports range requests, so the player can seek. */
export function videoUrl(videoId: string) {
  return `/api/videos/${videoId}/file`;
}

/** A JPEG frame of the video at `seconds`. */
export function thumbUrl(videoId: string, seconds = 0) {
  return `/api/videos/${videoId}/thumb?t=${Math.max(0, seconds).toFixed(1)}`;
}

export type UploadResult = { video_id: string; job_id: string; attempt_id: string | null };

/**
 * Where a video should be sent and how large it may be. The hosted API answers with its own
 * address and an upload ticket, so the file skips the web app's proxy and its size cap; on a
 * laptop url and token are null and the file goes to /api/videos. If the question itself fails
 * (other than for being signed out) the upload still goes through /api with the cautious limit.
 */
export async function uploadTarget(): Promise<UploadTarget> {
  try {
    const target = await api<UploadTarget>("/videos/upload-target");
    rememberUploadLimit(target.max_bytes);
    return target;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return { url: null, token: null, max_bytes: uploadLimit() };
  }
}

/** Why a chosen file can't be sent, or null. Asks the API for the limit if it isn't known yet. */
export async function checkUploadSize(bytes: number): Promise<string | null> {
  if (bytes <= uploadLimit()) return null;
  const target = await uploadTarget();
  return uploadTooLarge(bytes, target.max_bytes);
}

/**
 * Upload a recording. kind "reference" starts the rubric pipeline (nurses), kind "attempt"
 * starts grading against `skillId`. onProgress gets 0..1 while the file is being sent.
 *
 * The file goes wherever uploadTarget says. If sending it straight to the API fails before
 * any answer comes back (the address is unreachable from this browser, or was restarting) and
 * the file is small enough for the web app's proxy, it is sent once more through /api.
 */
export function uploadVideo(
  args: {
    file: Blob;
    filename: string;
    kind: "reference" | "attempt";
    skillId?: string;
    /** For a reference: keep building versions of this existing skill instead of naming a new one. */
    expectedSlug?: string;
    expectedName?: string;
  },
  onProgress?: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort: () => void } {
  let current: XMLHttpRequest | null = null;
  let aborted = false;

  const send = (url: string, token: string | null) =>
    new Promise<UploadResult>((resolve, reject) => {
      const form = new FormData();
      form.append("file", args.file, args.filename);
      form.append("kind", args.kind);
      if (args.skillId) form.append("skill_id", args.skillId);
      if (args.expectedSlug) form.append("expected_slug", args.expectedSlug);
      if (args.expectedName) form.append("expected_name", args.expectedName);

      const xhr = new XMLHttpRequest();
      current = xhr;
      xhr.open("POST", url);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.responseType = "json";
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as UploadResult);
          return;
        }
        const detail = (xhr.response as { detail?: unknown } | null)?.detail;
        reject(new ApiError(xhr.status, messageFrom(detail, "The upload failed. Please try again.")));
      };
      xhr.onerror = () =>
        reject(new ApiError(0, "The upload was interrupted. Check your connection and try again."));
      xhr.onabort = () => reject(new ApiError(0, "Upload cancelled."));
      xhr.send(form);
    });

  const run = async (): Promise<UploadResult> => {
    const target = await uploadTarget();
    // Refuse before sending rather than after minutes of uploading into a limit.
    const tooLarge = uploadTooLarge(args.file.size, target.max_bytes);
    if (tooLarge) throw new ApiError(413, tooLarge);
    if (aborted) throw new ApiError(0, "Upload cancelled.");
    if (!target.url) return send("/api/videos", null);
    try {
      return await send(target.url, target.token);
    } catch (error) {
      const noAnswer = error instanceof ApiError && error.status === 0;
      if (!noAnswer || aborted || args.file.size > MAX_UPLOAD_BYTES) throw error;
      onProgress?.(0);
      return send("/api/videos", null);
    }
  };

  return {
    promise: run(),
    abort: () => {
      aborted = true;
      current?.abort();
    },
  };
}
