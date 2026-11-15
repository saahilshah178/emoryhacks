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
    .stage { flex: 1; min-height: 0; position: relative; overflow: hidden; background: #f6f8fa; }
    #demo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: center 36px; background: #f6f8fa; }
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

export function skillPage(skill, activeId) {
  const steps = (skill?.steps || []).map(step => {
    const on = step.id === activeId;
    return `<li data-step-id="${escapeHtml(step.id)}" class="${on ? 'on' : ''}">
      <span class="num">${escapeHtml(step.id.replace('s', ''))}</span>
      <p class="title">${escapeHtml(step.title)}</p>
    </li>`;
  }).join('');
  return shell({
    title: skill?.name || 'Pick a skill',
    sub: 'Watch the demonstration, then record yourself doing it.',
    mainTitle: 'Setup',
    main: `<ul class="setup">${(skill?.setup || ['Say which skill you want to practice.']).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <h2 style="margin-top:24px">Safety</h2>
      <ul class="setup">${(skill?.safety || []).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <h2 style="margin-top:24px">What you will show</h2>
      <ul>${steps || '<li>Choose a skill to see its steps.</li>'}</ul>`,
  });
}

export function welcomePage(skills) {
  const items = skills.map((skill, index) => `<li class="skill">
      <span class="num">${index + 1}</span>
      <p class="title">${escapeHtml(skill.name)}</p>
      <span class="count">${skill.steps.length} steps</span>
    </li>`).join('');
  return shell({
    title: 'What do you want to practice?',
    sub: 'Say one skill. I will play the nurse demonstration, then record you, then grade it.',
    asideTitle: 'On this call',
    aside: `<ul class="setup">
      <li>Name one skill.</li>
      <li>Watch the demonstration, then say you are done.</li>
      <li>Record yourself doing it, then say you are done.</li>
      <li>Then end the call, record again, or pick another skill.</li>
    </ul>`,
    mainTitle: 'Skills',
    main: `<ul>${items}</ul>`,
  });
}

export function demoPage(skill) {
  return shell({
    title: skill?.name || 'Demonstration',
    sub: 'Say “I am done” when you have seen enough.',
    boxed: false,
    headerExtra: `<p class="rec watch">Demonstration</p>`,
    main: `<div class="stage"><video id="demo" src="https://coach.local/demo.mp4" autoplay playsinline muted></video></div>`,
  });
}

export function recordingPage(skill) {
  return shell({
    title: skill?.name || 'Your practice',
    sub: 'Stay in FaceTime Video so I can see you. Say “I am done” when you finish.',
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
    main: `<p class="banner">You will see pass or retry notes for each step, then you can end the call, record again, or practice another skill.</p>`,
  });
}

export function resultsPage(skill, result) {
  const steps = (result?.steps || skill?.steps || []).map((step, index) => {
    const status = String(step.status || 'unverified').toLowerCase();
    const klass = status === 'passed' ? 'pass' : status === 'failed' ? 'fail' : 'unverified';
    const label = status === 'passed' ? 'Pass' : status === 'failed' ? 'Retry' : 'Unclear';
    return `<li class="${klass}">
      <span class="num">${index + 1}</span>
      <div>
        <p class="title">${escapeHtml(step.title || step.id)} · ${label}</p>
        <p class="how">${escapeHtml(step.feedback || step.how || '')}</p>
      </div>
    </li>`;
  }).join('');
  const overall = String(result?.overall || 'unverified').toLowerCase();
  const headline = overall === 'passed' ? 'Looks good' : overall === 'failed' ? 'Try this again' : 'Some steps were hard to see';
  const matchNote = result?.skill_match === false ? 'This recording did not look like that skill. Record again with the demonstration in mind.' : (result?.overall_feedback || '');
  return shell({
    title: headline,
    sub: skill ? `${skill.name}${result?.score_pct != null ? ` · ${Math.round(result.score_pct)}%` : ''}` : 'Your practice',
    asideTitle: 'What next',
    aside: `<ul class="setup">
      <li>Say “end the call” to hang up.</li>
      <li>Say “record again” to retry this skill.</li>
      <li>Say another skill name to practice that one.</li>
    </ul>
    <h2 style="margin-top:14px">Summary</h2>
    <p class="how">${escapeHtml(matchNote || 'Look over the step notes below.')}</p>`,
    mainTitle: 'Step notes',
    main: `<ul>${steps || '<li>No step notes came back. You can still record again.</li>'}</ul>`,
  });
}
