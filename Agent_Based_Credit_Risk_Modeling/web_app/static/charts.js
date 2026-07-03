/* KPI tiles (with sparklines) and the four D3 line/area/scatter charts.
   Recessive grid + axes, thin marks, direct-labelled legends in the HTML. */

// ---- KPI tiles -------------------------------------------------------------
const KPI_DEFS = [
  { key: "total_lent", label: "Total lent", fmt: fmtMoney, tone: "" },
  { key: "collected", label: "Collected", fmt: fmtMoney, tone: "good", spark: "collected", color: PALETTE.good },
  { key: "loss", label: "Losses", fmt: fmtMoney, tone: "bad", spark: "loss", color: PALETTE.critical },
  { key: "defaulted_share", label: "Defaulted share", fmt: fmtPct, tone: "bad" },
  { key: "roi", label: "ROI", fmt: fmtPct, tone: "roi", spark: "roi", color: PALETTE.blue },
  { key: "active", label: "Active / defaulted", fmt: (v) => v, tone: "", custom: true },
];

function renderKpis(state) {
  const row = d3.select("#kpi-row");
  let tiles = row.selectAll("div.kpi").data(KPI_DEFS, (d) => d.key);
  const enter = tiles.enter().append("div").attr("class", "kpi");
  enter.append("div").attr("class", "k-label").text((d) => d.label);
  enter.append("div").attr("class", "k-value");
  enter.append("svg").attr("class", "k-spark");
  tiles = enter.merge(tiles);

  tiles.attr("class", (d) => {
    let cls = "kpi";
    if (d.tone === "good") cls += " good";
    if (d.tone === "bad") cls += " bad";
    if (d.tone === "roi") cls += state.kpis.roi >= 0 ? " good" : " bad";
    return cls;
  });

  tiles.select(".k-value").text((d) => {
    if (d.custom) return `${state.kpis.active} / ${state.kpis.defaulted}`;
    return d.fmt(state.kpis[d.key]);
  });

  // Sparklines from the model history.
  tiles.each(function (d) {
    if (!d.spark) return;
    drawSpark(d3.select(this).select("svg.k-spark"), state.history[d.spark], d.color);
  });
}

function drawSpark(svg, series, color) {
  const el = svg.node().getBoundingClientRect();
  const w = el.width || 70, h = el.height || 30;
  svg.attr("viewBox", `0 0 ${w} ${h}`);
  svg.selectAll("*").remove();
  if (!series || series.length < 2) return;
  const x = d3.scaleLinear().domain([0, series.length - 1]).range([2, w - 2]);
  const ext = d3.extent(series);
  const y = d3.scaleLinear().domain([Math.min(0, ext[0]), ext[1] || 1]).range([h - 2, 2]);
  const line = d3.line().x((_, i) => x(i)).y((v) => y(v));
  svg.append("path").attr("d", line(series)).attr("fill", "none")
    .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.9);
}

// ---- chart frame helper ----------------------------------------------------
function frame(svgSel, opts = {}) {
  const svg = d3.select(svgSel);
  const el = svg.node().getBoundingClientRect();
  const w = el.width || 400, h = el.height || 230;
  const m = Object.assign({ t: 12, r: 14, b: 26, l: 52 }, opts.margin || {});
  svg.attr("viewBox", `0 0 ${w} ${h}`);
  let g = svg.select("g.plot");
  if (g.empty()) {
    g = svg.append("g").attr("class", "plot");
    g.append("g").attr("class", "grid");
    g.append("g").attr("class", "axis x");
    g.append("g").attr("class", "axis y");
    g.append("g").attr("class", "marks");
  }
  g.attr("transform", `translate(${m.l},${m.t})`);
  return { svg, g, iw: w - m.l - m.r, ih: h - m.t - m.b };
}

function drawAxes(g, x, y, iw, ih, yFmt) {
  g.select("g.grid").attr("transform", `translate(0,0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-iw).tickFormat(""))
    .call((s) => s.select(".domain").remove());
  g.select("g.axis.x").attr("transform", `translate(0,${ih})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));
  g.select("g.axis.y").call(d3.axisLeft(y).ticks(4).tickFormat(yFmt));
}

// ---- 1. Outstanding balance ------------------------------------------------
function renderOutstanding(state) {
  const { g, iw, ih } = frame("#chart-outstanding");
  const H = state.history;
  const x = d3.scaleLinear().domain([0, Math.max(1, d3.max(H.months))]).range([0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(H.outstanding) || 1]).nice().range([ih, 0]);
  drawAxes(g, x, y, iw, ih, (v) => "$" + d3.format(".2s")(v));

  const area = d3.area().x((_, i) => x(H.months[i])).y0(ih).y1((v) => y(v));
  const line = d3.line().x((_, i) => x(H.months[i])).y((v) => y(v));
  const marks = g.select("g.marks");
  upsertPath(marks, "area", area(H.outstanding), { fill: PALETTE.blue, opacity: 0.15 });
  upsertPath(marks, "line", line(H.outstanding), { stroke: PALETTE.blue, width: 2 });
}

// ---- 2. Population: active vs defaulted (stacked area) ----------------------
function renderPopulation(state) {
  const { g, iw, ih } = frame("#chart-population");
  const H = state.history;
  const total = state.kpis.active + state.kpis.defaulted + state.kpis.paid_off;
  const paidOff = H.months.map((_, i) => total - H.active[i] - H.defaulted[i]);
  const x = d3.scaleLinear().domain([0, Math.max(1, d3.max(H.months))]).range([0, iw]);
  const y = d3.scaleLinear().domain([0, total || 1]).range([ih, 0]);
  drawAxes(g, x, y, iw, ih, d3.format("d"));

  // stack order bottom->top: active, paid_off, defaulted
  const layers = [
    { data: H.active, color: PALETTE.good, base: () => 0 },
  ];
  const base1 = H.active;
  const base2 = H.months.map((_, i) => H.active[i] + paidOff[i]);

  const marks = g.select("g.marks");
  upsertPath(marks, "active", stackArea(H.months, H.active.map(() => 0), H.active, x, y), { fill: PALETTE.good, opacity: 0.55 });
  upsertPath(marks, "paidoff", stackArea(H.months, base1, base2, x, y), { fill: PALETTE.blue, opacity: 0.45 });
  upsertPath(marks, "defaulted", stackArea(H.months, base2, base2.map((v, i) => v + H.defaulted[i]), x, y), { fill: PALETTE.critical, opacity: 0.6 });
}

function stackArea(months, lo, hi, x, y) {
  const area = d3.area().x((_, i) => x(months[i])).y0((_, i) => y(lo[i])).y1((_, i) => y(hi[i]));
  return area(hi);
}

// ---- 3. Cumulative collected vs loss ---------------------------------------
function renderCashflow(state) {
  const { g, iw, ih } = frame("#chart-cashflow");
  const H = state.history;
  const x = d3.scaleLinear().domain([0, Math.max(1, d3.max(H.months))]).range([0, iw]);
  const y = d3.scaleLinear().domain([0, Math.max(d3.max(H.collected), d3.max(H.loss), 1)]).nice().range([ih, 0]);
  drawAxes(g, x, y, iw, ih, (v) => "$" + d3.format(".2s")(v));
  const line = (arr) => d3.line().x((_, i) => x(H.months[i])).y((v) => y(v))(arr);
  const marks = g.select("g.marks");
  upsertPath(marks, "collected", line(H.collected), { stroke: PALETTE.good, width: 2 });
  upsertPath(marks, "loss", line(H.loss), { stroke: PALETTE.critical, width: 2 });
}

// ---- 4. Risk pricing: score -> APR scatter + curve -------------------------
function renderPricing(state) {
  const { g, iw, ih } = frame("#chart-pricing", { margin: { t: 12, r: 14, b: 34, l: 46 } });
  const curve = state.pricing_curve;
  const scatter = state.score_rate_scatter;
  const x = d3.scaleLinear().domain([state.params.score_min, state.params.score_max]).range([0, iw]);
  const y = d3.scaleLinear().domain([0, d3.max(curve, (d) => d.apr) * 1.05 || 0.3]).nice().range([ih, 0]);
  drawAxes(g, x, y, iw, ih, d3.format(".0%"));
  g.select("g.axis.x").call(d3.axisBottom(x).ticks(6).tickFormat(d3.format("d")));

  const marks = g.select("g.marks");
  const line = d3.line().x((d) => x(d.score)).y((d) => y(d.apr));
  upsertPath(marks, "curve", line(curve), { stroke: PALETTE.muted, width: 2, dash: "5 4" });

  const dots = marks.selectAll("circle.b").data(scatter, (_, i) => i);
  dots.exit().remove();
  dots.enter().append("circle").attr("class", "b").attr("r", 4)
    .merge(dots)
    .attr("cx", (d) => x(d.score)).attr("cy", (d) => y(d.apr))
    .attr("fill", (d) => statusColor(d)).attr("fill-opacity", 0.85)
    .attr("stroke", PALETTE.surface).attr("stroke-width", 1);

  // axis caption
  let cap = g.select("text.xcap");
  if (cap.empty()) cap = g.append("text").attr("class", "xcap axis-label");
  cap.attr("x", iw / 2).attr("y", ih + 30).attr("text-anchor", "middle").text("credit score");
}

// ---- shared path upsert ----------------------------------------------------
function upsertPath(g, cls, d, style) {
  let p = g.select(`path.${cls}`);
  if (p.empty()) p = g.append("path").attr("class", cls);
  p.attr("d", d)
    .attr("fill", style.fill || "none").attr("fill-opacity", style.opacity ?? 1)
    .attr("stroke", style.stroke || "none").attr("stroke-width", style.width || 0)
    .attr("stroke-dasharray", style.dash || null);
}

function renderCharts(state) {
  renderKpis(state);
  renderOutstanding(state);
  renderPopulation(state);
  renderCashflow(state);
  renderPricing(state);
}
