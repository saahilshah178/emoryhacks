import { spawn } from 'node:child_process';
import { AudioFrame } from '@livekit/rtc-node';
import { ffmpegBin } from './ffmpeg.mjs';

const CHUNK_MS = 20;

function copySamples(slice) {
  const samples = new Int16Array(slice.length / 2);
  samples.set(new Int16Array(slice.buffer, slice.byteOffset, samples.length));
  return samples;
}

let player;

/** Stop the demonstration soundtrack immediately. */
export function stopDemoAudio() {
  const current = player;
  player = undefined;
  if (!current) return;
  current.stopped = true;
  try { current.ff.kill('SIGKILL'); } catch { /* already gone */ }
}

/** Play a demonstration file’s soundtrack on the agent’s existing FaceTime audio track. */
export async function playDemoAudio(filePath, sink) {
  stopDemoAudio();
  if (!filePath || !sink?.captureFrame) return;
  const sampleRate = sink.sampleRate || 24000;
  const channels = 1;
  const bytesPerChunk = Math.round(sampleRate * CHUNK_MS / 1000) * 2 * channels;
  const ff = spawn(ffmpegBin, [
    '-hide_banner', '-loglevel', 'error',
    '-i', filePath,
    '-vn', '-f', 's16le', '-ac', String(channels), '-ar', String(sampleRate),
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const current = { ff, stopped: false };
  player = current;

  let stderr = '';
  ff.stderr.on('data', chunk => { stderr += chunk; });

  let leftover = Buffer.alloc(0);
  try {
    for await (const chunk of ff.stdout) {
      if (current.stopped) break;
      leftover = Buffer.concat([leftover, chunk]);
      while (leftover.length >= bytesPerChunk) {
        if (current.stopped) break;
        const slice = leftover.subarray(0, bytesPerChunk);
        leftover = leftover.subarray(bytesPerChunk);
        const samples = copySamples(slice);
        await sink.captureFrame(new AudioFrame(samples, sampleRate, channels, samples.length / channels));
      }
    }
    if (!current.stopped && leftover.length >= 4) {
      const padded = Buffer.alloc(bytesPerChunk);
      leftover.copy(padded);
      const samples = copySamples(padded);
      await sink.captureFrame(new AudioFrame(samples, sampleRate, channels, samples.length / channels));
    }
    if (!current.stopped) sink.flush?.();
  } catch (error) {
    if (!current.stopped) {
      ff.kill('SIGKILL');
      throw error;
    }
  } finally {
    if (player === current) player = undefined;
  }
  const code = await new Promise(resolve => ff.on('close', resolve));
  if (!current.stopped && code && code !== 0) {
    console.warn('[demo-audio] ffmpeg could not play the demonstration soundtrack', stderr.trim() || code);
  }
}
