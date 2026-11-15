// Watches the caller's camera, so the coach never has to hear "I'm done".
// On FaceTime the caller turns the camera off to say "I have finished this part" and on again to say "watch me now".
//
// Chert's bridge publishes the caller's camera as the track facetime-remote-video and, when the camera goes off,
// mutes or removes that track (docs.trychert.com/facetime-cli/video: "Handle camera mute, track removal, and
// replacement"). Those are the signals. This line often does not mute: it keeps sending the last live frame,
// re-encoded, so consecutive samples are not bit-identical. sameGrid() treats luma grids within a mean absolute
// difference of 2 as the same picture, and only when few grid cells jumped. A live caller who is mostly still
// still moves in part of the frame (a face, a hand); that is not a freeze. CAMERA_FREEZE_MS (~2s) of a picture
// that matches the last moving frame is camera-off, dated to that frame. Two more count as off: frames stop
// arriving, or the picture goes blank (a covered lens, black frames).
// Each change is logged with the signal that caused it.
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';

function milliseconds(name, fallback) {
  const value = Number(process.env[name] || NaN);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const SAMPLE_FPS = 12;
export const CHECK_MS = 50;
const SAMPLE_MS = 1000 / SAMPLE_FPS;
const GRID_W = 64;
const GRID_H = 36;
const SAME_MEAN = 2;
/** A cell that jumped by this much has real motion, not re-encode noise. */
const MOVE_CELL = 6;
/** This many moved cells in the 64×36 grid is a live picture, even if the mean barely changed. */
const MOVE_CELLS = 8;
const BRIDGE_PREFIX = 'chert-bridge-';
const CALLER_TRACK = 'facetime-remote-video';

export const DEFAULTS = {
  // The track was muted or removed: the documented signal, so a short wait (tracks can flap) is enough.
  explicitMs: 80,
  // No picture for this long (no frames, or only blank ones) also means the camera is off.
  // Long enough to ride out a frozen connection, which freezes video for a second or two.
  deadMs: milliseconds('CAMERA_OFF_MS', 2500),
  // A picture for this long means the camera is on.
  liveMs: 800,
  // Pictures further apart than this belong to different runs.
  runGapMs: 600,
  // The same picture for this long: FaceTime camera-off as a frozen last frame.
  // Short freezes are a live caller holding still, not the camera button.
  freezeMs: milliseconds('CAMERA_FREEZE_MS', 2000),
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

/**
 * True when two luma grids are the same picture, including Chert re-encode noise.
 * Mean abs diff ≤ 2 is not enough on its own: a live face is a few cells in a still room, so the mean
 * barely moves. Cells that jumped by MOVE_CELL are real motion.
 */
export function sameGrid(a, b, maxMeanAbs = SAME_MEAN) {
  if (!a || !b || a.length !== b.length) return false;
  let abs = 0;
  let moved = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    abs += d;
    if (d >= MOVE_CELL) moved += 1;
  }
  return abs / a.length <= maxMeanAbs && moved < MOVE_CELLS;
}

function isBlankGrid(grid, limits) {
  let sum = 0;
  for (const value of grid) sum += value;
  const mean = sum / grid.length;
  let squares = 0;
  for (const value of grid) squares += (value - mean) ** 2;
  return Math.sqrt(squares / grid.length) < limits.blankSpread || mean < limits.blankMean;
}

/** True when the picture shows nothing at all. */
export function isBlank(data, width, height, limits = DEFAULTS) {
  return isBlankGrid(lumaGrid(data, width, height), limits);
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
  let lastMovingAt = 0; // the last picture that was not the same as the one before
  let lastGrid = null;
  let movingGrid = null; // last live picture; freeze must still match this, not only the previous sample
  let lastFrozen = false;
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
      if (lastFrozen && lastSeenAt - lastMovingAt >= limits.freezeMs && t - lastFrameAt <= limits.runGapMs) {
        change(false, 'frozen picture', lastMovingAt);
        runStart = 0;
        return;
      }
      if (t - lastSeenAt < limits.deadMs) return;
      change(false, t - lastFrameAt >= limits.deadMs / 2 ? 'frames stopped' : 'blank picture', lastSeenAt);
    } else if (runStart && lastMovingAt - runStart >= limits.liveMs && t - lastMovingAt <= limits.runGapMs) {
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
      const grid = lumaGrid(data, width, height);
      const seen = !isBlankGrid(grid, limits);
      if (seen) {
        const frozen = sameGrid(lastGrid, grid) && sameGrid(movingGrid || lastGrid, grid);
        lastGrid = grid;
        lastFrozen = frozen;
        if (!frozen) {
          if (!runStart || t - lastMovingAt > limits.runGapMs) runStart = t;
          lastMovingAt = t;
          movingGrid = grid;
        }
        lastSeenAt = t;
      } else {
        lastGrid = null;
        movingGrid = null;
        lastFrozen = false;
      }
      check();
      return seen;
    },
    check,
  };
}

const isVideo = publication => publication?.kind === TrackKind.KIND_VIDEO;

function trackName(publication) {
  return publication?.name || publication?.trackName || '';
}

function isBridge(participant) {
  return String(participant?.identity || '').startsWith(BRIDGE_PREFIX);
}

/** Higher is a better match for the caller's FaceTime camera. */
function trackScore(publication, participant) {
  const named = trackName(publication) === CALLER_TRACK;
  const bridge = isBridge(participant);
  if (named && bridge) return 3;
  if (named) return 2;
  if (bridge) return 1;
  return 0;
}

function looksOff(value) {
  return /^(off|muted|mute|false|0|hidden|disabled)$/i.test(String(value).trim());
}

function looksOn(value) {
  return /^(on|live|unmuted|unmute|true|1|enabled)$/i.test(String(value).trim());
}

/** From participant attributes whose keys mention camera, video or mute: 'video muted', '' (live), or null. */
function attributeWhy(participant) {
  const attrs = participant?.attributes;
  if (!attrs || typeof attrs !== 'object') return null;
  let why = null;
  for (const [key, value] of Object.entries(attrs)) {
    if (!/(camera|video|mute)/i.test(key)) continue;
    const text = String(value).trim();
    if (/mute/i.test(key)) {
      if (looksOn(text) || /^(muted|mute)$/i.test(text)) why = 'video muted';
      else if (looksOff(text) || /^(unmuted|unmute)$/i.test(text)) why = '';
    } else if (looksOff(text)) {
      why = 'video muted';
    } else if (looksOn(text)) {
      why = '';
    }
  }
  return why;
}

function publicationMuted(publication, track) {
  return Boolean(publication?.muted || track?.muted);
}

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
  let publisher = null;
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

  function attach(next, nextPublication, nextParticipant) {
    if (closed || !next || track === next) return;
    detach();
    track = next;
    publication = nextPublication || publication;
    if (nextParticipant) publisher = nextParticipant;
    const name = trackName(publication) || 'video';
    const who = publisher?.identity || 'remote';
    log(`[camera] reading ${name}, published by ${who}`);
    void pump(next, new VideoStream(next));
  }

  function find() {
    let best = null;
    let bestScore = -1;
    for (const participant of room.remoteParticipants.values()) {
      if (!mine(participant)) continue;
      for (const candidate of participant.trackPublications.values()) {
        if (!isVideo(candidate)) continue;
        if (!candidate.subscribed) candidate.setSubscribed(true);
        const next = trackScore(candidate, participant);
        if (next > bestScore) {
          best = { candidate, participant };
          bestScore = next;
        }
      }
    }
    if (!best) return;
    publication = best.candidate;
    publisher = best.participant;
    if (best.candidate.track) attach(best.candidate.track, best.candidate, best.participant);
  }

  function refresh() {
    if (closed) return;
    const fromAttrs = attributeWhy(publisher);
    if (!track) monitor.setTrack('no video track');
    else if (publicationMuted(publication, track) || fromAttrs === 'video muted') monitor.setTrack('video muted');
    else monitor.setTrack('');
  }

  const onPublished = (candidate, participant) => {
    if (!mine(participant) || !isVideo(candidate)) return;
    const name = trackName(candidate);
    log(`[camera] video track published${name ? ` (${name})` : ''}`);
    candidate.setSubscribed(true);
    const next = trackScore(candidate, participant);
    const current = publication ? trackScore(publication, publisher) : -1;
    if (!publication || next >= current) {
      publication = candidate;
      publisher = participant;
    }
  };
  const onSubscribed = (next, candidate, participant) => {
    if (!mine(participant) || (candidate?.kind ?? next?.kind) !== TrackKind.KIND_VIDEO) return;
    const nextScore = trackScore(candidate, participant);
    const currentScore = publication && track ? trackScore(publication, publisher) : -1;
    if (track && nextScore < currentScore) return;
    attach(next, candidate, participant);
    refresh();
  };
  const onGone = what => (first, second, third) => {
    // trackUnsubscribed is (track, publication, participant); trackUnpublished is (publication, participant).
    const candidate = third ? second : first;
    const participant = third || second;
    if (!mine(participant) || !isVideo(candidate)) return;
    log(`[camera] video track ${what}`);
    if (publication && candidate.sid !== publication.sid) return;
    if (!third) { publication = null; publisher = null; }
    detach();
    refresh();
  };
  const onMute = muted => (candidate, participant) => {
    if (!mine(participant) || !isVideo(candidate)) return;
    log(`[camera] video track ${muted ? 'muted' : 'unmuted'}`);
    publication = candidate;
    if (participant) publisher = participant;
    refresh();
  };
  const onAttributes = (changed, participant) => {
    if (!mine(participant)) return;
    publisher = participant;
    log(`[camera] caller attributes changed: ${Object.keys(changed || {}).join(', ') || 'none'}`);
    refresh();
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
  const timer = setInterval(() => monitor.check(), CHECK_MS);
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
