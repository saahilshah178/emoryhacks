import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { ffmpegBin } from './ffmpeg.mjs';

/** The longer side of the saved picture. A phone held upright is saved upright, not stretched sideways. */
const LONG_SIDE = 640;
/** A recording stops by itself here, so a call cannot wait forever on a camera that never turns off. */
export const MAX_MS = 75_000;
/** Shorter than this is a slip of the camera button, not an attempt. */
export const MIN_MS = 5_000;
const dir = join(dirname(fileURLToPath(import.meta.url)), '.state', 'recordings');

function fit(width, height) {
  const scale = LONG_SIDE / Math.max(width, height);
  const even = value => Math.max(2, Math.round(value * scale / 2) * 2);
  return { width: even(width), height: even(height) };
}

function scaleRgba(src, sw, sh, width, height) {
  const out = Buffer.alloc(width * height * 4);
  const data = Buffer.isBuffer(src) ? src : Buffer.from(src.buffer, src.byteOffset, src.byteLength);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * sw / width));
      data.copy(out, (y * width + x) * 4, (sy * sw + sx) * 4, (sy * sw + sx) * 4 + 4);
    }
  }
  return out;
}

function encodeMp4(frames, size, fps, outPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegBin, [
      '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${size.width}x${size.height}`, '-r', fps.toFixed(3),
      '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', chunk => { err += chunk; if (err.length > 2000) err = err.slice(-2000); });
    ff.on('error', error => reject(error));
    ff.stdin.on('error', () => { /* ffmpeg quit early; its exit code says why */ });
    ff.on('close', code => {
      if (code === 0) resolve(outPath);
      else reject(new Error(err.trim() || `ffmpeg exited ${code}`));
    });
    for (const frame of frames) ff.stdin.write(frame.data);
    ff.stdin.end();
  });
}

/**
 * Records the caller from the pictures the camera watcher hands out (see camera.mjs).
 * stop({ until }) drops everything after `until`: the camera is known to be off only a moment after it
 * went off, and the blank or frozen pictures in between are not part of the attempt.
 * onLimit() is called once if the recording reaches maxMs.
 */
export function startCallerRecording(camera, { maxMs = MAX_MS, minMs = MIN_MS, onLimit = () => {}, now = Date.now } = {}) {
  if (!camera.receiving) {
    return { error: 'I cannot see your camera. In FaceTime, tap the camera button so your video is on, and keep the phone pointed at you.' };
  }
  const frames = [];
  const started = now();
  let size = null;
  let stopping = null;
  const forget = camera.onFrame(frame => {
    if (stopping || frame.at - started > maxMs) return;
    size ||= fit(frame.width, frame.height);
    frames.push({ at: frame.at, data: scaleRgba(frame.data, frame.width, frame.height, size.width, size.height) });
  });
  const limit = setTimeout(() => { if (!stopping) onLimit(); }, maxMs);
  limit.unref?.();

  async function finish(until) {
    forget();
    clearTimeout(limit);
    const kept = frames.splice(0).filter(frame => !until || frame.at <= until);
    const span = kept.length > 1 ? kept[kept.length - 1].at - kept[0].at : 0;
    if (span < minMs) {
      return { tooShort: true, error: 'That was only a few seconds, too short to grade.' };
    }
    const fps = (kept.length - 1) * 1000 / span;
    const duration = kept.length / fps;
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const mp4 = join(dir, `${stamp}.mp4`);
    try {
      await encodeMp4(kept, size, fps, mp4);
      return { path: mp4, duration_s: duration };
    } catch (error) {
      console.warn('[record] could not save a video, sending still pictures instead:', error.message);
      const stills = [];
      const step = Math.max(1, Math.floor(kept.length / 16));
      for (let i = 0; i < kept.length && stills.length < 16; i += step) {
        const png = new PNG({ width: size.width, height: size.height });
        kept[i].data.copy(png.data);
        stills.push(PNG.sync.write(png));
      }
      await writeFile(join(dir, `${stamp}-stills.json`), JSON.stringify({ count: stills.length, duration_s: duration }));
      return { stills, duration_s: duration, path: null };
    }
  }

  return {
    error: null,
    started,
    /** Safe to call twice: the second call gets the first call's result. */
    stop({ until } = {}) {
      stopping ||= finish(until);
      return stopping;
    },
    /** Throw the recording away without saving it. */
    cancel() {
      stopping ||= Promise.resolve({ cancelled: true });
      forget();
      clearTimeout(limit);
      frames.length = 0;
    },
  };
}
