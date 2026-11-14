// Nurse review screen: review.html?id=<attempt_id>.
// The nurse verifies an attempt by jumping straight to each step, flag and order
// violation instead of watching the whole video, then records a decision.
import {
  api, badge, esc, fmtDate, fmtRange, fmtTime, mountNav, playSegment, qs, showError, stagesHtml, stepTally, thumbUrl,
  timeChip, videoUrl,
} from "/js/common.js";

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
const ROLE_LABEL = { caregiver: "Caregiver", patient: "Patient", other: "Other person" };
const STATUSES = [["passed", "Pass"], ["failed", "Fail"], ["unverified", "Unverified"]];
const LANE_PX = 26;

const state = {
  attempt: null,
  overrides: {},     // step_id -> {status, note}: the nurse's per-step choices, kept across re-renders
  overall: null,
  overallNote: "",
  selected: null,    // step_id last jumped to, used by "Compare with reference"
  playing: null,     // step_id under the playhead
  loadedVideo: false,
  itemIndex: -1,     // position in reviewItems() of the last "Next item" visited
};
const POLL_MS = 2500;

// --- data -----------------------------------------------------------------
// While the job runs the page polls. A failed poll leaves the page and the nurse's
// unsaved choices alone, says so in the job card and tries again.
async function load() {
  let attempt;
  try {
    attempt = await api(`/attempts/${attemptId}`);
  } catch (err) {
    if (!state.attempt) { showError("#app", err); return; }
    $("#job").innerHTML = `<div class="card"><p class="error small">Lost contact with the server (${esc(err.message)}). Trying again…</p></div>`;
    setTimeout(load, POLL_MS * 2);
    return;
  }
  const first = !state.attempt;
  state.attempt = attempt;
  if (first) initNurseState(attempt);
  render();
  const job = attempt.job;
  if (job && (job.status === "queued" || job.status === "running")) setTimeout(load, POLL_MS);
}

function initNurseState(attempt) {
  for (const s of attempt.steps) state.overrides[s.step_id] = { status: s.nurse_status || null, note: s.nurse_note || "" };
  state.overall = attempt.nurse_status || null;
  state.overallNote = attempt.nurse_note || "";
}

const steps = () => state.attempt.steps;
const stepById = (id) => steps().find((s) => s.step_id === id);
// Where a step is in the attempt video: the timeline's span, or else the span the grader
// cited as evidence (the grader looks for steps the timeline missed). null if neither.
function stepTimes(s) {
  if (s.found && s.start_s != null) return { start: s.start_s, end: s.end_s, byGrader: false };
  if (s.evidence_start_s != null) return { start: s.evidence_start_s, end: s.evidence_end_s, byGrader: true };
  return null;
}
const locatedSteps = () => steps().filter((s) => stepTimes(s)).sort((a, b) => stepTimes(a).start - stepTimes(b).start);
const unlocatedSteps = () => steps().filter((s) => !stepTimes(s));
const duration = () => Number(state.attempt.video?.duration_s) || video.duration || 1;
const pct = (t) => `${Math.min(100, Math.max(0, (100 * Number(t)) / duration()))}%`;
const shownStatus = (s) => state.overrides[s.step_id]?.status || s.status || "pending";
const violationsFor = (id) => state.attempt.order_violations.filter((v) => v.step_id === id || v.expected_after === id);

function ordinal(n) {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th";
  return `${n}${tail}`;
}

// Gemini's notes sometimes cite raw step ids ("Performed before s2"); show "step 2" instead.
function nameStepIds(text) {
  return String(text).replace(/\bs\d+\b/g, (id) => (stepById(id) ? `step ${stepById(id).ord}` : id));
}

function percent(x) {
  return x == null ? "—" : `${Math.round(Number(x) * 100)}%`;
}

// An order violation is stored with the moment it happened. Show and play the whole step that
// was done too early, so the nurse sees it from start to finish.
function violationSpan(v) {
  const step = stepById(v.step_id);
  const times = step && stepTimes(step);
  return times ? { start: times.start, end: times.end } : { start: v.at_s, end: null };
}

// --- rendering --------------------------------------------------------------
function render() {
  const a = state.attempt;
  document.title = `Review: ${a.skill_name} · Test UI`;
  if (!state.loadedVideo) {
    video.poster = thumbUrl(a.video_id, 1);
    video.src = videoUrl(a.video_id);
    state.loadedVideo = true;
    if (!a.reference_video_id) {
      $("#compare").disabled = true;
      $("#compare").parentElement.title = "This skill has no reference video";
    }
  }
  const restoreFocus = keepFocus();
  renderHeader();
  renderJob();
  renderSummary();
  renderBar();
  renderSteps();
  renderDecision();
  restoreFocus();
  updatePlayhead();
}

// Re-rendering replaces the note fields; put the caret back where the nurse was typing.
// The typed text itself lives in state and is rendered back into the new field.
function keepFocus() {
  const el = document.activeElement;
  if (!el || !el.matches("input[type=text], textarea")) return () => {};
  const row = el.closest(".nurse");
  const selector = row ? `.nurse[data-step="${CSS.escape(row.dataset.step)}"] input` : el.id ? `#${CSS.escape(el.id)}` : null;
  if (!selector) return () => {};
  const { selectionStart, selectionEnd } = el;
  return () => {
    const field = document.querySelector(selector);
    if (!field || field === el) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(selectionStart, selectionEnd);
  };
}

function renderHeader() {
  const a = state.attempt;
  $("#title").textContent = a.skill_name;
  $("#subtitle").textContent = [
    `Caregiver: ${a.caregiver_name || "unnamed"}`,
    fmtDate(a.created_at),
    a.video?.duration_s ? `${fmtTime(a.video.duration_s)} long` : "",
  ].filter(Boolean).join(" · ");
  const failed = !a.status && a.job?.status === "error";
  $("#final").innerHTML = a.reviewed_at
    ? `<div class="small muted">Final status</div>${badge(a.final_status)}<div class="small muted">Reviewed ${esc(fmtDate(a.reviewed_at))}</div>`
    : failed ? badge("error")
      : `<span class="badge ${a.needs_review ? "unverified" : "neutral"}">${a.needs_review ? "Needs nurse review" : "Not reviewed yet"}</span>`;
}

function renderJob() {
  const a = state.attempt;
  const job = a.job;
  if (!job || job.status === "done") {
    $("#job").innerHTML = "";
  } else if (job.status === "error") {
    $("#job").innerHTML = `<div class="card">
      <p><strong>Processing error.</strong> The attempt could not be analysed, so it has no AI grade. This is not a result for the caregiver.</p>
      <p class="error small">${esc((job.error || "Unknown error").split("\n")[0])}</p>${stagesHtml(job)}
      <a class="btn small" href="/attempt.html?skill_id=${encodeURIComponent(a.skill_id)}">Record a new attempt</a></div>`;
  } else {
    $("#job").innerHTML = `<div class="card"><p class="muted">Still analysing this attempt. This page updates by itself.</p>${stagesHtml(job)}</div>`;
  }
}

function renderSummary() {
  const a = state.attempt;
  const reasons = (a.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("");
  // score_pct already includes order and safety deductions, so it is shown out of 100 and
  // the AI's own step count is shown beside it rather than presenting the score as a share.
  const aiSteps = steps().map((s) => ({ status: s.status }));
  const unscored = a.job?.status === "error" ? badge("error") : `<span class="badge pending">Not scored yet</span>`;
  const ai = `<div class="card">
      <p class="label" style="margin-top:0">AI result</p>
      <div class="result-line">${a.status ? badge(a.status) : unscored}
        ${a.score_pct != null ? `<span class="score">${Math.round(a.score_pct)}</span><span class="muted small">score out of 100</span>` : ""}</div>
      ${a.status ? `<p class="small muted">${esc(stepTally(aiSteps))}</p>` : ""}
      ${a.skill_match === false ? `<p class="error small">Skill mismatch: ${esc(a.skill_match_note)}</p>` : ""}
      ${reasons ? `<ul class="tight small">${reasons}</ul>` : ""}
      ${a.overall_feedback ? `<p class="small muted">${esc(a.overall_feedback)}</p>` : ""}
    </div>`;

  const timelineDone = steps().some((s) => s.found != null);
  const violations = a.order_violations.map((v) => `<div class="issue"><span style="color:var(--accent)">◆</span>
      <span class="grow">${esc(v.message)}</span>${timeChip(violationSpan(v).start, violationSpan(v).end)}</div>`).join("");
  const order = `<div class="card">
      <p class="label" style="margin-top:0">Order</p>
      ${violations || `<p class="muted small">${!a.order_matters ? "Order does not matter for this skill."
        : timelineDone ? "Steps were done in the expected order." : "Not checked yet."}</p>`}
    </div>`;

  const people = a.people || [];
  const roleOf = (label) => people.find((p) => p.label === label)?.role;
  const who = (label) => {
    if (!label) return "";
    const role = roleOf(label);
    return ` (${esc(label)}${role ? `, ${esc((ROLE_LABEL[role] || role).toLowerCase())}` : ""})`;
  };
  const flags = a.safety_flags.map((f) => `<div class="issue">
      <span class="badge ${f.severity === "high" ? "failed" : "unverified"}">${esc(f.severity)}</span>
      <span class="grow"><strong>${esc(FLAG_LABEL[f.kind] || f.kind)}</strong>${who(f.person_label)}:
        ${esc(f.description)}<br><span class="muted small">${esc(SOURCE_LABEL[f.source] || f.source)}${f.counts_toward_score ? "" : " · does not affect the score"}</span></span>
      ${timeChip(f.start_s, f.end_s)}</div>`).join("");
  const safety = `<div class="card">
      <p class="label" style="margin-top:0">Safety flags</p>
      ${flags || `<p class="muted small">No safety flags.</p>`}
    </div>`;

  const identified = `<div class="card">
      <p class="label" style="margin-top:0">Who the AI identified</p>
      ${people.map((p) => `<div class="issue"><strong>${esc(p.label)}</strong>
          <span class="badge neutral">${esc(ROLE_LABEL[p.role] || p.role)}</span>
          <span class="grow small">${esc(p.description)}</span></div>`).join("")
        || `<p class="muted small">${a.status ? "No one was identified." : "Not identified yet."}</p>`}
    </div>`;
  $("#summary").innerHTML = ai + identified + order + safety;
}

function renderBar() {
  // Greedy lanes so overlapping steps sit on separate rows instead of hiding each other.
  const laneEnds = [];
  const segs = locatedSteps().map((s) => {
    const { start, end, byGrader } = stepTimes(s);
    let lane = laneEnds.findIndex((e) => e <= start + 0.05);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = end ?? start;
    const width = `max(14px, calc(${pct((end ?? start + 1) - start)} - 2px))`;
    const out = violationsFor(s.step_id).length ? " · out of order" : "";
    const how = byGrader ? " · not located by the timeline, seen by the grader" : "";
    return `<button class="seg ${shownStatus(s)}${byGrader ? " by-grader" : ""}" data-step="${esc(s.step_id)}" data-seek="${start}"
      style="left:${pct(start)};width:${width};top:${2 + lane * LANE_PX}px"
      title="${esc(`${s.ord}. ${s.title} (${end != null ? fmtRange(start, end) : fmtTime(start)})${out}${how}`)}">${s.ord}</button>`;
  });
  const lanes = $("#lanes");
  lanes.style.height = `${Math.max(1, laneEnds.length) * LANE_PX + 4}px`;
  const empty = steps().some((s) => s.found === false) ? "None of the steps were found in this video" : "No steps located yet";
  lanes.innerHTML = segs.join("") || `<span class="muted small" style="position:absolute;left:0.6rem;top:4px">${empty}</span>`;

  const a = state.attempt;
  const markers = [
    ...a.safety_flags.map((f) => `<button class="marker flag ${esc(f.severity)}" data-seek="${f.start_s}" data-end="${f.end_s ?? ""}"
        style="left:${pct(f.start_s)}"
        title="${esc(`${FLAG_LABEL[f.kind] || f.kind} (${f.severity}) at ${f.end_s != null ? fmtRange(f.start_s, f.end_s) : fmtTime(f.start_s)}: ${f.description}`)}">▲</button>`),
    ...a.order_violations.filter((v) => v.at_s != null).map((v) => `<button class="marker order" data-seek="${violationSpan(v).start}"
        data-end="${violationSpan(v).end ?? ""}" style="left:${pct(v.at_s)}" title="${esc(`${fmtTime(v.at_s)}: ${v.message}`)}">◆</button>`),
  ];
  $("#markers").innerHTML = markers.join("");
  const d = duration();
  $("#axis").innerHTML = [0, d / 4, d / 2, (3 * d) / 4, d].map((t) => `<span>${fmtTime(t)}</span>`).join("");
}

function renderSteps() {
  $("#steps").innerHTML = steps().map((s) => {
    const nurse = state.overrides[s.step_id];
    const violations = violationsFor(s.step_id);
    const times = stepTimes(s);
    const where = s.found
      ? `${timeChip(s.start_s, s.end_s)}${s.performed_index ? `<span>Done ${ordinal(s.performed_index)}</span>` : ""}`
      : times ? `<span>Not located by the timeline; seen by the grader at</span>${timeChip(times.start, times.end)}`
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
      ${s.timeline_note ? `<p class="small muted">Timeline: ${esc(nameStepIds(s.timeline_note))}</p>` : ""}
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
// Play the attempt from t. With an end, playback stops there (the end of the step or flag);
// pressing play again carries on from that point.
function seek(t, end = null) {
  if (t == null || t === "" || Number.isNaN(Number(t))) return;
  document.querySelectorAll(".step.focused").forEach((el) => el.classList.remove("focused"));
  playSegment(video, t, end);
  updatePlayhead();
}

// Seek to a step, or, for a step with no place in the video, bring its card into view.
function jumpToStep(step) {
  state.selected = step.step_id;
  const times = stepTimes(step);
  if (times) seek(times.start, times.end); else focusCard(step);
  if ($("#compare").checked) playReference(step);
}

function focusCard(step) {
  document.querySelectorAll(".step.focused").forEach((el) => el.classList.remove("focused"));
  const card = document.getElementById(`step-${step.step_id}`);
  if (!card) return;
  video.pause(); // the step has no place in the video, so stop the playhead wandering elsewhere
  card.classList.add("focused");
  card.scrollIntoView({ block: "center", behavior: "smooth" });
}

function stepAt(t) {
  const here = locatedSteps().filter((s) => {
    const { start, end } = stepTimes(s);
    return start <= t && t < (end ?? start + 1);
  });
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
  playSegment(refVideo, step.ref_start_s, step.ref_end_s);
}

// Items a nurse should look at: every failed or unverified step, order violations and
// safety flags. Items with a time come first in time order; failed or unverified steps
// with no place in the video follow in rubric order (t is null for those).
function reviewItems() {
  const a = state.attempt;
  const items = [];
  for (const s of steps()) {
    if (s.status === "unverified" || s.status === "failed") {
      items.push({ t: stepTimes(s)?.start ?? null, end: stepTimes(s)?.end ?? null, step: s, label: `${s.status === "failed" ? "Failed" : "Unverified"} step: ${s.ord}. ${s.title}` });
    }
  }
  for (const v of a.order_violations) {
    items.push({ t: violationSpan(v).start, end: violationSpan(v).end, step: stepById(v.step_id), label: `Out of order: ${v.message}` });
  }
  for (const f of a.safety_flags) items.push({ t: f.start_s, end: f.end_s, label: `Safety flag: ${FLAG_LABEL[f.kind] || f.kind} (${f.severity}). ${f.description}` });
  const timed = items.filter((it) => it.t != null).sort((x, y) => x.t - y.t); // stable: ties keep their order
  return [...timed, ...items.filter((it) => it.t == null)];
}

// Steps through the items by position, so items that share a time are each visited.
function nextItem() {
  const items = reviewItems();
  if (!items.length) {
    $("#next-label").textContent = "Nothing flagged for review.";
    return;
  }
  state.itemIndex = (state.itemIndex + 1) % items.length;
  const i = state.itemIndex;
  const item = items[i];
  const span = item.end != null && item.end > item.t ? fmtRange(item.t, item.end) : fmtTime(item.t);
  const where = item.t != null ? `at ${span}` : "(not located in the video)";
  $("#next-label").textContent = `Item ${i + 1} of ${items.length} ${where}: ${item.label}`;
  if (item.step) {
    state.selected = item.step.step_id;
    if ($("#compare").checked) playReference(item.step);
  }
  if (item.t != null) seek(item.t, item.end);
  else if (item.step) focusCard(item.step);
}

// The step j and k move from: the one last jumped to while the playhead is still in it
// (or it has no place in the video), else the one under the playhead.
function currentStepId() {
  const selected = state.selected && stepById(state.selected);
  if (selected) {
    const times = stepTimes(selected);
    const t = video.currentTime || 0;
    // The small allowance past the end covers a stretch that stopped a moment late.
    if (!times || (t >= times.start - 0.5 && t < (times.end ?? times.start + 1) + 0.3)) return selected.step_id;
  }
  return state.playing;
}

// j and k walk the steps in video order, then on to the steps with no place in the video.
function moveStep(direction) {
  const located = locatedSteps();
  const list = [...located, ...unlocatedSteps()];
  if (!list.length) return;
  const i = list.findIndex((s) => s.step_id === currentStepId());
  let target;
  if (i !== -1) {
    target = list[i + direction];
  } else {
    const t = video.currentTime || 0;
    target = direction > 0
      ? located.find((s) => stepTimes(s).start > t + 0.3) || list[located.length]
      : [...located].reverse().find((s) => stepTimes(s).start < t - 1);
  }
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
    if (step && Number(chip.dataset.seek) === stepTimes(step)?.start) { jumpToStep(step); return; }
    seek(chip.dataset.seek, chip.dataset.end);
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
  const step = stepById(state.selected) || stepById(state.playing) || locatedSteps()[0] || steps()[0];
  if (step) { state.selected = step.step_id; playReference(step); }
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
