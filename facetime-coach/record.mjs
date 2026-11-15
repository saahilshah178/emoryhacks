import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';
import { ffmpegBin } from './ffmpeg.mjs';

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 6;
const MAX_MS = 75_000;
const SAMPLE_US = BigInt(Math.round(1_000_000 / FPS));
const dir = join(dirname(fileURLToPath(import.meta.url)), '.state', 'recordings');

function scaleRgba(src, sw, sh) {
  const out = Buffer.alloc(WIDTH * HEIGHT * 4);
  const data = Buffer.isBuffer(src) ? src : Buffer.from(src);
  for (let y = 0; y < HEIGHT; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / HEIGHT));
    for (let x = 0; x < WIDTH; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * sw / WIDTH));
      data.copy(out, (y * WIDTH + x) * 4, (sy * sw + sx) * 4, (sy * sw + sx) * 4 + 4);
    }
  }
  return out;
}

function videoTrack(room) {
  for (const participant of room.remoteParticipants.values()) {
    for (const publication of participant.trackPublications.values()) {
      if (publication.kind === TrackKind.KIND_VIDEO) {
        if (!publication.subscribed) publication.setSubscribed(true);
        if (publication.track) return publication.track;
      }
    }
  }
  return null;
}

export function waitForCallerVideo(room, timeoutMs = 8000) {
  const existing = videoTrack(room);
  if (existing) return Promise.resolve(existing);
  return new Promise(resolve => {
    const timer = setTimeout(finish, timeoutMs, null);
    const onPublished = publication => {
      if (publication.kind === TrackKind.KIND_VIDEO) publication.setSubscribed(true);
    };
    const onSubscribed = (track, publication) => {
      if ((publication?.kind || track?.kind) === TrackKind.KIND_VIDEO) finish(track);
    };
    function finish(track) {
      clearTimeout(timer);
      room.off(RoomEvent.TrackPublished, onPublished);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      resolve(track || videoTrack(room));
    }
    room.on(RoomEvent.TrackPublished, onPublished);
    room.on(RoomEvent.TrackSubscribed, onSubscribed);
  });
}

function encodeMp4(frames, outPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegBin, [
      '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${WIDTH}x${HEIGHT}`, '-r', String(FPS),
      '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', chunk => { err += chunk; if (err.length > 2000) err = err.slice(-2000); });
    ff.on('error', error => reject(error));
    ff.on('close', code => {
      if (code === 0) resolve(outPath);
      else reject(new Error(err.trim() || `ffmpeg exited ${code}`));
    });
    for (const frame of frames) ff.stdin.write(frame);
    ff.stdin.end();
  });
}

export async function startCallerRecording(room) {
  const track = await waitForCallerVideo(room);
  if (!track) {
    return { error: 'I cannot see you yet. Call back with FaceTime Video, not audio-only, and keep the camera on the skill.' };
  }
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mp4 = join(dir, `${stamp}.mp4`);
  const frames = [];
  const stream = new VideoStream(track);
  const reader = stream.getReader();
  let last = 0n;
  let stopped = false;
  const started = Date.now();

  const loop = (async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done || !value?.frame) break;
        if (value.timestampUs - last < SAMPLE_US && frames.length) continue;
        last = value.timestampUs;
        const rgba = value.frame.convert(VideoBufferType.RGBA);
        frames.push(scaleRgba(rgba.data, rgba.width, rgba.height));
        if (Date.now() - started > MAX_MS) break;
      }
    } catch {
      /* track ended */
    } finally {
      await reader.cancel().catch(() => {});
    }
  })();

  return {
    error: null,
    started,
    async stop() {
      if (stopped) return this._result;
      stopped = true;
      await loop;
      if (frames.length < 4) {
        this._result = { error: 'The recording was too short. Stay in FaceTime Video and try again.' };
        return this._result;
      }
      try {
        await encodeMp4(frames, mp4);
        this._result = { path: mp4, frames, duration_s: frames.length / FPS };
        return this._result;
      } catch {
        const stills = [];
        const step = Math.max(1, Math.floor(frames.length / 16));
        for (let i = 0; i < frames.length && stills.length < 16; i += step) {
          const png = new PNG({ width: WIDTH, height: HEIGHT });
          frames[i].copy(png.data);
          stills.push(PNG.sync.write(png));
        }
        const stillPath = join(dir, `${stamp}-stills.json`);
        await writeFile(stillPath, JSON.stringify({ count: stills.length, duration_s: frames.length / FPS }));
        this._result = { stills, duration_s: frames.length / FPS, path: null };
        return this._result;
      }
    },
  };
}
