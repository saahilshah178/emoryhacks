import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { demoPage, gradingPage, recordingPage, resultsPage, skillPage, welcomePage } from './overlay.mjs';
import { HEIGHT, WIDTH } from './portal.mjs';
import { loadSkills } from './skills.mjs';
import { demoPath } from './videos.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'preview');

const sampleResult = {
  overall: 'failed',
  skill_match: true,
  score_pct: 62,
  overall_feedback: 'Hands and the chair were easy to see. Cue the stand on three, and keep your hand off the neck.',
  steps: [
    { title: 'Greet patient and explain transfer', status: 'passed', feedback: 'Clear greeting.' },
    { title: 'Instruct patient to hold armrests', status: 'passed', feedback: 'Both hands on the arms.' },
    { title: 'Move patient to front of chair', status: 'failed', feedback: 'Hips stayed back in the seat.' },
    { title: 'Position feet back hip-width apart', status: 'unverified', feedback: 'Feet were out of frame.' },
  ],
};

const skills = await loadSkills();
const skill = skills.find(item => item.slug === 'sit_to_stand') || skills[0];
const pages = [
  ['01-welcome', welcomePage(skills)],
  ['02-skill', skillPage(skill, skill?.steps[0]?.id)],
  ['03-recording', recordingPage(skill)],
  ['04-grading', gradingPage(skill)],
  ['05-results', resultsPage(skill, sampleResult)],
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
const page = await context.newPage();
for (const [name, html] of pages) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const png = await page.screenshot({ type: 'png', scale: 'css' });
  await writeFile(join(outDir, `${name}.png`), png);
  console.log(`wrote preview/${name}.png`);
}

const demoFile = await demoPath(skill.slug);
if (demoFile) {
  const body = await readFile(demoFile);
  await page.route('**/demo.mp4', route => route.fulfill({ status: 200, contentType: 'video/mp4', body }));
  await page.setContent(demoPage(skill), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const video = document.getElementById('demo');
    return Boolean(video && video.readyState >= 2 && video.videoWidth > 0);
  }, { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => {
    const video = document.getElementById('demo');
    if (video) video.currentTime = 8;
  });
  await page.waitForFunction(() => {
    const video = document.getElementById('demo');
    return Boolean(video && !video.seeking && video.currentTime >= 7.5);
  }, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const png = await page.screenshot({ type: 'png', scale: 'css' });
  await writeFile(join(outDir, '06-demo.png'), png);
  console.log('wrote preview/06-demo.png');
}
await browser.close();
