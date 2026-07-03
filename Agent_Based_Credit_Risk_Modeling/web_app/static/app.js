/* Orchestrator: reads controls -> JSON, drives /api/reset|step|shock, and fans each
   returned state out to the field / charts / economy renderers. Also owns the tab switch
   between the plain Simulation and the AI Borrowers experience. */

let playTimer = null;
let playing = false;

// Ids sent to the backend. Match CreditParams / SCENARIO_COERCE keys. (ai_mode is derived
// from the active tab, not a control.)
const PARAM_IDS = [
  "n_borrowers", "principal", "loan_term_months", "base_default_prob", "risk_slope",
  "max_consecutive_misses", "apr_floor", "apr_ceiling", "seed",
  "shock_start", "shock_duration", "shock_severity",
];

function paramPayload() {
  const p = {};
  PARAM_IDS.forEach((id) => { p[id] = Number(document.getElementById(id).value); });
  p.ai_mode = S.mode === "ai";
  return p;
}

// ---- render dispatch -------------------------------------------------------
function render(state, opts = {}) {
  if (state.error) { document.getElementById("sens-status").textContent = "⚠ " + state.error; return; }
  S.lastState = state;
  document.getElementById("month-num").textContent = state.step;
  const pill = document.getElementById("run-status");
  pill.textContent = state.running ? "running" : "resolved";
  pill.className = "status-pill " + (state.running ? "running" : "done");
  if (state.ai_status) updateAiNote(state.ai_status);

  renderCharts(state);
  renderEconomy(state);
  renderField(state, opts);
}

// ---- backend calls ---------------------------------------------------------
async function resetModel() {
  stopPlay();
  FIELD.coins = 0;
  d3.select("#field").selectAll("*").remove();
  if (S.mode === "ai") {
    const pill = document.getElementById("run-status");
    pill.textContent = "profiling…"; pill.className = "status-pill running";
  }
  const res = await fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paramPayload()),
  });
  render(await res.json(), { animate: false });
}

async function stepModel(n = 1) {
  const res = await fetch(`/api/step?n=${n}`, { method: "POST" });
  const state = await res.json();
  render(state, { animate: true });
  if (!state.running) stopPlay();
}

async function triggerShock() {
  const res = await fetch("/api/shock", { method: "POST" });
  render(await res.json(), { animate: false });
}

// ---- tabs ------------------------------------------------------------------
function switchTab(mode) {
  if (mode === S.mode) return;
  S.mode = mode;
  document.body.className = "mode-" + mode;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === mode));
  resetModel();
}

// ---- play loop -------------------------------------------------------------
// Self-scheduling so each step finishes before the next is queued -- important in AI mode,
// where a step can take a couple of seconds (an LLM call for the at-risk borrowers).
async function playLoop() {
  if (!playing) return;
  if (S.lastState && !S.lastState.running) { stopPlay(); return; }
  await stepModel(1);
  if (playing) playTimer = setTimeout(playLoop, Number(document.getElementById("play-interval").value));
}
function togglePlay() {
  if (playing) { stopPlay(); return; }
  if (S.lastState && !S.lastState.running) return;
  playing = true;
  document.getElementById("play-btn").textContent = "Pause";
  playLoop();
}
function stopPlay() {
  playing = false;
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
  document.getElementById("play-btn").textContent = "Play";
}

// ---- AI availability note --------------------------------------------------
function updateAiNote(status) {
  const note = document.getElementById("ai-note");
  if (!note) return;
  if (status.available) {
    note.textContent = `Reliability profiled at reset via ${status.model}. Stepping runs offline.`;
    note.className = "note ok";
  } else {
    note.textContent = status.message + " Personas still shape behaviour via their built-in risk.";
    note.className = "note warn";
  }
}

// ---- CSV export ------------------------------------------------------------
function downloadCsv() {
  const s = S.lastState;
  if (!s) return;
  const H = s.history;
  const rows = [["month", "outstanding", "active", "defaulted", "collected", "loss", "roi"]];
  H.months.forEach((_, i) => rows.push([H.months[i], H.outstanding[i], H.active[i], H.defaulted[i], H.collected[i], H.loss[i], H.roi[i]]));
  const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "credit_portfolio_timeseries.csv";
  a.click();
}

// ---- slider read-outs ------------------------------------------------------
function wireReadout(id, fmt) {
  const inp = document.getElementById(id);
  const out = document.getElementById(id + "-val");
  if (!inp || !out) return;
  const upd = () => { out.textContent = fmt ? fmt(Number(inp.value)) : inp.value; };
  inp.addEventListener("input", upd);
  upd();
}

function applyPreset(name) {
  const preset = PRESETS[name];
  if (!preset) return;
  Object.entries(preset).forEach(([k, v]) => {
    const el = document.getElementById(k);
    if (el) { el.value = v; el.dispatchEvent(new Event("input")); }
  });
  resetModel();
}

// ---- wiring ----------------------------------------------------------------
function init() {
  document.getElementById("play-btn").addEventListener("click", togglePlay);
  document.getElementById("step-btn").addEventListener("click", () => stepModel(1));
  document.getElementById("step12-btn").addEventListener("click", () => stepModel(12));
  document.getElementById("reset-btn").addEventListener("click", resetModel);
  document.getElementById("csv-btn").addEventListener("click", downloadCsv);
  document.getElementById("shock-btn").addEventListener("click", triggerShock);
  document.getElementById("view-select").addEventListener("change", () => { if (S.lastState) renderField(S.lastState); });

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));
  document.querySelectorAll(".preset[data-preset]").forEach((b) =>
    b.addEventListener("click", () => applyPreset(b.dataset.preset)));

  document.querySelectorAll("[data-metric]").forEach((b) =>
    b.addEventListener("click", () => { S.sensMetric = b.dataset.metric; updateMetricButtons(); renderHeatmap(); }));
  document.getElementById("sens-run").addEventListener("click", runSensitivity);
  initSensitivityControls();
  updateMetricButtons();

  wireReadout("play-interval");
  wireReadout("n_borrowers");
  wireReadout("loan_term_months");
  wireReadout("base_default_prob", (v) => v.toFixed(3));
  wireReadout("risk_slope", (v) => v.toFixed(1));
  wireReadout("max_consecutive_misses");
  wireReadout("apr_floor", (v) => Math.round(v * 100) + "%");
  wireReadout("apr_ceiling", (v) => Math.round(v * 100) + "%");
  wireReadout("shock_start");
  wireReadout("shock_duration");
  wireReadout("shock_severity", (v) => v.toFixed(1) + "×");
  document.getElementById("play-interval").addEventListener("input", () => {
    document.getElementById("speed-val").textContent = document.getElementById("play-interval").value;
  });

  window.addEventListener("resize", () => { if (S.lastState) render(S.lastState); });

  resetModel().then(() => {
    // Populate the sensitivity heatmap once with a usable default analysis.
    if (!S.sensRan) { S.sensRan = true; setTimeout(runSensitivity, 400); }
  });
}

init();
