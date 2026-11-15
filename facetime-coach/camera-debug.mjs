// What the caller's pictures looked like, for working out how a line reports a camera going off.
// Only with CAMERA_DEBUG=1: a line of numbers every two seconds, and small stills in .state/camera-debug
// whenever the picture starts or stops moving. The stills show the caller, and never leave this computer.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const dir = join(dirname(fileURLToPath(import.meta.url)), '.state', 'camera-debug');
const STILL_WIDTH = 320;
const MAX_STILLS = 60;

function save(rgba, name) {
  const scale = STILL_WIDTH / rgba.width;
  const width = STILL_WIDTH;
  const height = Math.max(2, Math.round(rgba.height * scale));
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    const sy = Math.min(rgba.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(rgba.width - 1, Math.floor(x / scale));
      const from = (sy * rgba.width + sx) * 4;
      const to = (y * width + x) * 4;
      png.data[to] = rgba.data[from]; png.data[to + 1] = rgba.data[from + 1]; png.data[to + 2] = rgba.data[from + 2]; png.data[to + 3] = 255;
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), PNG.sync.write(png));
}

export function cameraDebug(log) {
  if (!process.env.CAMERA_DEBUG) return null;
  let moved = [];
  let blank = 0;
  let wasMoving = null;
  let stills = 0;
  let lastStillAt = 0;
  let on = false;
  const stamp = () => new Date().toTimeString().slice(0, 8).replaceAll(':', '');
  const timer = setInterval(() => {
    if (!moved.length) { log('[camera-debug] no pictures in the last 2 s'); return; }
    const sorted = [...moved].sort((a, b) => a - b);
    log(`[camera-debug] ${moved.length} pictures, moved min ${sorted[0]} median ${sorted[Math.floor(sorted.length / 2)]} max ${sorted.at(-1)}, blank ${blank}, camera ${on ? 'on' : 'off'}`);
    moved = [];
    blank = 0;
  }, 2000);
  timer.unref?.();
  return {
    frame(rgba, seen, isOn) {
      on = isOn;
      moved.push(seen.moved);
      if (seen.blank) blank += 1;
      const flipped = wasMoving !== null && wasMoving !== seen.moving;
      const due = Date.now() - lastStillAt > 10_000;
      if ((flipped && Date.now() - lastStillAt > 1500) || due) {
        if (stills < MAX_STILLS) {
          stills += 1;
          lastStillAt = Date.now();
          try { save(rgba, `${stamp()}-${seen.blank ? 'blank' : seen.moving ? 'moving' : 'still'}-${seen.moved}.png`); } catch { /* diagnostics must never break a call */ }
        }
      }
      wasMoving = seen.moving;
    },
    close() { clearInterval(timer); },
  };
}
