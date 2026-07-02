// ---------------------------------------------------------------------------
// All non-field charts: KPI tiles + sparklines, Gini gauge, Gini-over-time
// (with real-world reference markers), Lorenz curve, wealth histogram + the
// Boltzmann–Gibbs theory overlay, the live wealth bar-chart race, and the
// follow-an-agent wealth trace.
// ---------------------------------------------------------------------------

function plotFrame(svgSel, margin) {
  const svg = d3.select(svgSel);
  const box = svg.node().getBoundingClientRect();
  svg.attr("viewBox", `0 0 ${box.width} ${box.height}`);
  const width = box.width - margin.left - margin.right;
  const height = box.height - margin.top - margin.bottom;
  let g = svg.select("g.plot-area");
  if (g.empty()) {
    g = svg.append("g").attr("class", "plot-area");
    g.append("g").attr("class", "grid-lines");
    g.append("g").attr("class", "x-axis");
    g.append("g").attr("class", "y-axis");
  }
  g.attr("transform", `translate(${margin.left},${margin.top})`);
  return { svg, g, width, height };
}

// ---- KPI tiles + sparklines -----------------------------------------------

function updateKpis(state) {
  const wealths = state.agents.map((a) => a.wealth);
  const total = d3.sum(wealths);
  const brokePct = (100 * wealths.filter((w) => w === 0).length) / (wealths.length || 1);

  S.kpi.gini.push(state.gini);
  S.kpi.richest.push(state.max_wealth);
  S.kpi.brokePct.push(brokePct);
  S.kpi.total.push(total);
  Object.values(S.kpi).forEach((arr) => arr.length > 300 && arr.shift());

  setTile("gini", state.gini.toFixed(3), S.kpi.gini, PALETTE.gini);
  setTile("richest", fmt(state.max_wealth), S.kpi.richest, PALETTE.hist);
  setTile("broke", brokePct.toFixed(0) + "%", S.kpi.brokePct, PALETTE.theory);
  setTile("total", fmt(total), S.kpi.total, PALETTE.lorenz);
}

function setTile(key, value, series, color) {
  document.getElementById(`kpi-${key}-value`).textContent = value;
  const svg = d3.select(`#kpi-${key}-spark`);
  const box = svg.node().getBoundingClientRect();
  svg.attr("viewBox", `0 0 ${box.width} ${box.height}`);
  const x = d3.scaleLinear().domain([0, Math.max(1, series.length - 1)]).range([2, box.width - 2]);
  const y = d3.scaleLinear().domain(d3.extent(series.length > 1 ? series : [0, 1])).nice().range([box.height - 2, 2]);
  const line = d3.line().x((_, i) => x(i)).y((d) => y(d));
  svg.selectAll("path").data([series]).join("path").attr("fill", "none").attr("stroke", color).attr("stroke-width", 1.5).attr("d", line);
}

// ---- Gini gauge -----------------------------------------------------------

function renderGauge(gini) {
  const svg = d3.select("#gini-gauge");
  const box = svg.node().getBoundingClientRect();
  svg.attr("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.selectAll("*").remove();
  const w = box.width;
  const r = Math.min(w / 2 - 8, box.height - 20);
  const cx = w / 2;
  const cy = box.height - 6;
  const a = (t) => Math.PI * (1 - t); // t in [0,1] -> angle pi..0

  const arc = d3.arc().innerRadius(r - 10).outerRadius(r);
  // background track
  svg.append("path").attr("transform", `translate(${cx},${cy})`).attr("fill", "#334155")
    .attr("d", arc.startAngle(-Math.PI / 2).endAngle(Math.PI / 2)());
  // value arc (0..gini)
  svg.append("path").attr("transform", `translate(${cx},${cy})`).attr("fill", PALETTE.gini)
    .attr("d", arc.startAngle(-Math.PI / 2).endAngle(-Math.PI / 2 + Math.PI * gini)());

  // (Real-world Gini references are shown on the Gini-over-time chart, not here,
  // to keep the gauge uncluttered.)

  // needle
  const ang = a(Math.max(0, Math.min(1, gini)));
  svg.append("line").attr("x1", cx).attr("y1", cy).attr("x2", cx + Math.cos(ang) * (r - 12)).attr("y2", cy - Math.sin(ang) * (r - 12))
    .attr("stroke", PALETTE.ink).attr("stroke-width", 2.5).attr("stroke-linecap", "round");
  svg.append("circle").attr("cx", cx).attr("cy", cy).attr("r", 4).attr("fill", PALETTE.ink);
  svg.append("text").attr("x", cx).attr("y", cy - r / 2).attr("text-anchor", "middle").attr("fill", PALETTE.gini).attr("font-size", 22).attr("font-weight", 700).text(gini.toFixed(3));
  svg.append("text").attr("x", 6).attr("y", cy - 2).attr("fill", PALETTE.muted).attr("font-size", 10).text("0 equal");
  svg.append("text").attr("x", w - 6).attr("y", cy - 2).attr("text-anchor", "end").attr("fill", PALETTE.muted).attr("font-size", 10).text("1 unequal");
}

// ---- Gini over time -------------------------------------------------------

function renderGiniChart(history) {
  const margin = { top: 12, right: 60, bottom: 30, left: 42 };
  const { g, width, height } = plotFrame("#gini-chart", margin);
  const x = d3.scaleLinear().domain([0, Math.max(1, history.steps.length - 1)]).range([0, width]);
  const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

  g.select(".grid-lines").call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""));
  g.select(".grid-lines").selectAll("line").attr("stroke", PALETTE.grid);
  g.select(".grid-lines").select(".domain").remove();
  g.select(".x-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5));
  g.select(".y-axis").call(d3.axisLeft(y).ticks(5));

  // real-world reference lines
  g.selectAll("line.gini-ref").data(GINI_REFS).join("line").attr("class", "gini-ref")
    .attr("x1", 0).attr("x2", width).attr("y1", (d) => y(d.value)).attr("y2", (d) => y(d.value))
    .attr("stroke", PALETTE.muted).attr("stroke-dasharray", "2 3").attr("stroke-width", 1).attr("opacity", 0.6);
  g.selectAll("text.gini-ref").data(GINI_REFS).join("text").attr("class", "gini-ref")
    .attr("x", width + 3).attr("y", (d) => y(d.value) + 3).attr("fill", PALETTE.muted).attr("font-size", 9).text((d) => d.label);

  const line = d3.line().x((_, i) => x(i)).y((d) => y(d));
  g.selectAll("path.series").data([history.gini]).join("path").attr("class", "series")
    .attr("fill", "none").attr("stroke", PALETTE.gini).attr("stroke-width", 2).attr("d", line);
}

// ---- Lorenz curve ---------------------------------------------------------

function renderLorenz(lorenz, gini) {
  const margin = { top: 12, right: 18, bottom: 32, left: 42 };
  const { g, width, height } = plotFrame("#lorenz-chart", margin);
  const x = d3.scaleLinear().domain([0, 1]).range([0, width]);
  const y = d3.scaleLinear().domain([0, 1]).range([height, 0]);

  g.select(".grid-lines").call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""));
  g.select(".grid-lines").selectAll("line").attr("stroke", PALETTE.grid);
  g.select(".grid-lines").select(".domain").remove();
  g.select(".x-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5));
  g.select(".y-axis").call(d3.axisLeft(y).ticks(5));

  g.selectAll("line.equality").data([0]).join("line").attr("class", "equality")
    .attr("x1", x(0)).attr("y1", y(0)).attr("x2", x(1)).attr("y2", y(1))
    .attr("stroke", PALETTE.equality).attr("stroke-dasharray", "4 4").attr("stroke-width", 1);

  const area = d3.area().x((d) => x(d.p)).y0(y(0)).y1((d) => y(d.w));
  g.selectAll("path.lorenz-area").data([lorenz]).join("path").attr("class", "lorenz-area")
    .attr("fill", PALETTE.lorenz).attr("fill-opacity", 0.18).attr("d", area);
  const line = d3.line().x((d) => x(d.p)).y((d) => y(d.w));
  g.selectAll("path.lorenz-line").data([lorenz]).join("path").attr("class", "lorenz-line")
    .attr("fill", "none").attr("stroke", PALETTE.lorenz).attr("stroke-width", 2).attr("d", line);

  g.selectAll("text.gini-label").data([gini]).join("text").attr("class", "gini-label")
    .attr("x", width - 4).attr("y", 14).attr("text-anchor", "end").attr("fill", PALETTE.gini).text((d) => `Gini = ${d.toFixed(3)}`);
}

// ---- Wealth histogram + Boltzmann–Gibbs overlay ---------------------------

function renderHistogram(state) {
  const histogram = state.histogram;
  const svg = d3.select("#histogram");
  svg.selectAll("*").remove();
  const box = svg.node().getBoundingClientRect();
  svg.attr("viewBox", `0 0 ${box.width} ${box.height}`);
  const margin = { top: 24, right: 18, bottom: 34, left: 42 };
  const width = box.width - margin.left - margin.right;
  const height = box.height - margin.top - margin.bottom;
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(histogram.map((d) => d.wealth)).range([0, width]).padding(0.15);
  const y = d3.scaleLinear().domain([0, d3.max(histogram, (d) => d.count) || 1]).nice().range([height, 0]);

  g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));
  g.append("g").call(d3.axisLeft(y).ticks(5));

  g.selectAll("rect").data(histogram).join("rect")
    .attr("x", (d) => x(d.wealth)).attr("y", (d) => y(d.count))
    .attr("width", x.bandwidth()).attr("height", (d) => height - y(d.count))
    .attr("fill", PALETTE.hist).attr("rx", 2)
    .append("title").text((d) => `${d.count} agents with wealth ${d.wealth}`);

  // Boltzmann–Gibbs (ideal) reference: N/T · e^(−m/T), T = mean wealth.
  const showTheory = document.getElementById("theory-toggle").checked;
  if (showTheory && state.mean_wealth > 0) {
    const T = state.mean_wealth;
    const N = state.agents.length;
    const pts = histogram.map((d) => ({ m: d.wealth, c: (N / T) * Math.exp(-d.wealth / T) }));
    const lineGen = d3.line().x((d) => x(d.m) + x.bandwidth() / 2).y((d) => y(Math.min(d.c, y.domain()[1])));
    g.append("path").datum(pts).attr("fill", "none").attr("stroke", PALETTE.theory)
      .attr("stroke-width", 2).attr("stroke-dasharray", "5 3").attr("d", lineGen);
  }

  // legend (2 series)
  const legend = svg.append("g").attr("transform", `translate(${margin.left},8)`);
  legend.append("rect").attr("width", 10).attr("height", 10).attr("y", -9).attr("fill", PALETTE.hist);
  legend.append("text").attr("x", 14).attr("fill", PALETTE.ink).attr("font-size", 11).text("Agents");
  if (showTheory) {
    legend.append("line").attr("x1", 70).attr("x2", 88).attr("y1", -4).attr("y2", -4).attr("stroke", PALETTE.theory).attr("stroke-width", 2).attr("stroke-dasharray", "5 3");
    legend.append("text").attr("x", 92).attr("fill", PALETTE.ink).attr("font-size", 11).text("Boltzmann–Gibbs (ideal)");
  }

  svg.append("text").attr("x", margin.left + width / 2).attr("y", box.height - 6)
    .attr("text-anchor", "middle").attr("fill", PALETTE.muted).attr("font-size", 12).text("Wealth (units) → count of agents");
}

// ---- Wealth distribution on a log scale (the classic econophysics view) ----
// Plotting count on a log y-axis turns the Boltzmann–Gibbs exponential into a
// straight descending line — the signature result of the money model.

function renderLogDistribution(state) {
  const svg = d3.select("#log-dist");
  svg.selectAll("*").remove();
  const box = svg.node().getBoundingClientRect();
  svg.attr("viewBox", `0 0 ${box.width} ${box.height}`);
  const margin = { top: 24, right: 18, bottom: 34, left: 44 };
  const width = box.width - margin.left - margin.right;
  const height = box.height - margin.top - margin.bottom;
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const maxWealth = d3.max(state.histogram, (d) => d.wealth) || 1;
  const maxCount = d3.max(state.histogram, (d) => d.count) || 1;
  const x = d3.scaleLinear().domain([0, maxWealth]).range([0, width]);
  const y = d3.scaleLog().domain([0.7, Math.max(1, maxCount)]).range([height, 0]).clamp(true);

  g.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(6));
  g.append("g").call(d3.axisLeft(y).ticks(4, "~s"));

  // observed counts (points + line), only bins with at least one agent
  const pts = state.histogram.filter((d) => d.count > 0);
  const lineGen = d3.line().x((d) => x(d.wealth)).y((d) => y(d.count));
  g.append("path").datum(pts).attr("fill", "none").attr("stroke", PALETTE.hist).attr("stroke-width", 2).attr("d", lineGen);
  g.selectAll("circle").data(pts).join("circle").attr("cx", (d) => x(d.wealth)).attr("cy", (d) => y(d.count)).attr("r", 3).attr("fill", PALETTE.hist)
    .append("title").text((d) => `${d.count} agents with wealth ${d.wealth}`);

  // Boltzmann–Gibbs (ideal): a straight line on a log axis.
  const showTheory = document.getElementById("theory-toggle").checked;
  if (showTheory && state.mean_wealth > 0) {
    const T = state.mean_wealth;
    const N = state.agents.length;
    const theory = state.histogram.map((d) => ({ wealth: d.wealth, count: (N / T) * Math.exp(-d.wealth / T) })).filter((d) => d.count >= 0.7);
    g.append("path").datum(theory).attr("fill", "none").attr("stroke", PALETTE.theory).attr("stroke-width", 2).attr("stroke-dasharray", "5 3")
      .attr("d", d3.line().x((d) => x(d.wealth)).y((d) => y(d.count)));
  }

  // legend
  const legend = svg.append("g").attr("transform", `translate(${margin.left},8)`);
  legend.append("circle").attr("r", 4).attr("cy", -4).attr("fill", PALETTE.hist);
  legend.append("text").attr("x", 10).attr("fill", PALETTE.ink).attr("font-size", 11).text("Agents (log count)");
  if (showTheory) {
    legend.append("line").attr("x1", 118).attr("x2", 136).attr("y1", -4).attr("y2", -4).attr("stroke", PALETTE.theory).attr("stroke-width", 2).attr("stroke-dasharray", "5 3");
    legend.append("text").attr("x", 140).attr("fill", PALETTE.ink).attr("font-size", 11).text("Boltzmann–Gibbs (straight = exponential)");
  }

  svg.append("text").attr("x", margin.left + width / 2).attr("y", box.height - 6).attr("text-anchor", "middle").attr("fill", PALETTE.muted).attr("font-size", 12).text("Wealth (units) → log count of agents");
}

// ---- Follow-an-agent wealth trace -----------------------------------------

function renderFollowChart(state) {
  if (S.followedId == null) return;
  const me = state.agents.find((a) => a.id === S.followedId);
  if (me) S.followWealth.push(me.wealth);
  if (S.followWealth.length > 300) S.followWealth.shift();

  const margin = { top: 12, right: 14, bottom: 26, left: 36 };
  const { g, width, height } = plotFrame("#follow-chart", margin);
  const x = d3.scaleLinear().domain([0, Math.max(1, S.followWealth.length - 1)]).range([0, width]);
  const y = d3.scaleLinear().domain([0, d3.max(S.followWealth) || 1]).nice().range([height, 0]);

  g.select(".grid-lines").call(d3.axisLeft(y).ticks(4).tickSize(-width).tickFormat(""));
  g.select(".grid-lines").selectAll("line").attr("stroke", PALETTE.grid);
  g.select(".grid-lines").select(".domain").remove();
  g.select(".x-axis").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x).ticks(5));
  g.select(".y-axis").call(d3.axisLeft(y).ticks(4));

  const line = d3.line().x((_, i) => x(i)).y((d) => y(d));
  g.selectAll("path.series").data([S.followWealth]).join("path").attr("class", "series")
    .attr("fill", "none").attr("stroke", "#22d3ee").attr("stroke-width", 2).attr("d", line);
}
