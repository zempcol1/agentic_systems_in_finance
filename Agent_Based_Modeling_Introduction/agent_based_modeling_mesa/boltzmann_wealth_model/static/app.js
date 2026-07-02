// ---------------------------------------------------------------------------
// Orchestrator: fetches model state, dispatches to the render modules, and
// wires up all controls (params, presets, CSV export, follow, view toggles).
// ---------------------------------------------------------------------------

let playTimer = null;

function paramPayload() {
  return {
    n: Number(document.getElementById("n").value),
    width: Number(document.getElementById("width").value),
    height: Number(document.getElementById("height").value),
    initial_wealth: Number(document.getElementById("initial_wealth").value),
    space_mode: document.getElementById("space_mode").value,
    interaction_radius: Number(document.getElementById("interaction_radius").value),
    step_size: Number(document.getElementById("step_size").value),
    exchange_rule: document.getElementById("exchange_rule").value,
    give_fraction: Number(document.getElementById("give_fraction").value),
    saving_lambda: Number(document.getElementById("saving_lambda").value),
    tax_rate: Number(document.getElementById("tax_rate").value),
  };
}

function render(state, opts = {}) {
  S.lastState = state;
  S.playInterval = Number(document.getElementById("play-interval").value);
  document.getElementById("step-value").textContent = state.step;

  updateKpis(state);
  renderGauge(state.gini);
  renderField(state);
  renderGiniChart(state.history);
  renderLorenz(state.lorenz, state.gini);
  renderHistogram(state);
  renderLogDistribution(state);
  renderFollowChart(state);

  if (opts.animate) playTransactions(state);
}

function rerenderFromState() {
  if (S.lastState) render(S.lastState, { animate: false });
}

async function resetModel() {
  stopPlay(); // a reset/preset while playing must stop the timer, else the button desyncs
  const playBtn = document.getElementById("play-btn");
  playBtn.disabled = false;
  playBtn.textContent = "Play";
  // clear per-run buffers
  S.followedId = null;
  S.trail = [];
  S.followWealth = [];
  S.kpi = { gini: [], richest: [], brokePct: [], total: [] };
  document.getElementById("follow-card").style.display = "none";
  document.getElementById("follow-status").textContent = "Not following anyone (click an agent).";
  d3.select("#field").selectAll("g.fx *, g.trail *").remove();

  const res = await fetch("/api/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paramPayload()),
  });
  render(await res.json(), { animate: false });
}

async function stepModel(n = 1) {
  const res = await fetch(`/api/step?n=${n}`, { method: "POST" });
  render(await res.json(), { animate: true });
}

function stopPlay() {
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = null;
  }
}

function togglePlay() {
  const btn = document.getElementById("play-btn");
  if (playTimer) {
    stopPlay();
    btn.textContent = "Play";
    return;
  }
  btn.textContent = "Pause";
  playTimer = setInterval(() => stepModel(1), Number(document.getElementById("play-interval").value));
}

// ---- Control visibility (space mode / rule specific) ----------------------

function syncControlVisibility() {
  const continuous = document.getElementById("space_mode").value === "continuous";
  document.querySelectorAll(".continuous-only").forEach((el) => (el.style.display = continuous ? "" : "none"));
  const rule = document.getElementById("exchange_rule").value;
  document.getElementById("give_fraction-row").style.display = rule === "give_fraction" ? "" : "none";
  document.getElementById("saving_lambda-row").style.display = rule === "saving_propensity" ? "" : "none";
}

// ---- Presets --------------------------------------------------------------

function applyPreset(key) {
  if (!PRESETS[key]) return;
  const p = { ...PARAM_DEFAULTS, ...PRESETS[key] };
  Object.keys(PARAM_DEFAULTS).forEach((k) => {
    document.getElementById(k).value = p[k];
  });
  document.getElementById("tax_rate-value").textContent = Number(p.tax_rate).toFixed(2);
  syncControlVisibility();
  resetModel();
}

// ---- CSV export -----------------------------------------------------------

function downloadCsv() {
  if (!S.lastState) return;
  const lines = ["# Gini over time", "step,gini"];
  S.lastState.history.steps.forEach((s, i) => lines.push(`${s},${S.lastState.history.gini[i]}`));
  lines.push("", "# Final wealth per agent", "id,wealth");
  S.lastState.agents.slice().sort((a, b) => a.id - b.id).forEach((a) => lines.push(`${a.id},${a.wealth}`));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "boltzmann_run.csv";
  link.click();
  URL.revokeObjectURL(url);
}

// ---- Wiring ---------------------------------------------------------------

document.getElementById("reset-btn").addEventListener("click", resetModel);
document.getElementById("step-btn").addEventListener("click", () => stepModel(1));
document.getElementById("play-btn").addEventListener("click", togglePlay);
document.getElementById("play-interval").addEventListener("input", (e) => {
  document.getElementById("play-interval-value").textContent = e.target.value;
  if (playTimer) {
    clearInterval(playTimer);
    playTimer = setInterval(() => stepModel(1), Number(e.target.value));
  }
});
document.getElementById("tax_rate").addEventListener("input", (e) => {
  document.getElementById("tax_rate-value").textContent = Number(e.target.value).toFixed(2);
});
document.getElementById("space_mode").addEventListener("change", syncControlVisibility);
document.getElementById("exchange_rule").addEventListener("change", syncControlVisibility);
document.getElementById("view-select").addEventListener("change", rerenderFromState);
document.getElementById("theory-toggle").addEventListener("change", rerenderFromState);
document.getElementById("clear-follow").addEventListener("click", () => followAgent(S.followedId));
document.getElementById("download-csv").addEventListener("click", downloadCsv);
document.getElementById("sound-toggle").addEventListener("change", () => {
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
});
document.getElementById("sensitivity-btn").addEventListener("click", runSensitivityAnalysis);
document.getElementById("sensitivity-metric").addEventListener("change", renderHeatmap);
document.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => applyPreset(btn.dataset.preset)));

syncControlVisibility();
resetModel();
