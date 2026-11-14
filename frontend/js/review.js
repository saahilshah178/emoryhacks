// Nurse review screen: review.html?id=<attempt_id>.
// The nurse verifies an attempt by jumping straight to each step, flag and order
// violation instead of watching the whole video, then records a decision.
import { api, badge, esc, fmtDate, fmtRange, fmtTime, mountNav, qs, showError, stagesHtml, videoUrl } from "/js/common.js";

mountNav("attempts");

const $ = (sel) => document.querySelector(sel);
const video = $("#video");
const refVideo = $("#ref-video");
const attemptId = qs("id");

const FLAG_LABEL = {
  patient_distress: "Patient distress",
  patient_off_center: "Patient off centre",
  patient_unsteady: "Patient unsteady",
  unsafe_caregiver_posture: "Unsafe caregiver posture",
  environment_hazard: "Environment hazard",
  other: "Other",
};
const SOURCE_LABEL = { gemini: "AI video review", pose: "Pose readings (advisory)", pose_confirmed: "Pose readings, confirmed by AI" };
const STATUSES = [["passed", "Pass"], ["failed", "Fail"], ["unverified", "Unverified"]];
const LANE_PX = 26;

const state = {
  attempt: null,
  overrides: {},     // step_id -> {status, note}: the nurse's per-step choices, kept across re-renders
  overall: null,
  overallNote: "",
  selected: null,    // step_id last jumped to, used by "Compare with reference"
  playing: null,     // step_id under the playhead
  refEnd: null,      // stop the reference clip here
  loadedVideo: false,
};

// --- data -----------------------------------------------------------------
async function load() {
  try {
    const attempt = await api(`/attempts/${attemptId}`);
    const first = !state.attempt;
    state.attempt = attempt;
    if (first) initNurseState(attempt);
    render();
    const job = attempt.job;
    if (job && (job.status === "queued" || job.status === "running")) setTimeout(load, 2500);
  } catch (err) {
    showError("#app", err);
  }
}

function initNurseState(attempt) {
  for (const s of attempt.steps) state.overrides[s.step_id] = { status: s.nurse_status || null, note: s.nurse_note || "" };
  state.overall = attempt.nurse_status || null;
  state.overallNote = attempt.nurse_note || "";
}

const steps = () => state.attempt.steps;
const stepById = (id) => steps().find((s) => s.step_id === id);
const foundSteps = () => steps().filter((s) => s.found && s.start_s != null).sort((a, b) => a.start_s - b.start_s);
const duration = () => Number(state.attempt.video?.duration_s) || video.duration || 1;
const pct = (t) => `${Math.min(100, Math.max(0, (100 * Number(t)) / duration()))}%`;
const shownStatus = (s) => state.overrides[s.step_id]?.status || s.status || "pending";
const violationsFor = (id) => state.attempt.order_violations.filter((v) => v.step_id === id || v.expected_after === id);

function ordinal(n) {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${tail}`;
}

function percent(x) {
  return x == null ? "—" : `${Math.round(Number(x) * 100)}%`;
}

function timeChip(start, end) {
  if (start == null) return "";
  const label = end != null && end > start ? fmtRange(start, end) : fmtTime(start);
  return `<button class="time" data-seek="${Number(start)}">${label}</button>`;
}

// --- rendering --------------------------------------------------------------
function render() {
  const a = state.attempt;
  document.title = `Review: ${a.skill_name} · FirstShift`;
  if (!state.loadedVideo) {
    video.src = videoUrl(a.video_id);
    state.loadedVideo = true;
    if (!a.reference_video_id) {
      $("#compare").disabled = true;
      $("#compare").parentElement.title = "This skill has no reference video";
    }
  }
  renderHeader();
  renderJob();
  renderSummary();
  renderBar();
  renderSteps();
  renderDecision();
  updatePlayhead();
}

function renderHeader() {
  const a = state.attempt;
  $("#title").textContent = a.skill_name;
  $("#subtitle").textContent = [
    `Caregiver: ${a.caregiver_name || "unnamed"}`,
    fmtDate(a.created_at),
    a.video?.duration_s ? `${fmtTime(a.video.duration_s)} long` : "",
  ].filter(Boolean).join(" · ");
  $("#final").innerHTML = a.reviewed_at
    ? `<div class="small muted">Final status</div>${badge(a.final_status)}<div class="small muted">Reviewed ${esc(fmtDate(a.reviewed_at))}</div>`
    : `<span class="badge ${a.needs_review ? "unverified" : "neutral"}">${a.needs_review ? "Needs nurse review" : "Not reviewed yet"}</span>`;
}

function renderJob() {
  const job = state.attempt.job;
  if (!job || job.status === "done") {
    $("#job").innerHTML = "";
  } else if (job.status === "error") {
    $("#job").innerHTML = `<div class="card"><p class="error">Processing failed: ${esc((job.error || "").split("\n")[0])}</p>${stagesHtml(job)}</div>`;
  } else {
    $("#job").innerHTML = `<div class="card"><p class="muted">Still analysing this attempt. This page updates by itself.</p>${stagesHtml(job)}</div>`;
  }
}

function renderSummary() {
  const a = state.attempt;
  const reasons = (a.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  const ai = `<div class="card">
      <p class="label" style="margin-top:0">AI result</p>
      <div class="result-line">${a.status ? badge(a.status) : `<span class="badge pending">Not scored yet</span>`}
        ${a.score_pct != null ? `<span class="score">${Math.round(a.score_pct)}%</span>` : ""}</div>
      ${a.skill_match === false ? `<p class="error small">Skill mismatch: ${esc(a.skill_match_note)}</p>` : ""}
      ${reasons ? `<ul class="tight small">${reasons}</ul>` : ""}
      ${a.overall_feedback ? `<p class="small muted">${esc(a.overall_feedback)}</p>` : ""}
    </div>`;

  const timelineDone = steps().some((s) => s.found != null);
  const violations = a.order_violations.map((v) => `<div class="issue"><span style="color:var(--accent)">◆</span>
      <span class="grow">${esc(v.message)}</span>${timeChip(v.at_s)}</div>`).join("");
  const order = `<div class="card">
      <p class="label" style="margin-top:0">Order</p>
      ${violations || `<p class="muted small">${!a.order_matters ? "Order does not matter for this skill."
        : timelineDone ? "Steps were done in the expected order." : "Not checked yet."}</p>`}
    </div>`;

  const flags = a.safety_flags.map((f) => `<div class="issue">
      <span class="badge ${f.severity === "high" ? "failed" : "unverified"}">${esc(f.severity)}</span>
      <span class="grow"><strong>${esc(FLAG_LABEL[f.kind] || f.kind)}</strong>${f.person_label ? ` (${esc(f.person_label)})` : ""}:
        ${esc(f.description)}<br><span class="muted small">${esc(SOURCE_LABEL[f.source] || f.source)}${f.counts_toward_score ? "" : " · does not affect the score"}</span></span>
      ${timeChip(f.start_s, f.end_s)}</div>`).join("");
  const safety = `<div class="card">
      <p class="label" style="margin-top:0">Safety flags</p>
      ${flags || `<p class="muted small">No safety flags.</p>`}
    </div>`;
  $("#summary").innerHTML = ai + order + safety;
}

function renderBar() {
  // Greedy lanes so overlapping steps sit on separate rows instead of hiding each other.
  const laneEnds = [];
  const segs = foundSteps().map((s) => {
    let lane = laneEnds.findIndex((end) => end <= s.start_s + 0.05);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = s.end_s ?? s.start_s;
    const width = `max(14px, calc(${pct((s.end_s ?? s.start_s + 1) - s.start_s)} - 2px))`;
    const out = violationsFor(s.step_id).length ? " · out of order" : "";
    return `<button class="seg ${shownStatus(s)}" data-step="${esc(s.step_id)}" data-seek="${s.start_s}"
      style="left:${pct(s.start_s)};width:${width};top:${2 + lane * LANE_PX}px"
      title="${esc(`${s.ord}. ${s.title} (${fmtRange(s.start_s, s.end_s)})${out}`)}">${s.ord}</button>`;
  });
  const lanes = $("#lanes");
  lanes.style.height = `${Math.max(1, laneEnds.length) * LANE_PX + 4}px`;
  const empty = steps().some((s) => s.found === false) ? "None of the steps were found in this video" : "No steps located yet";
  lanes.innerHTML = segs.join("") || `<span class="muted small" style="position:absolute;left:0.6rem;top:4px">${empty}</span>`;

  const a = state.attempt;
  const markers = [
    ...a.safety_flags.map((f) => `<button class="marker flag ${esc(f.severity)}" data-seek="${f.start_s}" style="left:${pct(f.start_s)}"
        title="${esc(`${FLAG_LABEL[f.kind] || f.kind} (${f.severity}) at ${fmtTime(f.start_s)}: ${f.description}`)}">▲</button>`),
    ...a.order_violations.filter((v) => v.at_s != null).map((v) => `<button class="marker order" data-seek="${v.at_s}"
        style="left:${pct(v.at_s)}" title="${esc(`${fmtTime(v.at_s)}: ${v.message}`)}">◆</button>`),
  ];
  $("#markers").innerHTML = markers.join("");
  const d = duration();
  $("#axis").innerHTML = [0, d / 4, d / 2, (3 * d) / 4, d].map((t) => `<span>${fmtTime(t)}</span>`).join("");
}

function renderSteps() {
  $("#steps").innerHTML = steps().map((s) => {
    const nurse = state.overrides[s.step_id];
    const violations = violationsFor(s.step_id);
    const where = s.found
      ? `${timeChip(s.start_s, s.end_s)}<span>Done ${ordinal(s.performed_index)}</span>`
      : s.found === false ? `<span>Not found in the video</span>` : `<span>Not located yet</span>`;
    const conf = [s.found && s.timeline_confidence != null ? `located ${percent(s.timeline_confidence)}` : "",
      s.confidence != null ? `graded ${percent(s.confidence)}` : ""].filter(Boolean).join(" · ");
    return `<div class="card step ${state.playing === s.step_id ? "playing" : ""}" id="step-${esc(s.step_id)}">
      <div class="top">
        <h3>${s.ord}. ${esc(s.title)}</h3>
        <span>${s.critical ? `<span class="badge critical">Critical</span> ` : ""}${s.status ? badge(s.status) : `<span class="badge pending">Not graded yet</span>`}</span>
      </div>
      <div class="meta">${where}
        ${violations.length ? `<span class="badge order">Out of order</span>` : ""}
        ${conf ? `<span>Confidence: ${conf}</span>` : ""}
        ${s.double_checked ? `<span class="badge checked">Double-checked</span>` : ""}
      </div>
      ${violations.map((v) => `<p class="small" style="color:var(--accent)">${esc(v.message)}</p>`).join("")}
      ${s.feedback ? `<p>${esc(s.feedback)}</p>` : ""}
      ${s.evidence ? `<p class="small muted">Seen: ${esc(s.evidence)} ${timeChip(s.evidence_start_s, s.evidence_end_s)}</p>` : ""}
      ${s.timeline_note ? `<p class="small muted">Timeline: ${esc(s.timeline_note)}</p>` : ""}
      <div class="nurse" data-step="${esc(s.step_id)}">
        <span class="small muted">Nurse</span>
        <span class="seg-toggle">${STATUSES.map(([v, label]) => `<button data-status="${v}" class="${nurse.status === v ? "on" : ""}">${label}</button>`).join("")}</span>
        <input type="text" placeholder="Note" value="${esc(nurse.note)}" aria-label="Nurse note for step ${s.ord}">
      </div>
    </div>`;
  }).join("");
}

function renderDecision() {
  const a = state.attempt;
  const changed = steps().filter((s) => state.overrides[s.step_id].status).length;
  const running = a.job && (a.job.status === "queued" || a.job.status === "running");
  $("#decision").innerHTML = `
    <h3>Nurse decision</h3>
    ${a.reviewed_at ? `<p class="small">Final status ${badge(a.final_status)} · reviewed ${esc(fmtDate(a.reviewed_at))}</p>` : ""}
    <label>Overall result</label>
    <span class="seg-toggle" id="overall">${STATUSES.map(([v, label]) => `<button data-status="${v}" class="${state.overall === v ? "on" : ""}">${label}</button>`).join("")}</span>
    <label for="overall-note">Note</label>
    <textarea id="overall-note" placeholder="What you saw and why">${esc(state.overallNote)}</textarea>
    <p class="small muted">${changed ? `${changed} step override${changed === 1 ? "" : "s"} will be saved with this decision.` : "No step overrides."}
      ${running ? " The AI is still working; you can still save." : ""}</p>
    <button class="btn primary" id="save" ${state.overall ? "" : "disabled"}>Save review</button>
    <span class="small muted" id="save-msg"></span>`;
}

// --- playback -------------------------------------------------------------
function seek(t, play = true) {
  if (t == null || Number.isNaN(Number(t))) return;
  video.currentTime = Math.max(0, Number(t));
  if (play) video.play().catch(() => { /* autoplay blocked: the nurse can press play */ });
  updatePlayhead();
}

function jumpToStep(step) {
  state.selected = step.step_id;
  seek(step.start_s);
  if ($("#compare").checked) playReference(step);
}

function stepAt(t) {
  const here = foundSteps().filter((s) => s.start_s <= t && t < (s.end_s ?? s.start_s + 1));
  return here.length ? here[here.length - 1] : null;
}

function updatePlayhead() {
  if (!state.attempt) return;
  const t = video.currentTime || 0;
  $("#cursor").style.left = pct(t);
  const current = stepAt(t)?.step_id || null;
  if (current === state.playing) return;
  state.playing = current;
  document.querySelectorAll(".step.playing").forEach((el) => el.classList.remove("playing"));
  document.querySelectorAll(".seg.selected").forEach((el) => el.classList.remove("selected"));
  if (!current) return;
  document.getElementById(`step-${current}`)?.classList.add("playing");
  document.querySelector(`.seg[data-step="${CSS.escape(current)}"]`)?.classList.add("selected");
  if (!video.paused) document.getElementById(`step-${current}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function tick() {
  updatePlayhead();
  if (!video.paused) requestAnimationFrame(tick);
}

function playReference(step) {
  if (!state.attempt.reference_video_id) return;
  if (!refVideo.src) refVideo.src = videoUrl(state.attempt.reference_video_id);
  if (step.ref_start_s == null) {
    $("#ref-caption").textContent = `Reference: no timing for step ${step.ord}`;
    return;
  }
  $("#ref-caption").textContent = `Reference: ${step.ord}. ${step.title} (${fmtRange(step.ref_start_s, step.ref_end_s)})`;
  state.refEnd = step.ref_end_s;
  refVideo.currentTime = step.ref_start_s;
  refVideo.play().catch(() => {});
}

// Items a nurse should look at, in time order: unverified and failed steps, violations, flags.
function reviewItems() {
  const a = state.attempt;
  const items = [];
  for (const s of foundSteps()) {
    if (s.status === "unverified" || s.status === "failed") {
      items.push({ t: s.start_s, step: s, label: `${s.status === "failed" ? "Failed" : "Unverified"} step: ${s.ord}. ${s.title}` });
    }
  }
  for (const v of a.order_violations) if (v.at_s != null) items.push({ t: v.at_s, step: stepById(v.step_id), label: `Out of order: ${v.message}` });
  for (const f of a.safety_flags) items.push({ t: f.start_s, label: `Safety flag: ${FLAG_LABEL[f.kind] || f.kind} (${f.severity}). ${f.description}` });
  return items.sort((x, y) => x.t - y.t);
}

function nextItem() {
  const items = reviewItems();
  if (!items.length) {
    $("#next-label").textContent = "Nothing flagged for review.";
    return;
  }
  const t = video.currentTime || 0;
  let i = items.findIndex((it) => it.t > t + 0.3);
  if (i === -1) i = 0; // wrap around to the first item
  const item = items[i];
  $("#next-label").textContent = `Item ${i + 1} of ${items.length} at ${fmtTime(item.t)}: ${item.label}`;
  if (item.step) {
    state.selected = item.step.step_id;
    if ($("#compare").checked) playReference(item.step);
  }
  seek(item.t);
}

function moveStep(direction) {
  const list = foundSteps();
  if (!list.length) return;
  const t = video.currentTime || 0;
  const target = direction > 0
    ? list.find((s) => s.start_s > t + 0.3)
    : [...list].reverse().find((s) => s.start_s < t - 1);
  if (target) jumpToStep(target);
}

// --- saving ---------------------------------------------------------------
async function save() {
  const button = $("#save");
  button.disabled = true;
  $("#save-msg").textContent = "Saving…";
  try {
    const body = {
      overall: state.overall,
      note: state.overallNote,
      steps: steps().map((s) => ({ step_id: s.step_id, status: state.overrides[s.step_id].status, note: state.overrides[s.step_id].note })),
    };
    state.attempt = await api(`/attempts/${attemptId}/review`, { json: body });
    render();
    $("#save-msg").textContent = "Saved.";
  } catch (err) {
    button.disabled = false;
    $("#save-msg").innerHTML = `<span class="error">${esc(err.message)}</span>`;
  }
}

// --- events ---------------------------------------------------------------
document.addEventListener("click", (e) => {
  const seg = e.target.closest(".seg");
  if (seg) { jumpToStep(stepById(seg.dataset.step)); return; }
  const chip = e.target.closest("[data-seek]");
  if (chip) {
    const card = chip.closest(".step");
    const step = card && stepById(card.id.replace(/^step-/, ""));
    if (step && Number(chip.dataset.seek) === step.start_s) { jumpToStep(step); return; }
    seek(chip.dataset.seek);
    return;
  }
  const toggle = e.target.closest(".seg-toggle button");
  if (toggle) {
    const value = toggle.dataset.status;
    const row = toggle.closest(".nurse");
    if (row) {
      const o = state.overrides[row.dataset.step];
      o.status = o.status === value ? null : value; // clicking the active choice clears it
      renderBar();
      renderSteps();
      renderDecision();
      updatePlayhead();
    } else {
      state.overall = value;
      renderDecision();
    }
    return;
  }
  if (e.target.id === "save") save();
});

$("#lanes").addEventListener("click", (e) => {
  if (e.target !== e.currentTarget) return; // a segment handles its own click
  const rect = e.currentTarget.getBoundingClientRect();
  seek(((e.clientX - rect.left) / rect.width) * duration());
});

document.addEventListener("input", (e) => {
  const row = e.target.closest(".nurse");
  if (row) state.overrides[row.dataset.step].note = e.target.value;
  if (e.target.id === "overall-note") state.overallNote = e.target.value;
});

$("#next-btn").addEventListener("click", nextItem);

$("#compare").addEventListener("change", (e) => {
  $("#ref-figure").hidden = !e.target.checked;
  $("#videos").classList.toggle("compare", e.target.checked);
  if (!e.target.checked) { refVideo.pause(); return; }
  const step = stepById(state.selected) || stepById(state.playing) || foundSteps()[0] || steps()[0];
  if (step) { state.selected = step.step_id; playReference(step); }
});

refVideo.addEventListener("timeupdate", () => {
  if (state.refEnd != null && refVideo.currentTime >= state.refEnd) refVideo.pause();
});

video.addEventListener("timeupdate", updatePlayhead);
video.addEventListener("seeked", updatePlayhead);
video.addEventListener("play", () => requestAnimationFrame(tick));
video.addEventListener("loadedmetadata", () => { if (!state.attempt?.video?.duration_s) renderBar(); });

document.addEventListener("keydown", (e) => {
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === " " && tag === "VIDEO") return; // the focused player already toggles on space
  if (e.key === " ") {
    e.preventDefault();
    if (video.paused) video.play().catch(() => {}); else video.pause();
  } else if (e.key === "j") {
    moveStep(-1);
  } else if (e.key === "k") {
    moveStep(1);
  }
});

if (!attemptId) showError("#app", new Error("No attempt id in the address. Open this page from the attempts list."));
else load();
