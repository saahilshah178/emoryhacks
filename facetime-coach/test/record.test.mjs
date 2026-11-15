import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';
import { ffmpegBin } from '../ffmpeg.mjs';
import { startCallerRecording } from '../record.mjs';

/** A camera watcher that hands out whatever the test feeds it. */
function fakeCamera() {
  const listeners = new Set();
  return {
    receiving: true,
    onFrame(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get listening() { return listeners.size; },
    /** `seconds` of pictures, six a second, starting at `from` milliseconds. */
    feed(from, seconds, width = 64, height = 36) {
      const count = Math.round(seconds * 6);
      for (let i = 0; i < count; i++) {
        const data = new Uint8Array(width * height * 4).fill((i * 7) % 256);
        for (const listener of listeners) listener({ data, width, height, at: from + Math.round(i * 1000 / 6) });
      }
      return from + Math.round((count - 1) * 1000 / 6);
    },
  };
}

function videoSize(file) {
  const out = spawnSync(ffmpegBin, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  const size = out.match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b/);
  const duration = out.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return { width: Number(size?.[1]), height: Number(size?.[2]), seconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : NaN };
}

test('no recording starts while no pictures arrive', () => {
  const camera = fakeCamera();
  camera.receiving = false;
  const recorder = startCallerRecording(camera);
  assert.match(recorder.error, /cannot see your camera/);
  assert.equal(camera.listening, 0);
});

test('stopping does not wait for another picture, and saves what was recorded', async () => {
  const camera = fakeCamera();
  const recorder = startCallerRecording(camera, { now: () => 0 });
  camera.feed(0, 8);
  // The camera is off now: no more pictures will ever come. The old recorder hung here.
  const capture = await recorder.stop();
  assert.ok(capture.path, 'a video was saved');
  const video = videoSize(capture.path);
  assert.deepEqual([video.width, video.height], [640, 360]);
  assert.ok(Math.abs(video.seconds - 8) < 0.6, `about 8 seconds, got ${video.seconds}`);
  assert.ok(Math.abs(capture.duration_s - 8) < 0.3);
  assert.equal(camera.listening, 0);
  await rm(capture.path);
});

test('pictures after the camera went off are cut from the end', async () => {
  const camera = fakeCamera();
  const recorder = startCallerRecording(camera, { now: () => 0 });
  const lastReal = camera.feed(0, 10);
  camera.feed(lastReal + 167, 3); // the frozen placeholder, before the watcher was sure
  const capture = await recorder.stop({ until: lastReal });
  assert.ok(Math.abs(capture.duration_s - 10) < 0.3, `10 seconds kept, got ${capture.duration_s}`);
  await rm(capture.path);
});

test('a phone held upright is saved upright', async () => {
  const camera = fakeCamera();
  const recorder = startCallerRecording(camera, { now: () => 0 });
  camera.feed(0, 6, 90, 160);
  const capture = await recorder.stop();
  const video = videoSize(capture.path);
  assert.deepEqual([video.width, video.height], [360, 640]);
  await rm(capture.path);
});

test('a few seconds is too short to grade', async () => {
  const camera = fakeCamera();
  const recorder = startCallerRecording(camera, { now: () => 0 });
  camera.feed(0, 3);
  const capture = await recorder.stop();
  assert.equal(capture.tooShort, true);
  assert.equal(capture.path, undefined);
});

test('stop is safe to call twice', async () => {
  const camera = fakeCamera();
  const recorder = startCallerRecording(camera, { now: () => 0 });
  camera.feed(0, 3);
  assert.equal(await recorder.stop(), await recorder.stop());
});

test('the limit is reported once, and nothing past it is kept', async () => {
  const camera = fakeCamera();
  let limits = 0;
  const recorder = startCallerRecording(camera, { now: () => 0, maxMs: 6000, minMs: 1000, onLimit: () => { limits += 1; } });
  camera.feed(0, 9);
  const capture = await recorder.stop();
  assert.ok(capture.duration_s <= 6.4, `kept ${capture.duration_s}s of a 6s limit`);
  assert.equal(limits, 0, 'the limit timer was cleared by stop');
  await rm(capture.path);

  const second = startCallerRecording(camera, { maxMs: 30, onLimit: () => { limits += 1; } });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(limits, 1);
  second.cancel();
});

test('cancel throws the recording away', async () => {
  const camera = fakeCamera();
  const recorder = startCallerRecording(camera, { now: () => 0 });
  camera.feed(0, 8);
  recorder.cancel();
  assert.equal(camera.listening, 0);
  assert.deepEqual(await recorder.stop(), { cancelled: true });
});
