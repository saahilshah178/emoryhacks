import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECK_MS, DEFAULTS, SAMPLE_FPS, createCameraMonitor, lumaGrid, sameGrid } from '../camera.mjs';

const W = 160;
const H = 90;
const STEP = 1000 / SAMPLE_FPS;

/** A textured room. `shift` moves a bright block across it, the way a person moving would. */
function picture(shift = 0) {
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inBlock = x >= 20 + shift && x < 60 + shift && y >= 20 && y < 70;
      const value = inBlock ? 220 : 40 + ((x * 3 + y * 5) % 90);
      const i = (y * W + x) * 4;
      data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
    }
  }
  return data;
}

function black() {
  const data = new Uint8Array(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return data;
}

/** ±1 on RGB: Chert re-encoding a frozen last frame. */
function jitter(src, delta = 1) {
  const data = new Uint8Array(src);
  for (let i = 0; i < data.length; i += 4) {
    const n = (i / 4) % 2 === 0 ? delta : -delta;
    data[i] = Math.max(0, Math.min(255, data[i] + n));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n));
  }
  return data;
}

function setup() {
  const clock = { t: 1_000_000 };
  const changes = [];
  const monitor = createCameraMonitor({ now: () => clock.t, onChange: change => changes.push({ ...change, decidedAt: clock.t }) });
  monitor.setTrack('');
  let shift = 0;
  const run = {
    clock,
    changes,
    monitor,
    still: () => picture(shift),
    /** A camera that is on: the picture changes in every sampled frame. */
    live(ms) {
      for (let passed = 0; passed < ms; passed += STEP) {
        clock.t += STEP;
        shift = (shift + 3) % 60;
        monitor.frame(picture(shift), W, H);
      }
    },
    /** Frames keep arriving but always show the same thing. */
    same(ms, make = () => picture(shift)) {
      for (let passed = 0; passed < ms; passed += STEP) {
        clock.t += STEP;
        monitor.frame(make(), W, H);
      }
    },
    /** No frames at all; only the timer runs. */
    silence(ms) {
      for (let passed = 0; passed < ms; passed += CHECK_MS) {
        clock.t += CHECK_MS;
        monitor.check();
      }
    },
  };
  return run;
}

test('sameGrid treats re-encode noise as the same picture', () => {
  const still = lumaGrid(picture(0), W, H);
  assert.equal(sameGrid(still, lumaGrid(jitter(picture(0)), W, H)), true);
  assert.equal(sameGrid(still, lumaGrid(picture(20), W, H)), false, 'a block that moved is not a freeze');
});

test('a picture turns the camera on', () => {
  const { monitor, changes, live, clock } = setup();
  const start = clock.t;
  assert.equal(monitor.on, false);
  live(DEFAULTS.liveMs);
  assert.equal(monitor.on, false, 'a run shorter than liveMs is not yet a camera that is on');
  live(DEFAULTS.liveMs);
  assert.equal(monitor.on, true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, 'picture arriving');
  assert.ok(changes[0].at - start <= DEFAULTS.liveMs + STEP, 'the change is dated to when the picture arrived');
});

test('frames that stop turn the camera off, dated to the last picture', () => {
  const { monitor, changes, live, silence, clock } = setup();
  live(2000);
  const lastPicture = clock.t;
  silence(2000);
  assert.equal(monitor.on, true, 'two seconds without frames is still a hiccup');
  silence(1000);
  assert.equal(monitor.on, false);
  assert.equal(changes.at(-1).reason, 'frames stopped');
  assert.equal(changes.at(-1).at, lastPicture);
});

test('a short freeze stays on; a two-second freeze is off', () => {
  const { monitor, changes, live, same, clock } = setup();
  live(2000);
  const lastMoving = clock.t;
  same(1000);
  assert.equal(monitor.on, true, 'a one-second freeze is a live caller holding still');
  same(DEFAULTS.freezeMs);
  assert.equal(monitor.on, false);
  assert.equal(changes.at(-1).reason, 'frozen picture');
  assert.equal(changes.at(-1).at, lastMoving);
});

test('re-encode jitter on a frozen frame is still camera-off', () => {
  const run = setup();
  run.live(2000);
  run.same(DEFAULTS.freezeMs + STEP, () => jitter(run.still()));
  assert.equal(run.monitor.on, false);
  assert.equal(run.changes.at(-1).reason, 'frozen picture');
});

test('a picture that keeps changing stays on', () => {
  const { monitor, changes, live } = setup();
  live(2000);
  live(DEFAULTS.freezeMs + 1000);
  assert.equal(monitor.on, true);
  assert.equal(changes.length, 1);
});

test('a black picture turns the camera off, dated to the last real picture', () => {
  const { monitor, changes, live, same, clock } = setup();
  live(2000);
  const lastReal = clock.t;
  same(3000, black);
  assert.equal(monitor.on, false);
  assert.equal(changes.at(-1).reason, 'blank picture');
  assert.equal(changes.at(-1).at, lastReal);
});

test('a muted or removed track turns the camera off quickly', () => {
  const { monitor, changes, live, silence, clock } = setup();
  live(2000);
  const mutedAt = clock.t;
  monitor.setTrack('video muted');
  assert.equal(monitor.on, true, 'not at once: tracks flap');
  silence(DEFAULTS.explicitMs);
  assert.equal(monitor.on, false);
  assert.equal(changes.at(-1).reason, 'video muted');
  assert.equal(changes.at(-1).at, mutedAt);
});

test('a short gap in frames does not turn the camera off', () => {
  const { monitor, changes, live, silence } = setup();
  live(2000);
  silence(1500);
  live(1000);
  assert.equal(monitor.on, true);
  assert.equal(changes.length, 1);
});

test('a flicker while the camera is off does not turn it on', () => {
  const { monitor, changes, live, same } = setup();
  live(2000);
  same(3000, black);
  assert.equal(monitor.on, false);
  live(DEFAULTS.liveMs);
  same(2000, black);
  assert.equal(monitor.on, false);
  assert.equal(changes.length, 2);
});

test('the camera comes back on after it was off', () => {
  const { monitor, changes, live, silence } = setup();
  live(2000);
  monitor.setTrack('no video track');
  silence(1000);
  assert.equal(monitor.on, false);
  monitor.setTrack('');
  live(1500);
  assert.equal(monitor.on, true);
  assert.deepEqual(changes.map(change => change.on), [true, false, true]);
});

test('nothing turns the camera on while its track is muted', () => {
  const { monitor, live } = setup();
  monitor.setTrack('video muted');
  live(3000);
  assert.equal(monitor.on, false);
});

test('receiving says whether pictures arrive at all', () => {
  const { monitor, live, same, silence } = setup();
  assert.equal(monitor.receiving, false);
  live(1000);
  assert.equal(monitor.receiving, true);
  same(4000, black);
  assert.equal(monitor.on, false);
  assert.equal(monitor.receiving, true, 'black pictures are still arriving');
  silence(3000);
  assert.equal(monitor.receiving, false);
});
