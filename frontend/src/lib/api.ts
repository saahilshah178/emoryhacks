// The one place the app talks to the backend. Paths are relative to /api, which Next
// forwards to the FastAPI server (see next.config.ts), so the session cookie is sent
// automatically and <video>/<img> tags can use the same URLs.

import { uploadTooLarge } from "./upload";

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
 * Upload a recording. kind "reference" starts the rubric pipeline (nurses), kind "attempt"
 * starts grading against `skillId`. onProgress gets 0..1 while the file is being sent.
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
  // Refuse before sending rather than after minutes of uploading into the proxy's limit.
  const tooLarge = uploadTooLarge(args.file.size);
  if (tooLarge) return { promise: Promise.reject(new ApiError(413, tooLarge)), abort: () => undefined };

  const form = new FormData();
  form.append("file", args.file, args.filename);
  form.append("kind", args.kind);
  if (args.skillId) form.append("skill_id", args.skillId);
  if (args.expectedSlug) form.append("expected_slug", args.expectedSlug);
  if (args.expectedName) form.append("expected_name", args.expectedName);

  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve, reject) => {
    xhr.open("POST", "/api/videos");
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
  return { promise, abort: () => xhr.abort() };
}
