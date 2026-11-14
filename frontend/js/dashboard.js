// Safety dashboard: every number comes from /api/safety/*, which reads Tiger Data.
// Charts use uPlot (loaded as a global from jsDelivr in dashboard.html).
import { api, mountNav, esc, fmtTime, fmtDate, badge, videoUrl, qs, showError } from "/js/common.js";

mountNav("dashboard");

// One colour per role, used by every chart, legend and table on this page.
const ROLE_COLOURS = { caregiver: "#2f6db5", patient: "#c2410c", other: "#5f8a2e", unknown: "#9a8f83" };
const SKILL_COLOURS = ["#2f6db5", "#c2410c", "#5f8a2e", "#8e44ad", "#b8860b", "#16808a", "#a33b5b"];
const roleColour = (role) => ROLE_COLOURS[role] || ROLE_COLOURS.unknown;

const pct = (v) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num = (v, d = 0) => (v == null ? "—" : Number(v).toFixed(d));
const deg = (v) => (v == null ? "—" : `${Math.round(v)}°`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// FastAPI sends intervals as seconds: 300 -> "5 min", 86400 -> "1 day".
function fmtInterval(seconds) {
  if (seconds == null) return "—";
  if (seconds % 86400 === 0) return plural(seconds / 86400, "day");
  if (seconds % 3600 === 0) return plural(seconds / 3600, "hour");
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds} s`;
}

const player = document.querySelector("#player");
let charts = [];          // uPlot instances in the detail view, for the playhead and resizing
let current = null;       // {videoId, summary}

// --- overview ---------------------------------------------------------------
async function loadOverview() {
  const [rows, storage] = await Promise.all([api("/safety/overview"), api("/safety/storage")]);
  renderTiles(rows, storage);
  renderTable(rows);
  renderStorage(storage);
  return rows;
}

function mean(values) {
  const v = values.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function renderTiles(rows, storage) {
  const attempts = rows.filter((r) => r.kind === "attempt");
  const tiles = [
    [rows.length, "videos analysed", `${plural(attempts.length, "attempt")} · ${plural(rows.length - attempts.length, "reference")}`],
    [(storage.rows?.pose_frames ?? 0).toLocaleString(), "person-frames stored", "one row per person per sampled frame"],
    [num(mean(rows.map((r) => r.patient_balance_avg)), 2), "patient balance, average", "1 is centred over the feet"],
    [pct(mean(rows.map((r) => r.patient_off_center_share))), "patient time off-centre", "centre of mass past the feet"],
    [pct(mean(rows.map((r) => r.caregiver_bent_share))), "caregiver time bent past 60°", "trunk tilt from upright"],
    [rows.reduce((a, r) => a + (r.flag_count || 0), 0), "safety flags",
      `${rows.reduce((a, r) => a + (r.high_flag_count || 0), 0)} high severity`],
  ];
  document.querySelector("#tiles").innerHTML = tiles.map(([n, what, sub]) =>
    `<div class="tile"><div class="num">${esc(n)}</div><div class="what">${esc(what)}</div>
     <div class="muted small">${esc(sub)}</div></div>`).join("");
}

function renderTable(rows) {
  const el = document.querySelector("#videos");
  if (!rows.length) {
    el.innerHTML = `<p class="muted">No pose data yet. Record a reference or an attempt, or run <code>make fake-demo</code>.</p>`;
    return;
  }
  el.innerHTML = `<table>
    <tr><th>Video</th><th>Skill</th><th>Caregiver</th><th>Result</th><th class="num">People</th>
      <th class="num" title="patient balance: average / lowest">Patient balance</th><th class="num">Off-centre</th>
      <th class="num" title="caregiver trunk tilt: average / 95th percentile">Caregiver tilt</th><th class="num">Bent &gt;60°</th>
      <th class="num">Flags</th></tr>
    ${rows.map((r) => `<tr class="pick" data-video="${r.video_id}">
      <td><strong>${esc(r.original_name || "video")}</strong><br><span class="muted small">${esc(r.kind)} · ${fmtTime(r.duration_s)} · ${fmtDate(r.recorded_at)}</span></td>
      <td>${esc(r.skill_name || "—")}</td><td>${esc(r.caregiver_name || "—")}</td>
      <td>${r.kind === "attempt" ? badge(r.attempt_status) : `<span class="badge neutral">reference</span>`}</td>
      <td class="num">${r.tracks ?? 0}<span class="muted small">${r.tracks_with_role ? ` (${r.tracks_with_role} with role)` : ""}</span></td>
      <td class="num">${num(r.patient_balance_avg, 2)} / ${num(r.patient_balance_min, 2)}</td>
      <td class="num">${pct(r.patient_off_center_share)}</td>
      <td class="num">${deg(r.caregiver_tilt_avg)} / ${deg(r.caregiver_tilt_peak)}</td>
      <td class="num">${pct(r.caregiver_bent_share)}</td>
      <td class="num">${r.flag_count || 0}${r.high_flag_count ? ` <span class="badge failed">${r.high_flag_count} high</span>` : ""}</td>
    </tr>`).join("")}
  </table>`;
  el.querySelectorAll("tr.pick").forEach((tr) => tr.addEventListener("click", () => openVideo(tr.dataset.video, true)));
}

function renderStorage(s) {
  const el = document.querySelector("#storage");
  const job = (name) => (s.jobs || []).find((j) => (j.application_name || "").includes(name)) || {};
  const chunks = (s.chunks || []).filter((c) => !c.error);
  const items = [
    ["Database", `${esc(s.database?.name)} · TimescaleDB ${esc(s.database?.timescaledb)} · toolkit ${esc(s.database?.toolkit || "—")}`],
    ["Hypertable", `pose_frames · ${(s.rows?.pose_frames ?? 0).toLocaleString()} rows from ${s.rows?.videos ?? 0} videos`],
    ["Size", `${esc(s.size?.total || "—")} (table ${fmtBytes(s.size?.table_bytes)}, indexes ${fmtBytes(s.size?.index_bytes)})`],
    ["Chunks", `${s.hypertable?.num_chunks ?? chunks.length} of one day each · ${chunks.filter((c) => c.in_columnstore).length} in the columnstore`],
    ["Columnstore", s.hypertable?.columnstore_enabled
      ? `on · segment by ${esc(s.columnstore?.segmentby || "—")} · order by ${esc(s.columnstore?.orderby || "—")} · policy every ${fmtInterval(job("Columnstore").schedule_interval)}`
      : "off"],
    ["Rollup", s.rollup?.view_name
      ? `${esc(s.rollup.view_name)} continuous aggregate · ${(s.rollup.rows ?? 0).toLocaleString()} one-second rows · materialised up to ${fmtDate(s.rollup.watermark)}${s.rollup.materialized_only ? "" : " · real-time on"}`
      : "—"],
    ["Rollup refresh", job("Refresh").job_id
      ? `every ${fmtInterval(job("Refresh").schedule_interval)} · last run ${esc(job("Refresh").last_run_status || "not yet")}${job("Refresh").last_successful_finish ? ` at ${fmtDate(job("Refresh").last_successful_finish)}` : ""}`
      : "—"],
    ["Time span", s.rows?.first_ts ? `${fmtDate(s.rows.first_ts)} to ${fmtDate(s.rows.last_ts)}` : "—"],
  ];
  el.innerHTML = `<dl>${items.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

function fmtBytes(b) {
  if (b == null) return "—";
  return b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.round(b / 1024)} kB`;
}

// --- detail -----------------------------------------------------------------
async function openVideo(videoId, scroll) {
  document.querySelectorAll("tr.pick").forEach((tr) => tr.classList.toggle("on", tr.dataset.video === videoId));
  history.replaceState(null, "", `?video=${videoId}`);
  const section = document.querySelector("#detail");
  section.hidden = false;
  if (scroll) section.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const summary = await api(`/safety/videos/${videoId}/summary`);
    current = { videoId, summary };
    const v = summary.video;
    document.querySelector("#detail-title").textContent = v.original_name || "Video";
    document.querySelector("#detail-sub").textContent = [summary.skill?.skill_name, v.kind,
      summary.attempt?.caregiver_name && `caregiver ${summary.attempt.caregiver_name}`, fmtTime(v.duration_s),
      `${summary.segments} camera shot${summary.segments === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
    if (player.dataset.video !== videoId) {
      player.src = videoUrl(videoId);
      player.dataset.video = videoId;
    }
    renderFlags(summary);
    renderTracks(summary);
    const bucket = v.duration_s <= 90 ? 0.5 : v.duration_s <= 300 ? 1 : 2;
    const series = await api(`/safety/videos/${videoId}/series?bucket_s=${bucket}`);
    charts.forEach((c) => c.destroy());
    charts = [];
    charts.push(balanceChart(series, summary), tiltChart(series, summary));
    await jointChart();
  } catch (err) { showError("#flags", err); }
}

function trackLabel(t) {
  return `${t.role === "unknown" ? "person" : t.role} · track ${t.person_idx}`;
}

function renderFlags(summary) {
  const stored = summary.flags.map((f) => ({ ...f, origin: f.source === "gemini" ? "Gemini" : f.source === "pose_confirmed" ? "pose, confirmed" : "pose" }));
  const windows = summary.pose_windows.map((w) => ({ ...w, origin: "pose reading" }));
  const all = [...stored, ...windows].sort((a, b) => a.start_s - b.start_s);
  document.querySelector("#flags").innerHTML = all.length ? all.map((f) => `<div class="flag">
      <button class="time" data-seek="${f.start_s}">${fmtTime(f.start_s)}</button>
      <div class="grow"><span class="badge sev-${esc(f.severity)}">${esc(f.severity)}</span>
        <strong>${esc(f.kind.replace(/_/g, " "))}</strong> <span class="muted small">${esc(f.person_label || "")} · ${esc(f.origin)}${f.counts_toward_score ? " · counts toward score" : ""}</span>
        <div class="small">${esc(f.description)}</div></div></div>`).join("")
    : `<p class="muted small">No flags and no sustained off-centre or extreme-tilt windows.</p>`;
}

function renderTracks(summary) {
  const rows = summary.tracks;
  document.querySelector("#tracks").innerHTML = rows.length ? `<table>
    <tr><th>Person</th><th>Seen</th><th class="num">Valid</th><th class="num">Balance</th><th class="num">Off-centre</th>
      <th class="num">Tilt avg / p95</th><th class="num">Bent</th></tr>
    ${rows.map((t) => `<tr>
      <td><span class="chip" style="background:${roleColour(t.role)}"></span>${esc(trackLabel(t))}</td>
      <td><button class="time" data-seek="${t.first_t}">${fmtRange(t.first_t, t.last_t)}</button></td>
      <td class="num">${pct(t.valid_share)}</td><td class="num">${num(t.balance_avg, 2)}</td>
      <td class="num">${pct(t.off_center_share)}</td><td class="num">${deg(t.tilt_avg)} / ${deg(t.tilt_p95)}</td>
      <td class="num">${pct(t.bent_share)}</td></tr>`).join("")}
  </table>` : `<p class="muted small">Nobody was detected in this video.</p>`;
}

function fmtRange(a, b) { return `${fmtTime(a)}–${fmtTime(b)}`; }

document.addEventListener("click", (e) => {
  const seek = e.target.closest("[data-seek]");
  if (seek) seekTo(Number(seek.dataset.seek));
});

function seekTo(t) {
  player.currentTime = Math.max(0, t);
  movePlayheads();
}

// --- charts -----------------------------------------------------------------
// Turn rows [{person_idx, role, t_offset, <key>}] into uPlot data: one x array and one
// array per person. Buckets come gap-filled, so a null means the person was not seen.
function alignRows(rows, key) {
  const xs = [...new Set(rows.map((r) => r.t_offset))].sort((a, b) => a - b);
  const index = new Map(xs.map((x, i) => [x, i]));
  const people = new Map();
  for (const r of rows) {
    if (!people.has(r.person_idx)) people.set(r.person_idx, { role: r.role, values: new Array(xs.length).fill(null) });
    people.get(r.person_idx).values[index.get(r.t_offset)] = r[key];
  }
  const kept = [...people.entries()].filter(([, p]) => p.values.some((v) => v != null));
  return { xs, people: kept.map(([idx, p]) => ({ idx, role: p.role, values: p.values })) };
}

function legendHtml(people, extra = "") {
  const roles = [...new Set(people.map((p) => p.role))];
  return roles.map((r) => `<span><span class="chip" style="background:${roleColour(r)}"></span>${esc(r === "unknown" ? "role not known" : r)}
    <span class="muted">(${people.filter((p) => p.role === r).map((p) => `track ${p.idx}`).join(", ")})</span></span>`).join("") + extra;
}

// Draw fn(u, ctx) in canvas pixels, under the grid and series ("drawClear") or on top ("draw").
function canvasHook(hook, fn) {
  return { hooks: { [hook]: [(u) => { u.ctx.save(); fn(u, u.ctx); u.ctx.restore(); }] } };
}

function shadeY(u, ctx, lo, hi, colour) {
  const y0 = u.valToPos(hi, "y", true), y1 = u.valToPos(lo, "y", true);
  ctx.fillStyle = colour;
  ctx.fillRect(u.bbox.left, Math.min(y0, y1), u.bbox.width, Math.abs(y1 - y0));
}

function shadeX(u, ctx, start, end, colour) {
  const x0 = u.valToPos(start, "x", true), x1 = u.valToPos(end ?? start + 0.5, "x", true);
  ctx.fillStyle = colour;
  ctx.fillRect(x0, u.bbox.top, Math.max(2, x1 - x0), u.bbox.height);
}

function lineY(u, ctx, v, colour) {
  const y = u.valToPos(v, "y", true);
  ctx.strokeStyle = colour;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.beginPath(); ctx.moveTo(u.bbox.left, y); ctx.lineTo(u.bbox.left + u.bbox.width, y); ctx.stroke();
}

// A uPlot chart over video time with click-to-seek, a playhead and a value readout.
function makeChart(target, { xs, series, yRange, yLabel, plugins = [], readout, fmt }) {
  const el = document.querySelector(target);
  el.innerHTML = "";
  if (!xs.length || !series.length) {
    el.innerHTML = `<p class="muted small">No readings for this video.</p>`;
    return { destroy() {}, setSize() {}, isEmpty: true };
  }
  const opts = {
    width: el.clientWidth || 600,
    height: 210,
    legend: { show: false },
    cursor: { sync: { key: "pose" }, drag: { x: false, y: false } },
    scales: { x: { time: false, range: [0, current.summary.video.duration_s || xs[xs.length - 1]] }, y: { range: yRange } },
    axes: [
      { values: (u, ticks) => ticks.map((t) => fmtTime(t)), stroke: "#7a6f63", grid: { stroke: "#efe7da" } },
      { label: yLabel, stroke: "#7a6f63", grid: { stroke: "#efe7da" }, size: 50 },
    ],
    series: [{}, ...series.map((s) => ({ stroke: s.colour, width: 2, dash: s.dash, spanGaps: false, points: { show: false } }))],
    plugins,
    hooks: {
      setCursor: [(u) => {
        const i = u.cursor.idx;
        const out = document.querySelector(readout);
        if (i == null) { out.textContent = ""; return; }
        const parts = series.map((s, k) => [s.label, u.data[k + 1][i]]).filter(([, v]) => v != null)
          .map(([label, v]) => `${label}: ${fmt(v)}`);
        out.textContent = `${fmtTime(u.data[0][i])}  ${parts.join(" · ") || "nobody measured here"}`;
      }],
    },
  };
  const u = new uPlot(opts, [xs, ...series.map((s) => s.values)], el);
  const head = document.createElement("div");
  head.className = "playhead";
  u.over.appendChild(head);
  u.playhead = head;
  u.over.addEventListener("click", () => { if (u.cursor.left >= 0) seekTo(u.posToVal(u.cursor.left, "x")); });
  u.over.style.cursor = "pointer";
  movePlayhead(u);
  return u;
}

function windowsOf(summary, kinds) {
  const stored = summary.flags.filter((f) => kinds.includes(f.kind));
  return [...summary.pose_windows.filter((w) => kinds.includes(w.kind)), ...stored];
}

function balanceChart(seriesResp, summary) {
  const { xs, people } = alignRows(seriesResp.rows, "balance_avg");
  const low = summary.thresholds.balance_low;
  const flagged = windowsOf(summary, ["patient_off_center", "patient_unsteady"]);
  document.querySelector("#legend-balance").innerHTML = legendHtml(people,
    `<span><span class="chip line dash" style="color:#b3372f"></span>low balance (${low})</span>
     <span><span class="chip" style="background:rgba(179,55,47,.16)"></span>flagged window</span>`);
  return makeChart("#chart-balance", {
    xs, yRange: [0, 1], yLabel: "balance", readout: "#readout-balance", fmt: (v) => v.toFixed(2),
    series: people.map((p) => ({ label: `track ${p.idx}`, colour: roleColour(p.role), values: p.values })),
    plugins: [
      canvasHook("drawClear", (u, ctx) => flagged.forEach((f) => shadeX(u, ctx, f.start_s, f.end_s, "rgba(179,55,47,.16)"))),
      canvasHook("draw", (u, ctx) => lineY(u, ctx, low, "#b3372f")),
    ],
  });
}

function tiltChart(seriesResp, summary) {
  const { xs, people } = alignRows(seriesResp.rows, "trunk_tilt_avg");
  const th = summary.thresholds;
  const flagged = windowsOf(summary, ["patient_unsteady", "unsafe_caregiver_posture"]);
  document.querySelector("#legend-tilt").innerHTML = legendHtml(people,
    `<span><span class="chip" style="background:rgba(201,152,40,.18)"></span>${th.tilt_caution}–${th.tilt_bent}°</span>
     <span><span class="chip" style="background:rgba(179,55,47,.14)"></span>over ${th.tilt_bent}°</span>`);
  return makeChart("#chart-tilt", {
    xs, yRange: [0, 100], yLabel: "degrees", readout: "#readout-tilt", fmt: (v) => `${Math.round(v)}°`,
    series: people.map((p) => ({ label: `track ${p.idx}`, colour: roleColour(p.role), values: p.values })),
    plugins: [canvasHook("drawClear", (u, ctx) => {
      shadeY(u, ctx, th.tilt_caution, th.tilt_bent, "rgba(201,152,40,.13)");
      shadeY(u, ctx, th.tilt_bent, 100, "rgba(179,55,47,.10)");
      flagged.forEach((f) => shadeX(u, ctx, f.start_s, f.end_s, "rgba(179,55,47,.14)"));
    })],
  });
}

// Joint angles at frame resolution from /frames (lttb). Each series has its own times, so
// they are merged onto one x axis: undefined where a series has no point (uPlot spans
// it) and null where the API marked a gap (uPlot breaks the line).
async function jointChart() {
  const joint = document.querySelector("#joint").value;
  const resp = await api(`/safety/videos/${current.videoId}/frames?metrics=l_${joint},r_${joint}&points=600`);
  const xs = [...new Set(resp.series.flatMap((s) => s.t))].sort((a, b) => a - b);
  const index = new Map(xs.map((x, i) => [x, i]));
  const series = resp.series.map((s) => {
    const values = new Array(xs.length).fill(undefined);
    s.t.forEach((t, k) => { values[index.get(t)] = s.v[k]; });
    const side = s.metric.startsWith("l_") ? "left" : "right";
    return { label: `track ${s.person_idx} ${side}`, colour: roleColour(s.role), dash: side === "right" ? [5, 4] : undefined,
      values, role: s.role, idx: s.person_idx };
  });
  const people = [...new Map(series.map((s) => [s.idx, { idx: s.idx, role: s.role }])).values()];
  document.querySelector("#legend-joint").innerHTML = legendHtml(people,
    `<span><span class="chip line" style="background:#7a6f63"></span>left</span><span><span class="chip line dash" style="color:#7a6f63"></span>right</span>`);
  const old = charts.findIndex((c) => c.jointChart);
  if (old >= 0) { charts[old].destroy(); charts.splice(old, 1); }
  const chart = makeChart("#chart-joint", { xs, yRange: [0, 180], yLabel: "degrees", readout: "#readout-joint",
    fmt: (v) => `${Math.round(v)}°`, series });
  chart.jointChart = true;
  charts.push(chart);
}

document.querySelector("#joint").addEventListener("change", () => current && jointChart());

// --- playhead ---------------------------------------------------------------
function movePlayhead(u) {
  if (!u.playhead) return;
  const x = u.valToPos(player.currentTime || 0, "x");
  u.playhead.style.left = `${x}px`;
  u.playhead.style.display = x >= 0 && x <= u.bbox.width / devicePixelRatio ? "block" : "none";
}

function movePlayheads() { charts.forEach(movePlayhead); }

player.addEventListener("timeupdate", movePlayheads);
player.addEventListener("seeked", movePlayheads);
player.addEventListener("play", function tick() {
  movePlayheads();
  if (!player.paused && !player.ended) requestAnimationFrame(tick);
});

window.addEventListener("resize", () => {
  charts.forEach((c) => { if (!c.isEmpty) c.setSize({ width: c.root.parentElement.clientWidth, height: 210 }); });
  movePlayheads();
});

// --- trends -----------------------------------------------------------------
async function loadTrends() {
  const el = document.querySelector("#trends");
  const data = await api("/safety/trends");
  if (!data.attempts.length) {
    el.innerHTML = `<p class="muted">No attempts with pose data yet.</p>`;
    return;
  }
  const skills = [...new Set(data.attempts.map((a) => a.skill_slug))];
  const colourOf = (slug) => SKILL_COLOURS[skills.indexOf(slug) % SKILL_COLOURS.length];
  el.innerHTML = `
    <div class="legend">${skills.map((s) => `<span><span class="chip" style="background:${colourOf(s)}"></span>${esc(data.attempts.find((a) => a.skill_slug === s).skill_name)}</span>`).join("")}</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div><p class="small muted">Patient balance, average per attempt</p><div class="chart" id="trend-balance"></div></div>
      <div><p class="small muted">Caregiver time bent past 60°, per attempt</p><div class="chart" id="trend-bent"></div></div>
    </div>
    <div class="table-wrap"><table style="margin-top:0.8rem"><tr><th>Day</th><th>Skill</th><th class="num">Attempts</th><th class="num">Patient balance</th>
      <th class="num">Off-centre</th><th class="num">Caregiver tilt avg / p95</th><th class="num">Bent &gt;60°</th></tr>
      ${data.buckets.map((b) => `<tr><td>${new Date(b.bucket).toLocaleDateString([], { dateStyle: "medium" })}</td>
        <td>${esc(b.skill_name)}</td><td class="num">${b.attempts}</td><td class="num">${num(b.patient_balance_avg, 2)}</td>
        <td class="num">${pct(b.patient_off_center_share)}</td><td class="num">${deg(b.caregiver_tilt_avg)} / ${deg(b.caregiver_tilt_peak)}</td>
        <td class="num">${pct(b.caregiver_bent_share)}</td></tr>`).join("")}</table></div>`;
  const xs = data.attempts.map((a) => new Date(a.recorded_at).getTime() / 1000);
  const pad = Math.max(86400, 0.05 * (xs[xs.length - 1] - xs[0]));  // keep a lone attempt from spanning years
  const trend = (target, key, range, fmt) => {
    const box = document.querySelector(target);
    const series = skills.map((slug) => data.attempts.map((a) => (a.skill_slug === slug ? a[key] : undefined)));
    new uPlot({
      width: box.clientWidth || 400, height: 190, legend: { show: false },
      scales: { x: { time: true, range: [xs[0] - pad, xs[xs.length - 1] + pad] }, y: { range } },
      axes: [{ stroke: "#7a6f63", grid: { stroke: "#efe7da" } },
        { stroke: "#7a6f63", grid: { stroke: "#efe7da" }, values: (u, t) => t.map(fmt), size: 50 }],
      series: [{}, ...skills.map((slug) => ({ stroke: colourOf(slug), width: 2, points: { show: true, size: 7, fill: colourOf(slug) } }))],
    }, [xs, ...series], box);
  };
  trend("#trend-balance", "patient_balance_avg", [0, 1], (v) => v.toFixed(1));
  trend("#trend-bent", "caregiver_bent_share", [0, 1], (v) => `${Math.round(v * 100)}%`);
}

// --- start ------------------------------------------------------------------
try {
  const rows = await loadOverview();
  const wanted = qs("video");
  if (wanted && rows.some((r) => r.video_id === wanted)) openVideo(wanted, false);
} catch (err) { showError("#videos", err); }
loadTrends().catch((err) => showError("#trends", err));
