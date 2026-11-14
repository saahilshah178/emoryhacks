// How big a video can be sent, and where it is sent.
//
// On a laptop the web app forwards uploads to the API itself and the API's own limit applies.
// The hosted web app sits behind a proxy that refuses request bodies above about 20 MB, so
// there the API hands out its own address and a short-lived upload ticket (see uploadTarget in
// api.ts) and the browser sends the file straight to it. The API says which case applies and
// how large a file may be; until it has been asked, the cautious figure below is used.

/**
 * What a recording made in the browser is kept under (see recorder.ts), and the limit assumed
 * before the API has said otherwise. 19 MB (decimal) fits through a 20 MB proxy with room for
 * the multipart wrapping, so a recording can always be sent, whichever way uploads travel.
 */
export const MAX_UPLOAD_BYTES = 19_000_000;

/** Where to POST a video. url and token are null when it goes through the web app's own /api. */
export type UploadTarget = { url: string | null; token: string | null; max_bytes: number };

let knownLimit: number | null = null;

/** The largest file that can be sent, as far as is known. */
export function uploadLimit() {
  return knownLimit ?? MAX_UPLOAD_BYTES;
}

/** True once the API has said how large a file may be. */
export function uploadLimitKnown() {
  return knownLimit !== null;
}

export function rememberUploadLimit(bytes: number) {
  if (Number.isFinite(bytes) && bytes > 0) knownLimit = bytes;
}

/** 24_775_163 -> "24.8 MB" */
export function formatMegabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(bytes >= 100_000_000 ? 0 : 1)} MB`;
}

/** Why a file can't be sent, in words for the person choosing it; null when it can. */
export function uploadTooLarge(bytes: number, limit = uploadLimit()): string | null {
  if (bytes <= limit) return null;
  return `This video is ${formatMegabytes(bytes)}, and the most that can be sent is ${formatMegabytes(
    limit,
  )}. Record it with the camera here, which keeps videos small, or trim the file and choose it again.`;
}
