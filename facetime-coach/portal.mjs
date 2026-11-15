import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { drawFace, FPS as FACE_FPS, HEIGHT as FACE_HEIGHT, WIDTH as FACE_WIDTH } from './face.mjs';
import { playDemoAudio, stopDemoAudio } from './demo-audio.mjs';
import { demoPage, gradingPage, recordingPage, resultsPage, setupPage, welcomePage } from './overlay.mjs';
import { demoPath } from './videos.mjs';

/** iPhone 14 / 15 aspect (9:19.5) at 2×. Line video_framing is fill so this is fullscreen, not 16:9. */
export const WIDTH = 780;
export const HEIGHT = 1688;
export const FPS = 8;

const VIEW = { viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 };

const PLACEHOLDER = 'YOUR_';

let browser;
let page;
let mode = 'face';
let skills = [];
let tick = 0;
let speaking = false;
let demoFile = null;
let demoRouted = false;
let demoRun = 0;

const filled = value => Boolean(value) && !value.startsWith(PLACEHOLDER);

export function setSpeaking(value) {
  speaking = Boolean(value);
}

export async function startPortal(loadedSkills) {
  skills = loadedSkills;
  if (page) return mode;
  const url = process.env.WEB_APP_URL || 'http://localhost:3000';
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext(VIEW);
    page = await context.newPage();
    const user = process.env.WEB_APP_USERNAME;
    const password = process.env.WEB_APP_PASSWORD;
    if (filled(user) && filled(password)) {
      const login = await context.request.post(`${url.replace(/\/$/, '')}/api/auth/login`, {
        data: { username: user, password },
      });
      if (!login.ok()) throw new Error(`login ${login.status()}`);
      await showWelcome();
      mode = 'portal';
      return 'portal';
    }
    await showOverlay(welcomePage(skills));
    mode = 'overlay';
    return 'overlay';
  } catch (error) {
    console.warn('[portal] web app unavailable, using local step cards:', error.message);
    try {
      if (!browser) browser = await chromium.launch({ headless: true });
      if (!page) {
        const context = await browser.newContext(VIEW);
        page = await context.newPage();
      }
      await showOverlay(welcomePage(skills));
      mode = 'overlay';
      return 'overlay';
    } catch (overlayError) {
      console.warn('[portal] browser failed, using drawn face:', overlayError.message);
      mode = 'face';
      return 'face';
    }
  }
}

export async function stopPortal() {
  await browser?.close().catch(() => {});
  browser = undefined;
  page = undefined;
}

/**
 * Gets the nurse's demonstration ready: the picture in the page, the soundtrack for the agent's audio track.
 * Resolves to { playing: false } when there is no file for the skill, or no browser to show it in.
 * Otherwise call start() to play it. The soundtrack shares the coach's audio track, so start it once the
 * coach has stopped speaking: started mid-sentence, the two cut each other off.
 */
export async function playDemo(skill, audioSink, { cameraOn = true } = {}) {
  await stopDemo();
  const path = skill ? await demoPath(skill.slug) : null;
  if (!page || !path) return { playing: false };
  demoFile = path;
  if (!demoRouted) {
    demoRouted = true;
    await page.route('**/demo.mp4', async route => {
      if (!demoFile) return route.abort();
      const body = await readFile(demoFile);
      await route.fulfill({ status: 200, contentType: 'video/mp4', body });
    });
  }
  await page.setContent(demoPage(skill, { cameraOn }), { waitUntil: 'domcontentloaded' });
  mode = 'overlay';
  const run = ++demoRun;
  return {
    playing: true,
    /** Does nothing if this demonstration was stopped or replaced before it started. */
    start() {
      if (run !== demoRun) return;
      demoRun += 1;
      void page.evaluate(() => document.getElementById('demo')?.play()).catch(() => {});
      void playDemoAudio(path, audioSink).catch(error => {
        console.warn('[portal] demonstration soundtrack failed:', error.message);
      });
    },
  };
}

export async function stopDemo() {
  demoRun += 1;
  stopDemoAudio();
  if (!page) return;
  await page.evaluate(() => {
    const video = document.getElementById('demo');
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }).catch(() => {});
}

async function show(html) {
  if (!page) return;
  await showOverlay(html);
  mode = 'overlay';
}

export const showWelcomeScreen = () => show(welcomePage(skills));
export const showSetup = (skill, options) => show(setupPage(skill, options));
export const showRecording = skill => show(recordingPage(skill));
export const showGrading = skill => show(gradingPage(skill));
export const showResults = (skill, result, options) => show(resultsPage(skill, result, options));

export async function captureFrame() {
  tick += 1;
  if (page && mode !== 'face') {
    try {
      const buffer = await page.screenshot({ type: 'png', scale: 'css' });
      return fitFrame(PNG.sync.read(buffer));
    } catch {
      /* fall through to the face */
    }
  }
  return scaleFace(drawFace(tick, speaking));
}

async function showWelcome() {
  const url = (process.env.WEB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  await page.goto(`${url}/portal/skills`, { waitUntil: 'domcontentloaded', timeout: 15000 });
}

async function showOverlay(html) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
}

function fitFrame(png) {
  if (png.width === WIDTH && png.height === HEIGHT) return png.data;
  const out = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    const sy = Math.min(png.height - 1, Math.floor(y * png.height / HEIGHT));
    for (let x = 0; x < WIDTH; x++) {
      const sx = Math.min(png.width - 1, Math.floor(x * png.width / WIDTH));
      const i = (y * WIDTH + x) * 4;
      const j = (sy * png.width + sx) * 4;
      out[i] = png.data[j];
      out[i + 1] = png.data[j + 1];
      out[i + 2] = png.data[j + 2];
      out[i + 3] = 255;
    }
  }
  return out;
}

function scaleFace(src) {
  const out = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    const sy = Math.min(FACE_HEIGHT - 1, Math.floor(y * FACE_HEIGHT / HEIGHT));
    for (let x = 0; x < WIDTH; x++) {
      const sx = Math.min(FACE_WIDTH - 1, Math.floor(x * FACE_WIDTH / WIDTH));
      const i = (y * WIDTH + x) * 4;
      const j = (sy * FACE_WIDTH + sx) * 4;
      out[i] = src[j]; out[i + 1] = src[j + 1]; out[i + 2] = src[j + 2]; out[i + 3] = 255;
    }
  }
  return out;
}

void FACE_FPS;
