/* Economy timeline strip: the default-probability multiplier over time, with shock
   windows highlighted. Drives home the "conditions" C of credit -- recessions raise
   everyone's miss probability. */

function renderEconomy(state) {
  const svg = d3.select("#economy");
  const el = svg.node().getBoundingClientRect();
  const w = el.width || 600, h = el.height || 90;
  const m = { t: 10, r: 14, b: 20, l: 40 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  svg.attr("viewBox", `0 0 ${w} ${h}`);

  let g = svg.select("g.plot");
  if (g.empty()) {
    g = svg.append("g").attr("class", "plot");
    g.append("g").attr("class", "shocks");
    g.append("g").attr("class", "axis x");
    g.append("g").attr("class", "axis y");
    g.append("path").attr("class", "mult");
    g.append("line").attr("class", "now");
  }
  g.attr("transform", `translate(${m.l},${m.t})`);

  const params = state.params;
  const horizon = Math.max(state.step + 6, params.loan_term_months, 12);
  const severity = params.shock_severity || 3;
  const x = d3.scaleLinear().domain([0, horizon]).range([0, iw]);
  const y = d3.scaleLinear().domain([0, Math.max(severity * 1.1, 2)]).range([ih, 0]);

  // Shock windows as shaded bands.
  const windows = state.economy.shock_windows || [];
  const bands = g.select("g.shocks").selectAll("rect").data(windows);
  bands.exit().remove();
  bands.enter().append("rect").merge(bands)
    .attr("x", (d) => x(d.start)).attr("y", 0)
    .attr("width", (d) => Math.max(0, x(d.start + d.duration) - x(d.start)))
    .attr("height", ih).attr("fill", "rgba(208,59,59,0.16)")
    .attr("stroke", "rgba(208,59,59,0.4)").attr("stroke-dasharray", "3 3");

  // Multiplier step line across the horizon.
  const pts = d3.range(0, horizon + 1).map((mo) => {
    let mult = 1;
    windows.forEach((wd) => { if (wd.start <= mo && mo < wd.start + wd.duration) mult = severity; });
    return { mo, mult };
  });
  const line = d3.line().curve(d3.curveStepAfter).x((d) => x(d.mo)).y((d) => y(d.mult));
  g.select("path.mult").attr("d", line(pts)).attr("fill", "none")
    .attr("stroke", PALETTE.warning).attr("stroke-width", 2);

  g.select("g.axis.x").attr("transform", `translate(0,${ih})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d")));
  g.select("g.axis.y").call(d3.axisLeft(y).ticks(3).tickFormat((v) => v + "×"));

  // "now" marker at the current month.
  g.select("line.now")
    .attr("x1", x(state.step)).attr("x2", x(state.step)).attr("y1", 0).attr("y2", ih)
    .attr("stroke", PALETTE.text2).attr("stroke-width", 1).attr("stroke-dasharray", "2 3")
    .attr("opacity", 0.7);
}
