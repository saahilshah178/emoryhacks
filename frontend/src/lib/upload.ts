// How big a video can be sent. The live site's API sits behind a proxy that refuses request
// bodies above about 20 MB, so anything larger fails there after a long upload. This is the
// one place the limit is set: the recorder, the file pickers and uploadVideo all read it.
// 19 MB (decimal) leaves room for the multipart wrapping and for "20 MB" meaning 20,000,000.

export const MAX_UPLOAD_BYTES = 19_000_000;

/** 24_775_163 -> "24.8 MB" */
export function formatMegabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** Why a file can't be sent, in words for the person choosing it; null when it can. */
export function uploadTooLarge(bytes: number): string | null {
  if (bytes <= MAX_UPLOAD_BYTES) return null;
  return `This video is ${formatMegabytes(bytes)}, and the most that can be sent is ${formatMegabytes(
    MAX_UPLOAD_BYTES,
  )}. Record it with the camera here, which keeps videos small, or trim the file and choose it again.`;
}
