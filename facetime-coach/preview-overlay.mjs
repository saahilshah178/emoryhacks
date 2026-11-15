import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { demoPage, gradingPage, recordingPage, resultsPage, setupPage, welcomePage } from './overlay.mjs';
import { HEIGHT, WIDTH } from './portal.mjs';
import { loadSkills } from './skills.mjs';
import { demoPath } from './videos.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'preview');

const sampleResult = {
  overall: 'failed',
  skill_match: true,
  score_pct: 62,
  overall_feedback: 'You set up the seated preparation well, clearly getting both hands on the armrests, scooting to the front of the chair, and positioning the feet hip-width apart and tucked back. Going forward, be sure to brace the chair against a wall and test it first. A critical step was not done correctly: "Brace the chair". 3 of 6 steps were not done correctly.',
  steps: [
    { title: 'Brace the chair', status: 'failed', feedback: 'You did not brace or test the chair before starting. Next time, push the chair back against a wall or solid support and press down on the seat to make sure it cannot slide.' },
    { title: 'Sit and hold the chair', status: 'passed', feedback: 'Good job getting both hands positioned firmly on the armrests rather than leaving them in the lap.' },
    { title: 'Scoot to the front edge', status: 'passed', feedback: 'Well done guiding the move forward to the front half of the seat before standing.' },
    { title: 'Tuck your feet back', status: 'unverified', feedback: 'Your feet were out of the picture. Move the phone back so the floor in front of the chair shows.' },
    { title: 'Lean forward, nose over toes', status: 'failed', feedback: 'The recording ended before the forward lean was performed. Make sure to show the chest leaning clearly forward so the nose moves over the toes before standing.' },
    { title: 'Stand up and pause', status: 'failed', feedback: 'The recording stopped before you did "Stand up and pause". Keep your camera on until you have finished every step.' },
  ],
};

const skills = await loadSkills();
const skill = skills.find(item => item.slug === 'sit_to_stand') || skills[0];
const pages = [
  ['01-welcome', welcomePage(skills)],
  ['02-setup', setupPage(skill, { cameraOn: false })],
  ['03-recording', recordingPage(skill)],
  ['04-grading', gradingPage(skill)],
  ['05-results', resultsPage(skill, sampleResult, { cameraOn: false })],
  // The set-up and recording screens of every skill, to check that nothing runs off the bottom.
  ...skills.flatMap(item => [
    [`setup-${item.slug}`, setupPage(item, { cameraOn: true })],
    [`recording-${item.slug}`, recordingPage(item)],
  ]),
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
const page = await context.newPage();
for (const [name, html] of pages) {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  const png = await page.screenshot({ type: 'png', scale: 'css' });
  await writeFile(join(outDir, `${name}.png`), png);
  // A FaceTime picture cannot scroll: text below the bottom of a box is text the caller never sees.
  const cut = await page.evaluate(() => [...document.querySelectorAll('aside, section, main')]
    .filter(box => box.scrollHeight > box.clientHeight + 1)
    .map(box => `${box.tagName.toLowerCase()} is ${box.scrollHeight - box.clientHeight}px too tall`));
  console.log(`wrote preview/${name}.png${cut.length ? `  CUT OFF: ${cut.join(', ')}` : ''}`);
}

const demoFile = await demoPath(skill.slug);
if (demoFile) {
  const body = await readFile(demoFile);
  await page.route('**/demo.mp4', route => route.fulfill({ status: 200, contentType: 'video/mp4', body }));
  await page.setContent(demoPage(skill, { cameraOn: true }), { waitUntil: 'domcontentloaded' });
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
