/* In-browser sensitivity sweep. Pick any two parameters for the X and Y axes and a metric to
   colour by; each cell averages several full simulations. Reuses the same run function as the
   CLI via the /api/sensitivity endpoint. */

// Sweepable parameters: label, default range, and axis tick format. Must match SWEEP_PARAMS
// on the server.
const SWEEP_META = {
  base_default_prob:      { label: "Base miss probability", min: 0.02, max: 0.12, step: 0.02, tick: d3.format(".0%") },
  loan_term_months:       { label: "Loan term (months)",    min: 12,   max: 60,   step: 12,   tick: d3.format("d") },
  apr_ceiling:            { label: "APR ceiling",           min: 0.15, max: 0.45, step: 0.05, tick: d3.format(".0%") },
  risk_slope:             { label: "Risk slope",            min: 0,    max: 8,    step: 2,    tick: d3.format(".1f") },
  max_consecutive_misses: { label: "Misses to default",     min: 1,    max: 5,    step: 1,    tick: d3.format("d") },
  shock_severity:         { label: "Shock severity",        min: 1,    max: 7,    step: 1.5,  tick: (v) => v + "×" },
};

const METRIC_META = {
  defaulted_share: { label: "Defaulted share", fmt: fmtPct, kind: "seq" },
  roi:             { label: "ROI",             fmt: fmtPct, kind: "div" },
  default_rate:    { label: "Default rate",    fmt: fmtPct, kind: "seq" },
};

function initSensitivityControls() {
  const xSel = document.getElementById("sens-x-param");
  const ySel = document.getElementById("sens-y-param");
  for (const [key, meta] of Object.entries(SWEEP_META)) {
    xSel.add(new Option(meta.label, key));
    ySel.add(new Option(meta.label, key));
  }
  xSel.value = "base_default_prob";
  ySel.value = "loan_term_months";
  applyAxisDefaults("x");
  applyAxisDefaults("y");
  xSel.addEventListener("change", () => { ensureDistinct("x"); applyAxisDefaults("x"); });
  ySel.addEventListener("change", () => { ensureDistinct("y"); applyAxisDefaults("y"); });
}

// Keep the two axes on different parameters.
function ensureDistinct(changed) {
  const x = document.getElementById("sens-x-param");
  const y = document.getElementById("sens-y-param");
  if (x.value !== y.value) return;
  const other = changed === "x" ? y : x;
  const free = Object.keys(SWEEP_META).find((k) => k !== (changed === "x" ? x.value : y.value));
  other.value = free;
  applyAxisDefaults(changed === "x" ? "y" : "x");
}

function applyAxisDefaults(axis) {
  const key = document.getElementById(`sens-${axis}-param`).value;
  const m = SWEEP_META[key];
  document.getElementById(`sens-${axis}-min`).value = m.min;
  document.getElementById(`sens-${axis}-max`).value = m.max;
  document.getElementById(`sens-${axis}-step`).value = m.step;
}

function axisSpec(axis) {
  return {
    min: Number(document.getElementById(`sens-${axis}-min`).value),
    max: Number(document.getElementById(`sens-${axis}-max`).value),
    step: Number(document.getElementById(`sens-${axis}-step`).value),
  };
}

async function runSensitivity() {
  const status = document.getElementById("sens-status");
  const btn = document.getElementById("sens-run");

  // Cap the swept portfolio size so a large live setting doesn't make the sweep crawl --
  // outcome shares/ROI are stable in the number of borrowers anyway.
  const fixed = paramPayload();
  fixed.n_borrowers = Math.min(fixed.n_borrowers, 80);

  const body = {
    x_param: document.getElementById("sens-x-param").value,
    y_param: document.getElementById("sens-y-param").value,
    x: axisSpec("x"),
    y: axisSpec("y"),
    replications: Number(document.getElementById("sens-reps").value),
    fixed_params: fixed,
  };

  btn.disabled = true;
  status.textContent = "Running sweep… (many full simulations in parallel)";
  try {
    const res = await fetch("/api/sensitivity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) { status.textContent = "⚠ " + data.error; return; }
    S.sensResult = data;
    const xl = SWEEP_META[data.x_param].label, yl = SWEEP_META[data.y_param].label;
    status.textContent = `${data.n_runs} runs in ${data.elapsed_seconds}s. Rows = ${yl}, columns = ${xl}.`;
    renderHeatmap();
  } catch (e) {
    status.textContent = "⚠ Sweep failed: " + e;
  } finally {
    btn.disabled = false;
  }
}

function renderHeatmap() {
  const data = S.sensResult;
  const svg = d3.select("#sensitivity-heatmap");
  svg.selectAll("*").remove();
  if (!data) return;

  const el = svg.node().getBoundingClientRect();
  const w = el.width || 600, h = el.height || 340;
  const m = { t: 16, r: 24, b: 46, l: 64 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  svg.attr("viewBox", `0 0 ${w} ${h}`);
  const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);

  const rows = data.y_values, cols = data.x_values;
  const xMeta = SWEEP_META[data.x_param], yMeta = SWEEP_META[data.y_param];
  const metricMeta = METRIC_META[S.sensMetric];
  const matrix = data.metrics[S.sensMetric];

  const x = d3.scaleBand().domain(cols).range([0, iw]).padding(0.04);
  const y = d3.scaleBand().domain(rows).range([0, ih]).padding(0.04);

  const flat = matrix.flat().filter((v) => v !== null);
  let color;
  if (metricMeta.kind === "div") {
    const mx = d3.max(flat.map(Math.abs)) || 1;   // diverging around 0: red=loss, blue=profit
    color = d3.scaleDiverging(d3.interpolateRdBu).domain([-mx, 0, mx]);
  } else {
    color = d3.scaleSequential(d3.interpolateOrRd).domain([0, d3.max(flat) || 1]);
  }

  rows.forEach((rv, ri) => {
    cols.forEach((cv, ci) => {
      const val = matrix[ri][ci];
      const cx = x(cv), cy = y(rv);
      g.append("rect")
        .attr("x", cx).attr("y", cy).attr("width", x.bandwidth()).attr("height", y.bandwidth())
        .attr("rx", 3)
        .attr("fill", val === null ? "#222" : color(val))
        .on("mousemove", (ev) => showTip(
          `${yMeta.label} ${yMeta.tick(rv)} &middot; ${xMeta.label} ${xMeta.tick(cv)}<br/>` +
          `${metricMeta.label} <b>${val === null ? "n/a" : metricMeta.fmt(val)}</b>`, ev))
        .on("mouseleave", hideTip);
      if (val !== null && x.bandwidth() > 34) {
        g.append("text").attr("x", cx + x.bandwidth() / 2).attr("y", cy + y.bandwidth() / 2)
          .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
          .attr("font-size", 10.5).attr("font-variant-numeric", "tabular-nums")
          .attr("fill", cellText(val, metricMeta.kind, flat)).text(metricMeta.fmt(val));
      }
    });
  });

  g.append("g").attr("class", "axis x").attr("transform", `translate(0,${ih})`)
    .call(d3.axisBottom(x).tickFormat(xMeta.tick));
  g.append("g").attr("class", "axis y").call(d3.axisLeft(y).tickFormat(yMeta.tick));

  g.append("text").attr("class", "axis-label").attr("x", iw / 2).attr("y", ih + 40)
    .attr("text-anchor", "middle").text(xMeta.label);
  g.append("text").attr("class", "axis-label").attr("transform", "rotate(-90)")
    .attr("x", -ih / 2).attr("y", -50).attr("text-anchor", "middle").text(yMeta.label);
}

function cellText(val, kind, flat) {
  if (kind === "div") return "#0b0b0b";
  const frac = val / (d3.max(flat) || 1);
  return frac > 0.55 ? "#fff" : "#0b0b0b";
}

function updateMetricButtons() {
  document.querySelectorAll("[data-metric]").forEach((b) =>
    b.classList.toggle("active", b.dataset.metric === S.sensMetric));
}
