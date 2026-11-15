/** Shared FaceTime frame: same scale and padding as the skill-selection page. */
export const FRAME_SCALE = 0.799;
export const FRAME_PAD_PX = 20;

/** Local HTML shown on FaceTime. Full iPhone 14 / 15 portrait (9:19.5), edge to edge. */

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function shell({ title, sub, asideTitle, aside, mainTitle, main, headerExtra, boxed = true }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 100%; height: 100%; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: #f6f8fa;
      color: #17324d;
      overflow: hidden;
    }
    .zoom {
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      padding: ${FRAME_PAD_PX}px;
      transform: scale(${FRAME_SCALE});
      transform-origin: center center;
      overflow: hidden;
    }
    header { flex: none; padding: 32px 2px 14px; }
    h1 { margin: 0; font-size: 56px; line-height: 1.12; overflow-wrap: anywhere; }
    .sub { margin: 12px 0 0; color: #4b6278; font-size: 32px; line-height: 1.3; overflow-wrap: anywhere; }
    .kicker { margin: 0 0 12px; color: #0f766e; font-size: 22px; letter-spacing: .04em; text-transform: uppercase; font-weight: 700; }
    main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 14px;
      overflow: hidden;
    }
    aside, section {
      background: #fff;
      border: 1px solid #d7e0ea;
      border-radius: 20px;
      padding: 18px 20px;
      overflow: auto;
    }
    section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .stage { flex: none; height: 600px; position: relative; overflow: hidden; background: #f6f8fa; }
    #demo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: center top; background: #f6f8fa; }
    aside { flex: none; max-height: 32%; }
    h2 { margin: 0 0 14px; font-size: 22px; letter-spacing: .04em; text-transform: uppercase; color: #0f766e; }
    li { display: flex; gap: 16px; list-style: none; padding: 14px 4px; border-radius: 12px; }
    ul { margin: 0; padding: 0; }
    .num { width: 48px; height: 48px; border-radius: 999px; background: #e8eef3; display: grid; place-items: center; font-weight: 700; flex: none; font-size: 24px; }
    .on { background: #d1fae5; outline: 1px solid #0d9488; }
    .on .num { background: #0d9488; color: #fff; }
    .pass .num { background: #0d9488; color: #fff; }
    .fail .num { background: #b91c1c; color: #fff; }
    .unverified .num { background: #b45309; color: #fff; }
    .title { margin: 0; font-weight: 650; font-size: 32px; line-height: 1.25; overflow-wrap: anywhere; }
    .how { margin: 6px 0 0; color: #4b6278; font-size: 28px; line-height: 1.35; overflow-wrap: anywhere; }
    .setup li { display: list-item; list-style: disc; margin-left: 24px; padding: 8px 0; font-size: 28px; }
    .tip { margin: 0; font-size: 28px; line-height: 1.35; overflow-wrap: anywhere; }
    /* A FaceTime picture cannot scroll, so long notes are cut to whole lines rather than through the middle of one. */
    .lines3 { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; -webkit-line-clamp: 3; }
    .notes li { padding: 9px 4px; }
    .notes .title { font-size: 30px; }
    .notes .how { font-size: 26px; margin-top: 3px; }
    h2.next { margin-top: 22px; }
    .steps li { padding: 9px 4px; align-items: center; }
    .steps .title { font-size: 30px; }
    .rec { display: flex; align-items: center; gap: 12px; font-weight: 700; color: #b91c1c; font-size: 32px; margin: 14px 0 0; }
    .rec.watch { color: #0f766e; }
    .dot { width: 20px; height: 20px; border-radius: 999px; background: #dc2626; }
    .banner { font-size: 32px; font-weight: 650; margin: 0; line-height: 1.3; overflow-wrap: anywhere; }
    .skill { align-items: center; }
    .skill .title { flex: 1; min-width: 0; font-size: 40px; line-height: 1.15; }
    .skill .count { flex: none; color: #4b6278; font-size: 28px; white-space: nowrap; margin-left: auto; padding-left: 12px; }
  </style>
</head>
<body>
  <div class="zoom">
  <header>
    <h1>${escapeHtml(title)}</h1>
    ${sub ? `<p class="sub">${escapeHtml(sub)}</p>` : ''}
    ${headerExtra || ''}
  </header>
  <main>
    ${aside ? `<aside>
      ${asideTitle ? `<h2>${escapeHtml(asideTitle)}</h2>` : ''}
      ${aside}
    </aside>` : ''}
    ${boxed ? `<section>
      ${mainTitle ? `<h2>${escapeHtml(mainTitle)}</h2>` : ''}
      ${main}
    </section>` : main}
  </main>
  </div>
</body>
</html>`;
}

/** Words for the one control the caller has: the camera button. */
const CAMERA = {
  demo: on => (on ? 'Seen enough? Turn your camera off.' : 'Ready to practice? Turn your camera on.'),
  setup: on => (on
    ? 'Get set up. Then turn your camera off and on again: recording starts.'
    : 'Get set up. Turn your camera on when you are ready: recording starts.'),
  again: on => (on ? 'Turn your camera off, then on, to try again.' : 'Turn your camera on to try again.'),
};

const items = list => list.map(item => `<li>${escapeHtml(item)}</li>`).join('');

/** Between the demonstration and the recording: what to gather at home, where to put the phone, what to show. */
export function setupPage(skill, { cameraOn = false } = {}) {
  const steps = (skill?.steps || []).map(step => `<li>
      <span class="num">${escapeHtml(step.id.replace('s', ''))}</span>
      <p class="title">${escapeHtml(step.title)}</p>
    </li>`).join('');
  return shell({
    title: skill?.name || 'Get set up',
    sub: CAMERA.setup(cameraOn),
    mainTitle: 'You need',
    main: `<ul class="setup">${items(skill?.setup || [])}</ul>
      ${skill?.camera ? `<h2 class="next">Your phone</h2><p class="tip">${escapeHtml(skill.camera)}</p>` : ''}
      <h2 class="next">Steps you will show</h2>
      <ul class="steps">${steps}</ul>`,
  });
}

export function welcomePage(skills) {
  const rows = skills.map((skill, index) => `<li class="skill">
      <span class="num">${index + 1}</span>
      <p class="title">${escapeHtml(skill.name)}</p>
      <span class="count">${skill.steps.length} steps</span>
    </li>`).join('');
  return shell({
    title: 'What do you want to practice?',
    sub: 'Say one skill. These are home versions: no equipment needed.',
    asideTitle: 'Your camera runs the call',
    aside: `<ul class="setup">
      <li>Watch the nurse. Camera off when you have seen enough.</li>
      <li>Get set up. Camera on: I record you.</li>
      <li>Camera off when you finish: I grade it.</li>
    </ul>`,
    mainTitle: 'Skills',
    main: `<ul>${rows}</ul>`,
  });
}

export function demoPage(skill, { cameraOn = true } = {}) {
  return shell({
    title: skill?.name || 'Demonstration',
    sub: CAMERA.demo(cameraOn),
    boxed: false,
    headerExtra: `<p class="rec watch">Demonstration</p>`,
    main: `<div class="stage"><video id="demo" src="https://coach.local/demo.mp4" preload="auto" playsinline muted></video></div>
      <section>
        <h2>At home you will use</h2>
        <ul class="setup">${items(skill?.setup || [])}</ul>
      </section>`,
  });
}

export function recordingPage(skill) {
  return shell({
    title: skill?.name || 'Your practice',
    sub: 'Do each step where the camera can see you. Turn your camera off when you finish.',
    headerExtra: `<p class="rec"><span class="dot"></span> Recording</p>`,
    mainTitle: 'Steps to show',
    main: `<ul>${(skill?.steps || []).map(step => `<li>
      <span class="num">${escapeHtml(step.id.replace('s', ''))}</span>
      <div><p class="title">${escapeHtml(step.title)}</p><p class="how">${escapeHtml(step.how)}</p></div>
    </li>`).join('')}</ul>`,
  });
}

export function gradingPage(skill) {
  return shell({
    title: skill?.name || 'Your practice',
    sub: 'Hold on — I am grading the recording.',
    asideTitle: 'Now',
    aside: `<ul class="setup"><li>Watching your recording against the skill steps.</li></ul>`,
    mainTitle: 'Next',
    main: `<p class="banner">You will see pass or retry notes for each step. Then turn your camera on to try again, say another skill, or say goodbye.</p>`,
  });
}

export function resultsPage(skill, result, { cameraOn = false } = {}) {
  const steps = (result?.steps || skill?.steps || []).map((step, index) => {
    const status = String(step.status || 'unverified').toLowerCase();
    const klass = status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : 'unverified';
    const label = status === 'passed' ? 'Pass' : status === 'failed' ? 'Retry' : 'Unclear';
    return `<li class="${klass}">
      <span class="num">${index + 1}</span>
      <div>
        <p class="title">${escapeHtml(step.title || step.id)} · ${label}</p>
        <p class="how lines3">${escapeHtml(step.feedback || step.how || '')}</p>
      </div>
    </li>`;
  }).join('');
  const overall = String(result?.overall || 'unverified').toLowerCase();
  const headline = overall === 'passed' ? 'Looks good' : overall === 'failed' ? 'Try this again' : 'Some steps were hard to see';
  const matchNote = result?.skill_match === false ? 'This recording did not look like that skill. Record again with the steps in mind.' : (result?.overall_feedback || '');
  return shell({
    title: headline,
    sub: skill ? `${skill.name}${result?.score_pct != null ? ` · ${Math.round(result.score_pct)}%` : ''}` : 'Your practice',
    asideTitle: 'What next',
    aside: `<ul class="setup">
      <li>${CAMERA.again(cameraOn)}</li>
      <li>Say another skill to practice that one.</li>
      <li>Say “goodbye” to end the call.</li>
    </ul>
    <h2 style="margin-top:14px">Summary</h2>
    <p class="how lines3">${escapeHtml(matchNote || 'Look over the step notes below.')}</p>`,
    mainTitle: 'Step notes',
    main: `<ul class="notes">${steps || '<li>No step notes came back. You can still try again.</li>'}</ul>`,
  });
}
