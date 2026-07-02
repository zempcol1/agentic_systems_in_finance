// ---------------------------------------------------------------------------
// Sensitivity analysis: Number of Agents × Grid Size sweep, heatmap of mean
// final Gini (or mean richest-agent wealth). The current model's rule / space /
// tax settings are held fixed across the sweep.
// ---------------------------------------------------------------------------

const METRIC_LABELS = {
  mean_final_gini: "Mean final Gini",
  mean_max_wealth: "Mean richest-agent wealth",
};

let lastSensitivityResult = null;

function sensitivityAxisSpec(prefix) {
  return {
    min: Number(document.getElementById(`sens-${prefix}-min`).value),
    max: Number(document.getElementById(`sens-${prefix}-max`).value),
    step: Number(document.getElementById(`sens-${prefix}-step`).value),
  };
}

async function readJsonResponse(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

async function runSensitivityAnalysis() {
  const btn = document.getElementById("sensitivity-btn");
  const status = document.getElementById("sensitivity-status");
  btn.disabled = true;
  status.textContent = "Running...";

  const payload = {
    n: sensitivityAxisSpec("n"),
    grid_size: sensitivityAxisSpec("grid"),
    replications: Number(document.getElementById("sens-replications").value),
    steps: Number(document.getElementById("sens-steps").value),
    fixed_params: {
      space_mode: document.getElementById("space_mode").value,
      exchange_rule: document.getElementById("exchange_rule").value,
      tax_rate: Number(document.getElementById("tax_rate").value),
    },
  };

  try {
    const res = await fetch("/api/sensitivity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readJsonResponse(res);
    if (!res.ok) {
      status.textContent = `Error: ${data.error || res.statusText}`;
      return;
    }
    lastSensitivityResult = data;
    status.textContent = `Done: ${data.n_runs} runs in ${data.elapsed_seconds}s (rule=${payload.fixed_params.exchange_rule}, space=${payload.fixed_params.space_mode}, tax=${payload.fixed_params.tax_rate}).`;
    renderHeatmap();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    status.textContent = `Error: Could not reach sensitivity endpoint. ${message}`;
  } finally {
    btn.disabled = false;
  }
}

function renderHeatmap() {
  if (!lastSensitivityResult) return;

  const metric = document.getElementById("sensitivity-metric").value;
  const nValues = lastSensitivityResult.n_values;
  const gridValues = lastSensitivityResult.grid_values;
  const matrix = lastSensitivityResult.metrics[metric];

  const svg = d3.select("#sensitivity-heatmap");
  svg.selectAll("*").remove();
  if (!matrix) return;

  const box = svg.node().getBoundingClientRect();
  const margin = { top: 40, right: 20, bottom: 50, left: 70 };
  const width = box.width - margin.left - margin.right;
  const height = box.height - margin.top - margin.bottom;
  svg.attr("viewBox", `0 0 ${box.width} ${box.height}`);

  const xLabels = gridValues.map(String);
  const yLabels = nValues.map(String);
  const x = d3.scaleBand().domain(xLabels).range([0, width]).padding(0.05);
  const y = d3.scaleBand().domain(yLabels).range([0, height]).padding(0.05);

  const flat = matrix.flat().filter((v) => v !== null && v !== undefined);
  const color = d3.scaleSequential(d3.interpolateBlues).domain([Math.min(...flat), Math.max(...flat)]);
  const isGini = metric === "mean_final_gini";

  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  for (let i = 0; i < nValues.length; i++) {
    for (let j = 0; j < gridValues.length; j++) {
      const value = matrix[i][j];
      const cx = x(xLabels[j]);
      const cy = y(yLabels[i]);
      if (value === null || value === undefined) {
        g.append("rect").attr("x", cx).attr("y", cy).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("fill", "#475569");
        g.append("text").attr("class", "heatmap-cell-label").attr("x", cx + x.bandwidth() / 2).attr("y", cy + y.bandwidth() / 2).attr("fill", "#e2e8f0").text("N/A");
        continue;
      }
      const fill = color(value);
      g.append("rect").attr("x", cx).attr("y", cy).attr("width", x.bandwidth()).attr("height", y.bandwidth()).attr("fill", fill)
        .append("title").text(`n=${yLabels[i]}, grid=${xLabels[j]}: ${value.toFixed(3)}`);
      const rgb = d3.rgb(fill);
      const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
      g.append("text").attr("class", "heatmap-cell-label").attr("x", cx + x.bandwidth() / 2).attr("y", cy + y.bandwidth() / 2)
        .attr("fill", luminance > 0.55 ? "#0f172a" : "#f8fafc").text(isGini ? value.toFixed(3) : value.toFixed(1));
    }
  }

  g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));
  g.append("g").call(d3.axisLeft(y));

  svg.append("text").attr("x", margin.left + width / 2).attr("y", box.height - 8).attr("text-anchor", "middle").text("Grid size (square side)");
  svg.append("text").attr("transform", `translate(16,${margin.top + height / 2}) rotate(-90)`).attr("text-anchor", "middle").text("Number of agents");
  svg.append("text").attr("x", margin.left).attr("y", 18).text(METRIC_LABELS[metric]);

  const legendWidth = 120;
  const legendX = margin.left + width - legendWidth;
  const gradientId = "heatmap-gradient";
  const defs = svg.append("defs");
  const gradient = defs.append("linearGradient").attr("id", gradientId).attr("x1", "0%").attr("x2", "100%");
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    gradient.append("stop").attr("offset", `${t * 100}%`).attr("stop-color", color(color.domain()[0] + t * (color.domain()[1] - color.domain()[0])));
  }
  svg.append("rect").attr("x", legendX).attr("y", 20).attr("width", legendWidth).attr("height", 10).attr("fill", `url(#${gradientId})`);
  svg.append("text").attr("x", legendX).attr("y", 12).attr("font-size", 11).text(color.domain()[0].toFixed(2));
  svg.append("text").attr("x", legendX + legendWidth).attr("y", 12).attr("text-anchor", "end").attr("font-size", 11).text(color.domain()[1].toFixed(2));
}
