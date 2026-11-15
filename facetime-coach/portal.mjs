import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { drawFace, FPS as FACE_FPS, HEIGHT as FACE_HEIGHT, WIDTH as FACE_WIDTH } from './face.mjs';
import { playDemoAudio, stopDemoAudio } from './demo-audio.mjs';
import { demoPage, gradingPage, recordingPage, resultsPage, skillPage, welcomePage } from './overlay.mjs';
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
let current = null;
let activeStep = null;
let tick = 0;
let speaking = false;
let demoFile = null;
let demoRouted = false;

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

export async function playDemo(skill, audioSink) {
  await stopDemo();
  current = skill;
  const path = skill ? await demoPath(skill.slug) : null;
  if (!page || !path) {
    if (skill) await showSkill(skill);
    return path ? `No picture for the ${skill.name} demo` : `No demonstration file for ${skill?.name || 'that skill'}`;
  }
  demoFile = path;
  if (!demoRouted) {
    demoRouted = true;
    await page.route('**/demo.mp4', async route => {
      if (!demoFile) return route.abort();
      const body = await readFile(demoFile);
      await route.fulfill({ status: 200, contentType: 'video/mp4', body });
    });
  }
  await page.setContent(demoPage(skill), { waitUntil: 'domcontentloaded' });
  mode = 'overlay';
  void playDemoAudio(path, audioSink).catch(error => {
    console.warn('[portal] demonstration soundtrack failed:', error.message);
  });
  return `Playing the ${skill.name} demonstration. Tell them to say they are done when they have seen enough.`;
}

export async function stopDemo() {
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

export async function startPractice(skill) {
  return showSkill(skill);
}

export async function showWelcomeScreen() {
  if (page) {
    await showOverlay(welcomePage(skills));
    mode = 'overlay';
  }
  return 'Ask which skill they want to practice.';
}

export async function showRecording(skill) {
  current = skill;
  if (page) {
    await showOverlay(recordingPage(skill));
    mode = 'overlay';
  }
  return `Recording ${skill.name}. They should stay in FaceTime Video and say they are done when finished.`;
}

export async function showGrading(skill) {
  current = skill;
  if (page) {
    await showOverlay(gradingPage(skill));
    mode = 'overlay';
  }
  return `Grading the ${skill.name} recording.`;
}

export async function showResults(skill, result) {
  current = skill;
  if (page) {
    await showOverlay(resultsPage(skill, result));
    mode = 'overlay';
  }
  const overall = result?.overall || 'unverified';
  return `Showed ${skill.name} results (${overall}). They can end the call, record again, or pick another skill.`;
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export async function showSkill(skill) {
  current = skill;
  activeStep = skill?.steps[0]?.id || null;
  if (!skill) return 'no skill';
  if (mode === 'portal') {
    try {
      const opened = await openPortalSkill(skill);
      if (opened) {
        await highlightStep(activeStep);
        return `Showing ${skill.name} in the app`;
      }
    } catch (error) {
      console.warn('[portal] falling back to step cards:', error.message);
      mode = 'overlay';
    }
  }
  if (page) {
    await showOverlay(skillPage(skill, activeStep));
    mode = 'overlay';
    return `Showing ${skill.name} steps`;
  }
  return `${skill.name} is ready; the picture could not change`;
}

export async function highlightStep(stepId) {
  activeStep = stepId;
  if (!current) return 'no skill yet';
  if (mode === 'portal' && page) {
    await page.evaluate(id => {
      for (const el of document.querySelectorAll('[data-step-id]')) {
        const on = el.getAttribute('data-step-id') === id;
        el.style.outline = on ? '3px solid #0d9488' : '';
        el.style.background = on ? '#d1fae5' : '';
      }
      document.querySelector(`[data-step-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, stepId).catch(() => {});
    return `Highlighted ${stepId}`;
  }
  if (page) {
    await showOverlay(skillPage(current, stepId));
    return `Highlighted ${stepId}`;
  }
  return `On ${stepId}`;
}

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

async function openPortalSkill(skill) {
  const url = (process.env.WEB_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const response = await page.request.get(`${url}/api/my/skills`);
  if (!response.ok()) return false;
  const body = await response.json();
  const row = (body.skills || []).find(item => item.slug === skill.slug || item.name === skill.name);
  if (!row?.id) return false;
  await page.goto(`${url}/portal/skills/${row.id}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(400);
  return true;
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
