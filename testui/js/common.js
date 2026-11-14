// Shared helpers for every screen of the built-in test UI. Loaded as an ES module.
// Each page calls mountNav("<page>") once, then uses api(), fmtTime(), badge() etc.

const PAGES = [
  { id: "home", href: "/index.html", label: "Skills", roles: ["nurse", "caregiver"] },
  { id: "record", href: "/record.html", label: "Record reference", roles: ["nurse"] },
  { id: "attempt", href: "/attempt.html", label: "Practice a skill", roles: ["caregiver"] },
  { id: "attempts", href: "/attempts.html", label: "Attempts", roles: ["nurse", "caregiver"] },
  { id: "dashboard", href: "/dashboard.html", label: "Safety dashboard", roles: ["nurse"] },
];

const ROLE_KEY = "testui.role";

// The role of the signed-in account, remembered from the last page load so the nav can be
// drawn at once. mountNav() checks it against the server and reloads if it was stale.
export function getRole() {
  try { return localStorage.getItem(ROLE_KEY) || "nurse"; } catch { return "nurse"; }
}

function rememberRole(role) {
  try { localStorage.setItem(ROLE_KEY, role); } catch { /* storage unavailable */ }
}

function toLogin() {
  if (location.pathname === "/login.html") return;
  location.replace(`/login.html?next=${encodeURIComponent(location.pathname + location.search)}`);
}

let userPromise = null;
// The signed-in user, or null. One request per page.
export function currentUser() {
  userPromise ||= fetch("/api/auth/session").then((res) => res.json()).then((body) => body.user).catch(() => null);
  return userPromise;
}

export function mountNav(active) {
  const role = getRole();
  const nav = document.createElement("nav");
  nav.className = "nav";
  const links = PAGES.filter((p) => p.roles.includes(role))
    .map((p) => `<a class="link ${p.id === active ? "active" : ""}" href="${p.href}">${p.label}</a>`)
    .join("");
  nav.innerHTML = `
    <a class="brand" href="/index.html">Test UI</a>
    ${links}
    <span class="spacer"></span>
    <span class="small muted" id="nav-user"></span>
    <span class="role-toggle"><button id="nav-signout" type="button">Sign out</button></span>`;
  nav.querySelector("#nav-signout").addEventListener("click", async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    location.replace("/login.html");
  });
  document.body.prepend(nav);
  currentUser().then((user) => {
    if (!user) return toLogin();
    if (user.role !== role) {
      rememberRole(user.role);
      location.reload();
      return;
    }
    nav.querySelector("#nav-user").textContent = `${user.name} · ${user.role} · ${user.org.name}`;
  });
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
  if (res.status === 401 && !path.startsWith("/auth/")) toLogin();
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not json */ }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (path === "/auth/login" || path === "/auth/signup") userPromise = null;
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

function hasEnd(start, end) {
  return end !== null && end !== undefined && end !== "" && Number(end) > Number(start);
}

// A clickable timestamp. With an end it reads "0:12–0:31", and pressing it plays that stretch
// and stops at its end (the page passes data-seek and data-end to playSegment). With no end
// it shows the one time and plays on from there.
export function timeChip(start, end, title) {
  if (start === null || start === undefined || Number.isNaN(Number(start))) return "";
  const ranged = hasEnd(start, end);
  const label = ranged ? fmtRange(start, end) : fmtTime(start);
  const hint = title || (ranged ? `Play ${label}, then stop` : `Play from ${label}`);
  return `<button class="time" type="button" data-seek="${Number(start)}"${ranged ? ` data-end="${Number(end)}"` : ""} title="${esc(hint)}">${label}</button>`;
}

const armedStops = new WeakMap(); // video element -> function that cancels its pending stop
// Stop this far before the end, so the playhead rests inside the stretch just played rather
// than on the first frame of whatever follows it.
const STOP_LEAD_S = 0.05;

// Play the video from start and pause it when it reaches end. Afterwards the viewer can
// press play to carry on watching: the stop only happens once. It is also dropped if they
// drag the playhead out of the stretch, or another stretch is started. With no end, the
// video just plays from start.
export function playSegment(video, start, end) {
  armedStops.get(video)?.();
  const from = Math.max(0, Number(start) || 0);
  video.currentTime = from;
  if (hasEnd(from, end)) {
    const to = Number(end);
    const stopAt = Math.max(from, to - STOP_LEAD_S);
    let frame = 0;
    let ownSeek = true; // the seek above is ours, not the viewer scrubbing
    const disarm = () => {
      cancelAnimationFrame(frame);
      for (const [name, fn] of listeners) video.removeEventListener(name, fn);
      armedStops.delete(video);
    };
    const reached = () => {
      if (video.currentTime < stopAt) return false;
      disarm();
      video.pause();
      return true;
    };
    // timeupdate fires only about four times a second, so also check on every frame.
    const watch = () => { if (!reached() && !video.paused) frame = requestAnimationFrame(watch); };
    const restart = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(watch); };
    const scrubbed = () => {
      if (ownSeek) { ownSeek = false; return; }
      if (video.currentTime < from - 0.25 || video.currentTime >= to) disarm();
    };
    const listeners = [["timeupdate", reached], ["play", restart], ["seeking", scrubbed], ["emptied", disarm]];
    for (const [name, fn] of listeners) video.addEventListener(name, fn);
    armedStops.set(video, disarm);
    restart(); // already playing means no "play" event will come to start the per-frame check
  }
  video.play().catch(() => { /* autoplay can be refused; the seek still happened */ });
}

export function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
}

const STATUS_LABEL = {
  passed: "Passed", failed: "Failed", unverified: "Unverified", pending: "Pending", error: "Processing error",
};

export function badge(status) {
  const s = status || "pending";
  return `<span class="badge ${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;
}

// The status an attempts list shows. A job that crashed never graded anything, so it
// reads "Processing error" rather than "Failed", which would blame the caregiver.
export function attemptListStatus(a) {
  if (a.nurse_status) return a.nurse_status;
  if (a.status) return a.status;
  return a.job_status === "error" ? "error" : "pending";
}

// "5 of 7 steps passed", counting the nurse's decision where there is one.
export function stepTally(steps) {
  const list = steps || [];
  const passed = list.filter((s) => (s.nurse_status || s.status) === "passed").length;
  return `${passed} of ${list.length} step${list.length === 1 ? "" : "s"} passed`;
}

// "infection_control" -> "Infection control". Also turns skill slugs into names.
export function humanize(slug) {
  const text = String(slug ?? "").replace(/_/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

export function videoUrl(videoId) {
  return `/api/videos/${videoId}/file`;
}

export function thumbUrl(videoId, t) {
  return `/api/videos/${videoId}/thumb?t=${Number(t || 0).toFixed(1)}`;
}

// Poll a pipeline job until it finishes. onUpdate(job) is called on every poll.
// A failed request is retried with a longer wait, since one dropped connection says
// nothing about the job; after `tries` failures in a row the last error is thrown.
export async function pollJob(jobId, onUpdate, intervalMs = 2000, tries = 4) {
  let failures = 0;
  for (;;) {
    let job = null;
    try {
      job = await api(`/jobs/${jobId}`);
      failures = 0;
    } catch (err) {
      failures += 1;
      if (failures >= tries) throw err;
    }
    if (job) {
      if (onUpdate) onUpdate(job);
      if (job.status === "done" || job.status === "error") return job;
    }
    await new Promise((r) => setTimeout(r, intervalMs * (failures + 1)));
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
