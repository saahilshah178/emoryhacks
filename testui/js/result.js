// The caregiver's result screen: result.html?id=<attempt_id>.
// Polls the attempt while its job runs, then renders the overall result, the video,
// one card per rubric step, safety flags and the people identified.
import {
  api, qs, esc, fmtDate, badge, playSegment, videoUrl, thumbUrl, stagesHtml, showError, stepTally, timeChip,
} from "/js/common.js";

// Headlines before a nurse has looked at the attempt (the AI's result) and after (the nurse's).
const HEADLINE = {
  passed: { title: "Passed", line: "Well done. You met the criteria for this skill." },
  failed: { title: "Not passed yet", line: "You're on your way. The notes below show what to work on before you try again." },
  unverified: { title: "Needs a closer look", line: "Some steps could not be seen clearly, so a nurse will check them." },
};
const REVIEWED_HEADLINE = {
  passed: { title: "Passed", line: "A nurse reviewed your attempt and confirmed you met the criteria." },
  failed: { title: "Not passed yet", line: "A nurse reviewed your attempt. The notes below show what to work on before you try again." },
  unverified: { title: "Not confirmed", line: "A nurse reviewed your attempt but could not confirm every step from this video. Record it again with the whole skill in view." },
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
      <p>This was a problem on our side while processing the video, not a result for your attempt.</p>
      <p class="error small">${esc((job.error || "Unknown error").split("\n")[0])}</p>
      <p class="muted">Please record the skill again.</p>${stagesHtml(job)}</div>`;
  }
  return `<div class="card progress"><h2>Checking your attempt…</h2>
    <p class="muted">This usually takes a minute or two. The page updates on its own.</p>${stagesHtml(job)}</div>`;
}

// The headline follows final_status, which is the nurse's decision once reviewed_at is set.
// The AI's own summary and reasons stay visible, but labelled as the AI's and, after a
// review, as superseded by the nurse.
function summaryHtml(a) {
  const status = a.final_status;
  const reviewed = Boolean(a.reviewed_at);
  const head = (reviewed ? REVIEWED_HEADLINE : HEADLINE)[status] || { title: "Result pending", line: "" };
  const review = reviewed
    ? `<p class="small"><span class="badge neutral">Reviewed by a nurse</span> ${esc(fmtDate(a.reviewed_at))}</p>
       ${a.nurse_note ? `<p class="feedback nurse-note">“${esc(a.nurse_note)}”</p>` : ""}`
    : a.needs_review ? `<p class="small"><span class="badge pending">Awaiting nurse review</span></p>` : "";
  const reasons = (a.reasons || []).length
    ? `<ul class="tight">${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "";
  const mismatch = a.skill_match === false
    ? `<p class="notice small">This recording doesn't seem to show ${esc(a.skill_name)}. ${esc(a.skill_match_note)}</p>` : "";
  const aiPart = `${a.overall_feedback ? `<p class="feedback">${esc(a.overall_feedback)}</p>` : ""}
      ${reasons ? `<p class="label">Why</p>${reasons}` : ""}`;
  const ai = reviewed && a.status
    ? `<div class="superseded"><p class="small"><span class="badge neutral">AI</span>
        The automatic check said ${badge(a.status)} before the nurse's review:</p>${aiPart}</div>`
    : aiPart;
  // score_pct is a 0-100 score that already includes order and safety deductions, so it is
  // not a share of steps; the step count is shown next to it instead.
  const score = a.score_pct != null
    ? `<div class="score"><span>${Math.round(a.score_pct)}</span><small class="muted">${reviewed ? "AI score" : "score"} out of 100</small></div>` : "";
  return `<section class="card hero ${esc(status || "pending")}">
      <div class="hero-top">
        <div><p class="label">Your result</p><h2 class="hero-title">${esc(head.title)}</h2><p>${esc(head.line)}</p>
          <p class="small muted">${esc(stepTally(a.steps))}</p></div>
        ${score}
      </div>
      ${review}${mismatch}
      ${ai}
    </section>`;
}

// Where the nurse changed a step, the nurse's status and note lead and the AI's feedback
// follows, marked as the AI's and as superseded.
function stepHtml(step, violations) {
  const status = step.nurse_status || step.status;
  const changed = step.nurse_status && step.nurse_status !== step.status;
  // Where the step happens in the attempt: the located span, or what the grader saw if it was not located.
  const located = step.start_s != null;
  const start = located ? step.start_s : step.evidence_start_s;
  const end = located ? step.end_s : step.evidence_end_s;
  const notes = violations
    .filter((v) => v.step_id === step.step_id || v.expected_after === step.step_id)
    .map((v) => `<p class="small order-note">Out of order: ${esc(v.message)}</p>`).join("");
  const nurse = step.nurse_status
    ? `<p><span class="badge neutral">Nurse</span> ${esc(step.nurse_note || (changed ? "A nurse changed this step's result." : "A nurse confirmed this step."))}</p>` : "";
  const feedback = step.feedback ? esc(step.feedback) : `<span class="muted">No feedback for this step.</span>`;
  const ai = changed
    ? `<div class="superseded small"><span class="badge neutral">AI</span> The automatic check said ${badge(step.status)}: ${feedback}</div>`
    : `<p>${feedback}</p>`;
  return `<article class="card step ${esc(status || "pending")}">
      <div class="step-head">
        <span class="step-num">${step.ord}</span>
        <h3 class="grow">${esc(step.title)}</h3>
        ${step.critical ? `<span class="badge critical">Critical</span>` : ""}
        ${badge(status)}
      </div>
      ${nurse}${ai}
      ${notes}
      <p class="small muted seen">${timeChip(start, end)} ${step.evidence ? `What we saw: ${esc(step.evidence)}` : ""}
        ${step.double_checked ? `<span class="badge neutral" title="Looked at a second time, more closely">Checked twice</span>` : ""}</p>
    </article>`;
}

function flagHtml(f) {
  const when = timeChip(f.start_s, f.end_s);
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
    <video id="player" controls preload="metadata" playsinline poster="${thumbUrl(a.video_id, 1)}" src="${videoUrl(a.video_id)}"></video>
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

// A time chip plays its stretch of the attempt video and stops at the end of it.
app.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-seek]");
  const player = document.querySelector("#player");
  if (!chip || !player) return;
  player.scrollIntoView({ behavior: "smooth", block: "center" });
  playSegment(player, chip.dataset.seek, chip.dataset.end);
});

async function load() {
  if (!id) {
    app.innerHTML = `<div class="notice">No attempt selected. Open a result from the <a href="/attempts.html">attempts list</a>.</div>`;
    return;
  }
  // While the job runs, a failed request is retried a few times before giving up, so one
  // dropped connection does not replace the progress card with an error.
  let failures = 0;
  for (;;) {
    let attempt;
    try {
      attempt = await api(`/attempts/${encodeURIComponent(id)}`);
      failures = 0;
    } catch (err) {
      failures += 1;
      if (!app.querySelector(".progress") || failures >= 4) return showError(app, err);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS * (failures + 1)));
      continue;
    }
    document.title = `${attempt.skill_name} result · Test UI`;
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
}

load();
