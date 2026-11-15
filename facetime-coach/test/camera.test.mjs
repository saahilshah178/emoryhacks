import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCameraMonitor, SAMPLE_FPS } from '../camera.mjs';

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

/** The same room with nobody moving, as a real sensor sees it: every pixel jitters a little in every frame. */
let seed = 7;
function noisy(base) {
  const data = new Uint8Array(base);
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const value = Math.max(0, Math.min(255, base[i] + (seed % 7) - 3));
    data[i] = value; data[i + 1] = value; data[i + 2] = value;
  }
  return data;
}

function black() {
  const data = new Uint8Array(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
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
      for (let passed = 0; passed < ms; passed += 250) {
        clock.t += 250;
        monitor.check();
      }
    },
  };
  return run;
}

test('a moving picture turns the camera on', () => {
  const { monitor, changes, live, clock } = setup();
  const start = clock.t;
  assert.equal(monitor.on, false);
  live(500);
  assert.equal(monitor.on, false, 'half a second of movement is not yet a camera that is on');
  live(1000);
  assert.equal(monitor.on, true);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].reason, 'moving picture');
  assert.ok(changes[0].at - start < 500, 'the change is dated to when the picture started moving');
});

test('frames that stop turn the camera off, dated to the last moving picture', () => {
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

test('a picture that stops changing turns the camera off', () => {
  // What a real FaceTime line sends when the caller turns the camera off: the track stays, the picture freezes.
  const { monitor, changes, live, same, clock } = setup();
  live(2000);
  const lastMoving = clock.t;
  same(2000);
  assert.equal(monitor.on, true, 'two seconds could be a frozen connection');
  same(1000);
  assert.equal(monitor.on, false);
  assert.equal(changes.at(-1).reason, 'still picture');
  assert.equal(changes.at(-1).at, lastMoving, 'dated to the last moving picture, so the frozen tail is cut from a recording');
});

test('a room where nobody moves is still a camera that is on', () => {
  // Someone holding still for a count of five, or out of the picture fetching a chair: the sensor's noise keeps moving.
  const { monitor, changes, live, same } = setup();
  live(2000);
  const room = picture(0);
  same(20_000, () => noisy(room));
  assert.equal(monitor.on, true);
  assert.equal(changes.length, 1);
});

test('one refreshed frame now and then does not keep a frozen picture on', () => {
  const { monitor, changes, live, same } = setup();
  live(2000);
  const frozen = picture(0);
  for (let i = 0; i < 6; i++) {
    same(900, () => frozen);
    same(1, () => noisy(frozen)); // the encoder repainting the same picture
  }
  assert.equal(monitor.on, false);
  assert.equal(changes.at(-1).reason, 'still picture');
});

test('the camera comes back on after a frozen picture', () => {
  const { monitor, changes, live, same } = setup();
  live(2000);
  same(4000);
  assert.equal(monitor.on, false);
  live(1500);
  assert.equal(monitor.on, true);
  assert.deepEqual(changes.map(change => change.on), [true, false, true]);
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
  silence(750);
  assert.equal(monitor.on, false);
  assert.equal(changes.at(-1).reason, 'video muted');
  assert.equal(changes.at(-1).at, mutedAt);
});

test('pictures that resume after a gap have to move for a moment before the camera counts as on', () => {
  const { monitor, changes, live, silence, clock } = setup();
  live(2000);
  silence(4000);
  assert.equal(monitor.on, false);
  const resumed = clock.t;
  live(400);
  assert.equal(monitor.on, false, 'not on the first picture back');
  live(1000);
  assert.equal(monitor.on, true);
  assert.ok(changes.at(-1).at >= resumed, 'dated to the pictures that came back, not to the ones before the gap');
});

test('a short freeze does not turn the camera off', () => {
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
  live(350);
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
