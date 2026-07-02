// ---------------------------------------------------------------------------
// Shared configuration, palette and global app state.
//
// Chart colours are taken from the validated dark-mode reference palette in the
// `dataviz` skill (validated as a set on a near-identical #1a1a19 surface):
// blue #3987e5, aqua #199e70, yellow #c98500, red #e66767, violet #9085e9.
// Single-series charts use one hue; the only same-chart pair (histogram bars +
// theory overlay) is blue vs red, which is CVD-safe. Heatmaps use a single-hue
// sequential ramp (interpolateBlues), per the skill's "sequential = one hue".
// ---------------------------------------------------------------------------

const PALETTE = {
  gini: "#f5b301", // gold — the money theme; single-series line
  lorenz: "#2dd4bf", // teal — single series
  hist: "#3987e5", // blue (reference slot 1)
  theory: "#e66767", // red (reference slot 6) — distinct over blue bars
  equality: "#64748b",
  ink: "#e2e8f0",
  muted: "#94a3b8",
  grid: "#26364d",
  coin: "#f5b301",
};

// Real-world Gini reference points (World Bank-ish, rounded) for context markers.
const GINI_REFS = [
  { label: "Sweden ≈0.29", value: 0.29 },
  { label: "US ≈0.41", value: 0.41 },
  { label: "Brazil ≈0.52", value: 0.52 },
];

// (Sprite tier colours/scales live in sprites.js.)

// Baseline parameter values; presets are merged over these so switching presets
// always resets every field (not just the ones a preset mentions).
const PARAM_DEFAULTS = {
  n: 60, width: 30, height: 10, initial_wealth: 1,
  space_mode: "continuous", interaction_radius: 1, step_size: 1,
  exchange_rule: "random", give_fraction: 0.5, saving_lambda: 0.5, tax_rate: 0,
};

// Parameter presets: each sets input values then resets the model.
const PRESETS = {
  equal_start: { label: "Equal start", n: 100, width: 10, height: 10, space_mode: "grid", exchange_rule: "random", tax_rate: 0 },
  robin_hood: { label: "Robin Hood (tax)", n: 100, width: 10, height: 10, space_mode: "grid", exchange_rule: "random", tax_rate: 0.15 },
  winner_takes: { label: "Winner takes most", n: 120, width: 6, height: 6, space_mode: "grid", exchange_rule: "give_fraction", give_fraction: 0.5, tax_rate: 0 },
  savers: { label: "Careful savers", n: 100, width: 10, height: 10, initial_wealth: 20, space_mode: "grid", exchange_rule: "saving_propensity", saving_lambda: 0.6, tax_rate: 0 },
  continuous: { label: "Continuous space", n: 120, width: 12, height: 12, space_mode: "continuous", interaction_radius: 1.5, step_size: 1.0, exchange_rule: "random", tax_rate: 0 },
};

// Views auto-switch to a heatmap when the field gets crowded/fast.
const LOD_AGENT_THRESHOLD = 350;

// Global mutable app state (kept in one place so modules can share it).
const S = {
  lastState: null,
  followedId: null,
  followWealth: [], // followed agent's wealth per render
  trail: [], // recent positions of followed agent (pixel coords)
  kpi: { gini: [], richest: [], brokePct: [], total: [] },
  playInterval: 400,
};

function fmt(v, digits = 0) {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
