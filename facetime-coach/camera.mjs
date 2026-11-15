// Watches the caller's camera, so the coach never has to hear "I'm done".
// On FaceTime the caller turns the camera off to say "I have finished this part" and on again to say "watch me now".
//
// Chert's bridge publishes the caller's camera as the track facetime-remote-video and, when the camera goes off,
// mutes or removes that track (docs.trychert.com/facetime-cli/video: "Handle camera mute, track removal, and
// replacement"). Those are the signals. Two more count as off, for a camera that is lost without either: frames
// stop arriving, or the picture goes blank (a covered lens, black frames).
// A picture that merely holds still is a camera that is on: someone standing still, or out of the room.
// Each change is logged with the signal that caused it.
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';

function milliseconds(name, fallback) {
  const value = Number(process.env[name] || NaN);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const SAMPLE_FPS = 6;
const SAMPLE_MS = 1000 / SAMPLE_FPS;
const GRID_W = 64;
const GRID_H = 36;

export const DEFAULTS = {
  // The track was muted or removed: the documented signal, so a short wait (tracks can flap) is enough.
  explicitMs: 500,
  // No picture for this long (no frames, or only blank ones) also means the camera is off.
  // Long enough to ride out a frozen connection, which freezes video for a second or two.
  deadMs: milliseconds('CAMERA_OFF_MS', 2500),
  // A picture for this long means the camera is on.
  liveMs: 800,
  // Pictures further apart than this belong to different runs.
  runGapMs: 600,
  // A picture this flat or this dark shows nothing: a covered lens or a black frame.
  blankSpread: 4,
  blankMean: 10,
};

/** Brightness of a GRID_W x GRID_H grid of points, taken straight from the RGBA picture. */
export function lumaGrid(data, width, height) {
  const grid = new Uint8Array(GRID_W * GRID_H);
  for (let gy = 0; gy < GRID_H; gy++) {
    const y = Math.min(height - 1, Math.floor((gy + 0.5) * height / GRID_H));
    for (let gx = 0; gx < GRID_W; gx++) {
      const x = Math.min(width - 1, Math.floor((gx + 0.5) * width / GRID_W));
      const i = (y * width + x) * 4;
      grid[gy * GRID_W + gx] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }
  }
  return grid;
}

/** True when the picture shows nothing at all. */
export function isBlank(data, width, height, limits = DEFAULTS) {
  const grid = lumaGrid(data, width, height);
  let sum = 0;
  for (const value of grid) sum += value;
  const mean = sum / grid.length;
  let squares = 0;
  for (const value of grid) squares += (value - mean) ** 2;
  return Math.sqrt(squares / grid.length) < limits.blankSpread || mean < limits.blankMean;
}

/**
 * The decision, kept apart from LiveKit so it can be tested with made-up pictures and a made-up clock.
 * Feed it pictures with frame(), track changes with setTrack(), and call check() on a timer.
 * onChange({ on, reason, at }) fires once per change; `at` is when the picture actually came or went,
 * which is earlier than the moment it was decided.
 */
export function createCameraMonitor({ onChange = () => {}, now = Date.now, limits: overrides = {} } = {}) {
  const limits = { ...DEFAULTS, ...overrides };
  let on = false;
  let reason = 'no picture yet';
  let explicit = 'no video track';
  let explicitSince = now();
  let lastFrameAt = 0;
  let lastSeenAt = 0; // the last picture that showed something
  let runStart = 0;

  function change(next, why, at) {
    if (on === next) return;
    on = next;
    reason = why;
    onChange({ on, reason, at });
  }

  function check() {
    const t = now();
    if (explicit) {
      if (on && t - explicitSince >= limits.explicitMs) change(false, explicit, explicitSince);
      return;
    }
    if (on) {
      if (t - lastSeenAt < limits.deadMs) return;
      change(false, t - lastFrameAt >= limits.deadMs / 2 ? 'frames stopped' : 'blank picture', lastSeenAt);
    } else if (runStart && lastSeenAt - runStart >= limits.liveMs && t - lastSeenAt <= limits.runGapMs) {
      change(true, 'picture arriving', runStart);
    }
  }

  return {
    get on() { return on; },
    get reason() { return reason; },
    /** True while pictures are arriving at all, whatever they show. */
    get receiving() { return !explicit && lastFrameAt > 0 && now() - lastFrameAt < limits.deadMs; },
    /** `why` names an explicit reason there is no video (muted, no track), or is empty when there is a track. */
    setTrack(why) {
      const next = why || '';
      if (next === explicit) return;
      explicit = next;
      explicitSince = now();
      if (!next) runStart = 0;
      check();
    },
    /** One sampled picture. Returns true when it showed something. */
    frame(data, width, height) {
      const t = now();
      lastFrameAt = t;
      const seen = !isBlank(data, width, height, limits);
      if (seen) {
        if (!runStart || t - lastSeenAt > limits.runGapMs) runStart = t;
        lastSeenAt = t;
      }
      check();
      return seen;
    },
    check,
  };
}

const isVideo = publication => publication?.kind === TrackKind.KIND_VIDEO;

/**
 * Watches one caller's camera in a LiveKit room.
 * Returns { on, reason, receiving, onFrame(listener), close() }. Frame listeners get every sampled picture
 * ({ data, width, height, at }), about SAMPLE_FPS a second: the recorder uses them, so there is one reader of the track.
 */
export function watchCamera(room, { identity, onChange = () => {}, log = () => {}, now = Date.now, limits } = {}) {
  const listeners = new Set();
  const monitor = createCameraMonitor({
    now,
    limits,
    onChange: change => {
      log(`[camera] ${change.on ? 'on' : 'off'} (${change.reason})`);
      onChange(change);
    },
  });
  let closed = false;
  let publication = null;
  let track = null;
  let reader = null;
  let lastSampleAt = 0;

  const mine = participant => !identity || participant?.identity === identity;

  function detach() {
    const old = reader;
    reader = null;
    track = null;
    old?.cancel().catch(() => {});
  }

  async function pump(current, stream) {
    const own = stream.getReader();
    reader = own;
    let first = true;
    try {
      for (;;) {
        const { done, value } = await own.read();
        if (done || closed || track !== current) break;
        if (!value?.frame) continue;
        const t = now();
        if (t - lastSampleAt < SAMPLE_MS - 8) continue;
        lastSampleAt = t;
        const rgba = value.frame.convert(VideoBufferType.RGBA);
        if (first) { first = false; log(`[camera] first picture, ${rgba.width}x${rgba.height}`); }
        monitor.frame(rgba.data, rgba.width, rgba.height);
        for (const listener of listeners) listener({ data: rgba.data, width: rgba.width, height: rgba.height, at: t });
      }
    } catch (error) {
      if (!closed && track === current) log(`[camera] stopped reading the video: ${error?.message || error}`);
    } finally {
      await own.cancel().catch(() => {});
      if (track === current) { reader = null; track = null; refresh(); }
    }
  }

  function attach(next, nextPublication) {
    if (closed || !next || track === next) return;
    detach();
    track = next;
    publication = nextPublication || publication;
    log('[camera] reading the caller\'s video');
    void pump(next, new VideoStream(next));
  }

  function find() {
    for (const participant of room.remoteParticipants.values()) {
      if (!mine(participant)) continue;
      for (const candidate of participant.trackPublications.values()) {
        if (!isVideo(candidate)) continue;
        if (!candidate.subscribed) candidate.setSubscribed(true);
        publication = candidate;
        if (candidate.track) attach(candidate.track, candidate);
        return;
      }
    }
  }

  function refresh() {
    if (closed) return;
    if (!track) monitor.setTrack('no video track');
    else if (publication?.muted) monitor.setTrack('video muted');
    else monitor.setTrack('');
  }

  const onPublished = (candidate, participant) => {
    if (!mine(participant) || !isVideo(candidate)) return;
    log('[camera] video track published');
    candidate.setSubscribed(true);
    publication = candidate;
  };
  const onSubscribed = (next, candidate, participant) => {
    if (!mine(participant) || (candidate?.kind ?? next?.kind) !== TrackKind.KIND_VIDEO) return;
    attach(next, candidate);
    refresh();
  };
  const onGone = what => (first, second, third) => {
    // trackUnsubscribed is (track, publication, participant); trackUnpublished is (publication, participant).
    const candidate = third ? second : first;
    const participant = third || second;
    if (!mine(participant) || !isVideo(candidate)) return;
    log(`[camera] video track ${what}`);
    if (publication && candidate.sid !== publication.sid) return;
    if (!third) publication = null;
    detach();
    refresh();
  };
  const onMute = muted => (candidate, participant) => {
    if (!mine(participant) || !isVideo(candidate)) return;
    log(`[camera] video track ${muted ? 'muted' : 'unmuted'}`);
    publication = candidate;
    refresh();
  };
  const onAttributes = (changed, participant) => {
    if (mine(participant)) log(`[camera] caller attributes changed: ${Object.keys(changed || {}).join(', ') || 'none'}`);
  };

  const handlers = [
    [RoomEvent.TrackPublished, onPublished],
    [RoomEvent.TrackSubscribed, onSubscribed],
    [RoomEvent.TrackUnsubscribed, onGone('unsubscribed')],
    [RoomEvent.TrackUnpublished, onGone('unpublished')],
    [RoomEvent.TrackMuted, onMute(true)],
    [RoomEvent.TrackUnmuted, onMute(false)],
    [RoomEvent.ParticipantAttributesChanged, onAttributes],
  ];
  for (const [event, handler] of handlers) room.on(event, handler);
  find();
  refresh();
  if (!publication) log('[camera] the caller has no video track yet');
  const timer = setInterval(() => monitor.check(), 250);
  timer.unref?.();

  return {
    get on() { return monitor.on; },
    get reason() { return monitor.reason; },
    get receiving() { return monitor.receiving; },
    onFrame(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      for (const [event, handler] of handlers) room.off(event, handler);
      listeners.clear();
      detach();
    },
  };
}
