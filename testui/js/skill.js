// Skill screen: the reference video, its rubric steps with jump-to-step links, and an
// edit mode that saves through PATCH /api/skills/{id} and /api/skills/{id}/steps/{step_id}.
import {
  api, esc, fmtRange, fmtTime, mountNav, pollJob, qs, showError, stagesHtml, thumbUrl, videoUrl,
} from "/js/common.js";

const role = mountNav("home");
const skillId = qs("id");
const $ = (sel) => document.querySelector(sel);

let skill = null;
let editing = false;
let video = null;          // the <video> element
let stopAt = null;         // pause here after a step chip started playback
let seekFromChip = false;  // distinguishes our own seeks from the user scrubbing

// --- loading -----------------------------------------------------------------
async function load() {
  if (!skillId) throw new Error("No skill id in the address. Open a skill from the Skills page.");
  skill = await api(`/skills/${skillId}`);
  document.title = `${skill.name} · FirstShift`;
  renderPlayer();
  render();
}

function render() {
  $("#head").innerHTML = editing ? headEditHtml() : headHtml();
  $("#context").innerHTML = editing ? safetyEditHtml() : contextHtml();
  $("#steps-label").textContent = `Steps (${skill.steps.length})`;
  $("#steps").innerHTML = skill.steps.map(editing ? stepEditHtml : stepHtml).join("");
  $("#edit-bar").innerHTML = editing ? editButtonsHtml() : "";
  highlight();
}

// --- read mode ---------------------------------------------------------------
function headHtml() {
  const facts = [skill.category, `${skill.steps.length} steps`, skill.video ? fmtTime(skill.video.duration_s) : null]
    .filter(Boolean).map(esc).join(" · ");
  return `<div class="header">
      <div>
        <h1>${esc(skill.name)}</h1>
        <p class="muted">Version ${skill.version} · ${facts}</p>
        ${skill.summary ? `<p class="summary">${esc(skill.summary)}</p>` : ""}
      </div>
      <div class="head-actions">
        <a class="btn primary" href="/attempt.html?skill_id=${encodeURIComponent(skill.id)}">Practice this skill</a>
        ${role === "nurse" ? `<button class="btn" data-action="edit">Edit skill</button>
          <button class="btn" data-action="regenerate" title="Run the rubric stage on the reference video again">Rebuild steps</button>` : ""}
      </div>
    </div>`;
}

function contextHtml() {
  const safety = skill.safety_criteria || [];
  const people = skill.people || [];
  return `<div class="card">
      <h3>Safety throughout</h3>
      ${safety.length ? `<ul class="tight">${safety.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>`
        : `<p class="muted small">No safety criteria recorded.</p>`}
    </div>
    <div class="card">
      <h3>People in the reference</h3>
      ${people.length ? `<ul class="tight people">${people.map((p) => `<li>
          <span class="badge neutral">${esc(p.role)}</span> <strong>${esc(p.label)}</strong>
          <span class="muted small">${esc(p.description)}</span></li>`).join("")}</ul>`
        : `<p class="muted small">No people identified.</p>`}
    </div>`;
}

function stepHtml(s) {
  const ev = s.evals || {};
  const order = Object.fromEntries(skill.steps.map((x) => [x.step_id, x.ord]));
  const after = (s.must_follow || []).map((id) => order[id]).filter(Boolean);
  const list = (items) => (items && items.length
    ? `<ul class="tight">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : `<p class="muted small">None</p>`);
  const thumb = skill.video
    ? `<img class="thumb" data-seek="${s.step_id}" src="${thumbUrl(skill.video.id, (s.start_s + s.end_s) / 2)}" alt="" loading="lazy">` : "";
  return `<div class="card step" data-step="${s.step_id}">
      <div class="row">
        ${thumb}
        <div class="grow">
          <h3>${s.ord}. ${esc(s.title)}</h3>
          <p class="muted">${esc(s.description)}</p>
          <div class="step-meta">
            <button class="chip" data-seek="${s.step_id}" title="Play this step">${fmtRange(s.start_s, s.end_s)}</button>
            ${s.critical ? `<span class="badge critical">Critical</span>` : ""}
            ${after.length ? `<span class="muted small">after step ${after.join(", ")}</span>` : ""}
          </div>
          <details class="criteria">
            <summary>What passes, what fails, when it can't be judged</summary>
            <div class="criteria-grid">
              <div class="pass"><h4>Pass</h4>${list(ev.pass_criteria)}</div>
              <div class="fail"><h4>Fail</h4>${list(ev.fail_criteria)}</div>
              <div class="unv"><h4>Unverified when</h4>${list(ev.unverified_when)}</div>
            </div>
          </details>
        </div>
      </div>
    </div>`;
}

// --- edit mode ---------------------------------------------------------------
const lines = (items) => esc((items || []).join("\n"));
const round1 = (x) => Math.round(Number(x) * 10) / 10;  // times are stored as float4

function headEditHtml() {
  return `<div class="card">
      <label for="f-name">Skill name</label>
      <input type="text" id="f-name" value="${esc(skill.name)}">
      <label for="f-summary">Summary</label>
      <textarea id="f-summary">${esc(skill.summary)}</textarea>
      <p class="muted small">Version ${skill.version}. Lists take one item per line.</p>
      ${editButtonsHtml()}
    </div>`;
}

function safetyEditHtml() {
  return `<div class="card" style="grid-column: 1 / -1">
      <label for="f-safety">Safety criteria (one per line)</label>
      <textarea id="f-safety">${lines(skill.safety_criteria)}</textarea>
    </div>`;
}

function stepEditHtml(s) {
  const ev = s.evals || {};
  return `<div class="card step" data-step="${s.step_id}">
      <div class="edit-grid">
        <div class="full"><label>${s.ord}. Title</label><input type="text" data-field="title" value="${esc(s.title)}"></div>
        <div class="full"><label>Description</label><textarea data-field="description">${esc(s.description)}</textarea></div>
        <div>
          <label>Start and end (seconds)</label>
          <div class="times">
            <input type="number" step="0.1" min="0" data-field="start_s" value="${round1(s.start_s)}" aria-label="Start seconds">
            <input type="number" step="0.1" min="0" data-field="end_s" value="${round1(s.end_s)}" aria-label="End seconds">
            <button class="chip" data-seek="${s.step_id}" type="button" title="Play these times">Play</button>
          </div>
        </div>
        <div><label>&nbsp;</label><label class="inline"><input type="checkbox" data-field="critical" ${s.critical ? "checked" : ""}> Critical step</label></div>
        <div class="full"><label>Pass criteria</label><textarea data-field="pass_criteria">${lines(ev.pass_criteria)}</textarea></div>
        <div class="full"><label>Fail criteria</label><textarea data-field="fail_criteria">${lines(ev.fail_criteria)}</textarea></div>
        <div class="full"><label>Unverified when</label><textarea data-field="unverified_when">${lines(ev.unverified_when)}</textarea></div>
      </div>
      <p class="error small" data-error></p>
    </div>`;
}

function editButtonsHtml() {
  return `<div class="edit-bar">
      <span class="error" data-save-error></span>
      <button class="btn" data-action="cancel">Cancel</button>
      <button class="btn primary" data-action="save">Save</button>
    </div>`;
}

const splitLines = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean);

// Read one step's form. Returns {patch} with only the changed fields, or {error}.
function readStepForm(s) {
  const card = document.querySelector(`.step[data-step="${s.step_id}"]`);
  const field = (name) => card.querySelector(`[data-field="${name}"]`);
  const values = {
    title: field("title").value.trim(),
    description: field("description").value.trim(),
    critical: field("critical").checked,
    start_s: Number(field("start_s").value),
    end_s: Number(field("end_s").value),
  };
  const evals = {
    ...(s.evals || {}),
    pass_criteria: splitLines(field("pass_criteria").value),
    fail_criteria: splitLines(field("fail_criteria").value),
    unverified_when: splitLines(field("unverified_when").value),
  };
  const duration = skill.video ? skill.video.duration_s : Infinity;
  let error = "";
  if (!values.title) error = "Give the step a title.";
  else if (!(values.start_s >= 0 && values.end_s > values.start_s)) error = "End must be after start.";
  else if (values.end_s > duration + 0.5) error = `The video is only ${fmtTime(duration)} long.`;
  else if (!evals.pass_criteria.length || !evals.fail_criteria.length || !evals.unverified_when.length) {
    error = "Each criteria list needs at least one line.";
  }
  card.querySelector("[data-error]").textContent = error;
  if (error) return { error };
  const patch = {};
  const current = { ...s, start_s: round1(s.start_s), end_s: round1(s.end_s) };
  for (const [key, value] of Object.entries(values)) if (value !== current[key]) patch[key] = value;
  if (JSON.stringify(evals) !== JSON.stringify(s.evals)) patch.evals = evals;
  return { patch };
}

async function save() {
  const forms = skill.steps.map((s) => ({ step: s, ...readStepForm(s) }));
  const showSaveError = (msg) => document.querySelectorAll("[data-save-error]").forEach((el) => { el.textContent = msg; });
  if (forms.some((f) => f.error)) return showSaveError("Fix the highlighted steps first.");
  const name = $("#f-name").value.trim();
  if (!name) return showSaveError("The skill needs a name.");
  document.querySelectorAll('[data-action="save"]').forEach((b) => { b.disabled = true; });
  try {
    await api(`/skills/${skill.id}`, {
      method: "PATCH",
      json: { name, summary: $("#f-summary").value.trim(), safety_criteria: splitLines($("#f-safety").value) },
    });
    for (const f of forms) {
      if (Object.keys(f.patch).length) {
        await api(`/skills/${skill.id}/steps/${f.step.step_id}`, { method: "PATCH", json: f.patch });
      }
    }
    skill = await api(`/skills/${skill.id}`);
    editing = false;
    render();
  } catch (err) {
    showSaveError(`Could not save: ${err.message}`);
    document.querySelectorAll('[data-action="save"]').forEach((b) => { b.disabled = false; });
  }
}

// --- rebuild from the reference video ------------------------------------------
async function regenerate() {
  if (!confirm("Rebuild the steps from the reference video? This replaces the current steps and any edits to them.")) return;
  const box = $("#job");
  try {
    const { job_id: jobId } = await api(`/skills/${skill.id}/regenerate`, { method: "POST" });
    const job = await pollJob(jobId, (j) => {
      box.innerHTML = `<div class="notice">Rebuilding steps from the reference video…${stagesHtml(j)}</div>`;
    });
    if (job.status === "error") throw new Error(job.error || "The rebuild failed.");
    box.innerHTML = "";
    skill = await api(`/skills/${skill.id}`);
    render();
  } catch (err) {
    showError(box, err);
  }
}

// --- video player and step highlighting ----------------------------------------
function renderPlayer() {
  if (!skill.video) {
    $("#player").innerHTML = `<div class="notice">This skill has no reference video.</div>`;
    return;
  }
  const first = skill.steps[0];
  const poster = thumbUrl(skill.video.id, first ? (first.start_s + first.end_s) / 2 : 0);
  $("#player").innerHTML = `<video controls preload="metadata" poster="${poster}" src="${videoUrl(skill.video.id)}"></video>`;
  video = $("#player video");
  video.addEventListener("timeupdate", () => {
    if (stopAt !== null && video.currentTime >= stopAt) { video.pause(); stopAt = null; }
    highlight();
  });
  video.addEventListener("seeked", () => {
    if (seekFromChip) seekFromChip = false; else stopAt = null;
    highlight();
  });
}

function playStep(stepId) {
  const s = skill.steps.find((x) => x.step_id === stepId);
  if (!s || !video) return;
  let start = s.start_s;
  let end = s.end_s;
  if (editing) {  // play what is in the form, so times can be checked before saving
    const card = document.querySelector(`.step[data-step="${stepId}"]`);
    start = Number(card.querySelector('[data-field="start_s"]').value) || 0;
    end = Number(card.querySelector('[data-field="end_s"]').value) || start + 1;
  }
  seekFromChip = true;
  stopAt = end;
  video.currentTime = start;
  video.play().catch(() => { /* autoplay can be refused; the seek still happened */ });
  video.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function highlight() {
  if (!video || !skill) return;
  const t = video.currentTime;
  document.querySelectorAll(".step[data-step]").forEach((card) => {
    const s = skill.steps.find((x) => x.step_id === card.dataset.step);
    card.classList.toggle("active", !!s && t > 0 && t >= s.start_s && t < s.end_s);
  });
}

// --- events ----------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const seek = e.target.closest("[data-seek]");
  if (seek) { e.preventDefault(); playStep(seek.dataset.seek); return; }
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (action === "edit") { editing = true; render(); }
  if (action === "cancel") { editing = false; render(); }
  if (action === "save") save();
  if (action === "regenerate") regenerate();
});

load().catch((err) => showError("#head", err));
