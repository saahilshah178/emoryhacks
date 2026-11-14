// Shared helpers for every FirstShift screen. Loaded as an ES module.
// Each page calls mountNav("<page>") once, then uses api(), fmtTime(), badge() etc.

const PAGES = [
  { id: "home", href: "/index.html", label: "Skills", roles: ["nurse", "caregiver"] },
  { id: "record", href: "/record.html", label: "Record reference", roles: ["nurse"] },
  { id: "attempt", href: "/attempt.html", label: "Practice a skill", roles: ["caregiver"] },
  { id: "attempts", href: "/attempts.html", label: "Attempts", roles: ["nurse", "caregiver"] },
  { id: "dashboard", href: "/dashboard.html", label: "Safety dashboard", roles: ["nurse"] },
];

export function getRole() {
  try { return localStorage.getItem("firstshift.role") || "nurse"; } catch { return "nurse"; }
}

export function setRole(role) {
  try { localStorage.setItem("firstshift.role", role); } catch { /* storage unavailable */ }
}

export function mountNav(active) {
  const role = getRole();
  const nav = document.createElement("nav");
  nav.className = "nav";
  const links = PAGES.filter((p) => p.roles.includes(role))
    .map((p) => `<a class="link ${p.id === active ? "active" : ""}" href="${p.href}">${p.label}</a>`)
    .join("");
  nav.innerHTML = `
    <a class="brand" href="/index.html">FirstShift</a>
    ${links}
    <span class="spacer"></span>
    <span class="role-toggle" role="group" aria-label="Role">
      <button data-role="nurse" class="${role === "nurse" ? "on" : ""}">Nurse</button>
      <button data-role="caregiver" class="${role === "caregiver" ? "on" : ""}">Caregiver</button>
    </span>`;
  nav.querySelectorAll("[data-role]").forEach((b) =>
    b.addEventListener("click", () => { setRole(b.dataset.role); location.reload(); }));
  document.body.prepend(nav);
  return role;
}

export async function api(path, options = {}) {
  const init = { ...options };
  if (init.json !== undefined) {
    init.method = init.method || "POST";
    init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    init.body = JSON.stringify(init.json);
    delete init.json;
  }
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not json */ }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.status === 204 ? null : res.json();
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// 75.4 -> "1:15"
export function fmtTime(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "--:--";
  const s = Math.max(0, Math.floor(Number(seconds)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function fmtRange(start, end) {
  return `${fmtTime(start)}–${fmtTime(end)}`;
}

export function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
}

const STATUS_LABEL = { passed: "Passed", failed: "Failed", unverified: "Unverified", pending: "Pending" };

export function badge(status) {
  const s = status || "pending";
  return `<span class="badge ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
}

export function videoUrl(videoId) {
  return `/api/videos/${videoId}/file`;
}

export function thumbUrl(videoId, t) {
  return `/api/videos/${videoId}/thumb?t=${Number(t || 0).toFixed(1)}`;
}

// Poll a pipeline job until it finishes. onUpdate(job) is called on every poll.
export async function pollJob(jobId, onUpdate, intervalMs = 2000) {
  for (;;) {
    const job = await api(`/jobs/${jobId}`);
    if (onUpdate) onUpdate(job);
    if (job.status === "done" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export function stagesHtml(job) {
  const items = (job.stages || [])
    .map((s) => `<span class="badge ${s.status === "done" ? "passed" : s.status === "error" ? "failed" : s.status === "running" ? "running" : "pending"}"
      title="${esc(s.error || "")}">${esc(s.name.replace(/_/g, " "))}${s.seconds != null ? ` · ${s.seconds}s` : ""}</span>`)
    .join("");
  return `<div class="stages">${items}</div>`;
}

export function showError(target, err) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (el) el.innerHTML = `<p class="error">${esc(err.message || err)}</p>`;
}
