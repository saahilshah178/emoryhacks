// The caregiver's result screen: result.html?id=<attempt_id>.
// Polls the attempt while its job runs, then renders the overall result, the video,
// one card per rubric step, safety flags and the people identified.
import { api, qs, esc, fmtTime, fmtDate, badge, videoUrl, stagesHtml, showError } from "/js/common.js";

const HEADLINE = {
  passed: { title: "Passed", line: "Well done. You met the criteria for this skill." },
  failed: { title: "Not passed yet", line: "You're on your way. The notes below show what to work on before you try again." },
  unverified: { title: "Needs a closer look", line: "Some steps could not be seen clearly, so a nurse will check them." },
};
const ROLE = { caregiver: "Caregiver", patient: "Patient", other: "Other person" };
const FLAG_KIND = {
  patient_distress: "Patient distress",
  patient_off_center: "Patient off-centre",
  patient_unsteady: "Patient unsteady",
  unsafe_caregiver_posture: "Unsafe handling",
  environment_hazard: "Hazard nearby",
  other: "Safety note",
};
const POLL_MS = 2000;

const app = document.querySelector("#result");
const id = qs("id");

function timeChip(t) {
  return t == null ? "" : `<button class="time" data-seek="${Number(t)}" title="Play from here">${fmtTime(t)}</button>`;
}

function headerHtml(a) {
  const who = a.caregiver_name ? `${esc(a.caregiver_name)} · ` : "";
  return `<div class="header"><div>
      <p class="muted small">${who}${fmtDate(a.created_at)}</p>
      <h1>${esc(a.skill_name)}</h1>
    </div></div>`;
}

function progressHtml(a) {
  const job = a.job || {};
  if (job.status === "error") {
    return `<div class="card"><h2>We couldn't finish checking this attempt</h2>
      <p class="error small">${esc(job.error || "Unknown error").split("\n")[0]}</p>
      <p class="muted">Please record the skill again.</p>${stagesHtml(job)}</div>`;
  }
  return `<div class="card"><h2>Checking your attempt…</h2>
    <p class="muted">This usually takes a minute or two. The page updates on its own.</p>${stagesHtml(job)}</div>`;
}

function summaryHtml(a) {
  const status = a.final_status;
  const head = HEADLINE[status] || { title: "Result pending", line: "" };
  const reviewed = Boolean(a.reviewed_at);
  const review = reviewed
    ? `<p class="small"><span class="badge neutral">Reviewed by a nurse</span>${a.nurse_note ? ` ${esc(a.nurse_note)}` : ""}</p>`
    : a.needs_review ? `<p class="small"><span class="badge pending">Awaiting nurse review</span></p>` : "";
  const reasons = (a.reasons || []).length
    ? `<ul class="tight">${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "";
  const mismatch = a.skill_match === false
    ? `<p class="notice small">This recording doesn't seem to show ${esc(a.skill_name)}. ${esc(a.skill_match_note)}</p>` : "";
  return `<section class="card hero ${esc(status || "pending")}">
      <div class="hero-top">
        <div><p class="label">Your result</p><h2 class="hero-title">${esc(head.title)}</h2><p>${esc(head.line)}</p></div>
        ${a.score_pct != null ? `<div class="score"><span>${Math.round(a.score_pct)}%</span><small class="muted">of steps</small></div>` : ""}
      </div>
      ${review}${mismatch}
      ${a.overall_feedback ? `<p class="feedback">${esc(a.overall_feedback)}</p>` : ""}
      ${reasons ? `<p class="label">Why</p>${reasons}` : ""}
    </section>`;
}

function stepHtml(step, violations) {
  const status = step.nurse_status || step.status;
  const t = step.evidence_start_s ?? step.start_s;
  const notes = violations
    .filter((v) => v.step_id === step.step_id || v.expected_after === step.step_id)
    .map((v) => `<p class="small order-note">Out of order: ${esc(v.message)}</p>`).join("");
  const nurse = step.nurse_status
    ? `<p class="small"><span class="badge neutral">Nurse</span> ${esc(step.nurse_note || "Updated by a nurse.")}</p>` : "";
  return `<article class="card step ${esc(status || "pending")}">
      <div class="step-head">
        <span class="step-num">${step.ord}</span>
        <h3 class="grow">${esc(step.title)}</h3>
        ${step.critical ? `<span class="badge critical">Critical</span>` : ""}
        ${badge(status)}
      </div>
      ${step.feedback ? `<p>${esc(step.feedback)}</p>` : `<p class="muted">No feedback for this step.</p>`}
      ${notes}${nurse}
      <p class="small muted seen">${timeChip(t)} ${step.evidence ? `What we saw: ${esc(step.evidence)}` : ""}
        ${step.double_checked ? `<span class="badge neutral" title="Looked at a second time, more closely">Checked twice</span>` : ""}</p>
    </article>`;
}

function flagHtml(f) {
  const when = timeChip(f.start_s);
  const who = f.person_label ? ` · ${esc(f.person_label)}` : "";
  return `<li class="${f.counts_toward_score ? "" : "muted"}">
      ${when} <strong>${esc(FLAG_KIND[f.kind] || f.kind)}</strong>
      <span class="badge ${f.severity === "high" ? "failed" : f.severity === "medium" ? "unverified" : "neutral"}">${esc(f.severity)}</span>${who}
      <br><span class="small">${esc(f.description)}</span></li>`;
}

function safetyHtml(flags) {
  const counted = flags.filter((f) => f.counts_toward_score);
  const advisory = flags.filter((f) => !f.counts_toward_score);
  if (!flags.length) return `<div class="card"><p>No patient-safety concerns were spotted. Nice work keeping your patient safe.</p></div>`;
  return `<div class="card">
      ${counted.length ? `<ul class="flags">${counted.map(flagHtml).join("")}</ul>` : `<p>No confirmed safety concerns.</p>`}
      ${advisory.length ? `<p class="label">Advisory: body-tracking readings not confirmed on video</p>
        <ul class="flags">${advisory.map(flagHtml).join("")}</ul>` : ""}
    </div>`;
}

function peopleHtml(people) {
  if (!people.length) return `<div class="card muted">No one was identified in the video.</div>`;
  return `<div class="card"><ul class="people">${people.map((p) => `<li>
      <strong>${esc(p.label)}</strong> <span class="badge neutral">${esc(ROLE[p.role] || p.role)}</span>
      <span class="small">${esc(p.description)}</span></li>`).join("")}</ul></div>`;
}

function render(a) {
  const steps = a.steps || [];
  const violations = a.order_violations || [];
  app.innerHTML = `${headerHtml(a)}
    ${summaryHtml(a)}
    <video id="player" controls preload="metadata" playsinline src="${videoUrl(a.video_id)}"></video>
    <p class="label">Steps</p>
    ${steps.map((s) => stepHtml(s, violations)).join("") || `<div class="notice">This skill has no steps.</div>`}
    <p class="label">Patient safety</p>
    ${safetyHtml(a.safety_flags || [])}
    <p class="label">Who we saw</p>
    ${peopleHtml(a.people || [])}
    ${actionsHtml(a)}`;
}

function actionsHtml(a) {
  return `<div class="actions">
      <a class="btn primary" href="/attempt.html?skill_id=${esc(a.skill_id)}">Try again</a>
      <a class="btn" href="/skill.html?id=${esc(a.skill_id)}">View skill</a>
    </div>`;
}

// Time chips seek the attempt video and start playing it.
app.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-seek]");
  const player = document.querySelector("#player");
  if (!chip || !player) return;
  player.currentTime = Number(chip.dataset.seek);
  player.scrollIntoView({ behavior: "smooth", block: "center" });
  player.play().catch(() => { /* autoplay can be blocked; the seek still applies */ });
});

async function load() {
  if (!id) {
    app.innerHTML = `<div class="notice">No attempt selected. Open a result from the <a href="/attempts.html">attempts list</a>.</div>`;
    return;
  }
  try {
    for (;;) {
      const attempt = await api(`/attempts/${encodeURIComponent(id)}`);
      document.title = `${attempt.skill_name} result · FirstShift`;
      const job = attempt.job;
      if (job && job.status !== "done") {
        app.innerHTML = headerHtml(attempt) + progressHtml(attempt) + (job.status === "error" ? actionsHtml(attempt) : "");
        if (job.status === "error") return;
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        continue;
      }
      render(attempt);
      return;
    }
  } catch (err) {
    showError(app, err);
  }
}

load();
