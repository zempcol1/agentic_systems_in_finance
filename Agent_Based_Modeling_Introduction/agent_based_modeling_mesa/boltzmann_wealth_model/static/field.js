// ---------------------------------------------------------------------------
// The field: renders agents on the grid or in continuous space, with a heatmap
// LOD fallback, gliding motion, click-to-follow, and the flying-coin + sound
// transaction effects.
// ---------------------------------------------------------------------------

function fieldGeom(state) {
  const svg = d3.select("#field");
  const box = svg.node().getBoundingClientRect();
  const cell = Math.min(box.width / state.width, box.height / state.height);
  const VW = state.width * cell;
  const VH = state.height * cell;
  // Pad the viewBox so agents standing on the outer cells/edges aren't clipped
  // (a person sprite extends about one cell above its centre).
  const pad = cell;
  svg.attr("viewBox", `${-pad} ${-pad} ${VW + 2 * pad} ${VH + 2 * pad}`);
  return { svg, cell, VW, VH, pad };
}

function chosenView(state) {
  const sel = document.getElementById("view-select").value;
  if (sel === "auto") return state.agents.length > LOD_AGENT_THRESHOLD ? "heatmap" : "sprites";
  return sel;
}

function ensureLayers(svg) {
  ["heat", "trail", "agents", "fx"].forEach((cls) => {
    if (svg.select(`g.${cls}`).empty()) svg.append("g").attr("class", cls);
  });
}

function renderField(state) {
  const { svg, cell } = fieldGeom(state);
  ensureLayers(svg);
  installDefs(svg);
  const view = chosenView(state);

  svg.select("g.agents").style("display", view === "sprites" ? null : "none");
  svg.select("g.heat").style("display", view === "heatmap" ? null : "none");

  if (view === "heatmap") renderHeat(state, svg, cell);
  else renderSprites(state, svg, cell);

  renderTrail(svg, cell);
}

function renderHeat(state, svg, cell) {
  // Aggregate wealth into unit cells (works for both grid and continuous coords).
  const totals = new Map();
  for (const a of state.agents) {
    const cx = Math.min(state.width - 1, Math.floor(a.x));
    const cy = Math.min(state.height - 1, Math.floor(a.y));
    const key = `${cx},${cy}`;
    totals.set(key, (totals.get(key) || 0) + a.wealth);
  }
  const max = d3.max([...totals.values()]) || 1;
  const color = d3.scaleSequential(d3.interpolateBlues).domain([0, max]);

  const data = [];
  for (let x = 0; x < state.width; x++)
    for (let y = 0; y < state.height; y++) {
      data.push({ x, y, v: totals.get(`${x},${y}`) || 0 });
    }

  svg
    .select("g.heat")
    .selectAll("rect")
    .data(data, (d) => `${d.x},${d.y}`)
    .join("rect")
    .attr("x", (d) => d.x * cell)
    .attr("y", (d) => d.y * cell)
    .attr("width", cell)
    .attr("height", cell)
    .attr("stroke", "#0b1626")
    .attr("stroke-width", 0.4)
    .attr("fill", (d) => (d.v === 0 ? "#0f2033" : color(d.v)));
}

// Assign a wealth tier (0 broke, 1 poor, 2 middle, 3 rich) by quantile, so the
// population always shows visible variety regardless of the wealth scale.
function wealthTierFn(agents) {
  const positive = agents.map((a) => a.wealth).filter((w) => w > 0).sort((a, b) => a - b);
  if (!positive.length) return () => 0;
  const q = (p) => positive[Math.min(positive.length - 1, Math.floor(p * positive.length))];
  const t1 = q(0.34);
  const t2 = q(0.75);
  return (w) => (w <= 0 ? 0 : w <= t1 ? 1 : w <= t2 ? 2 : 3);
}

function renderSprites(state, svg, cell) {
  const layer = svg.select("g.agents");
  const tierOf = wealthTierFn(state.agents);

  // Place agents; grid agents sharing a cell are spread into a sub-grid.
  const placed = [];
  if (state.space_mode === "continuous") {
    const targetPx = Math.max(8, cell * 1.3);
    for (const a of state.agents) {
      placed.push({ id: a.id, wealth: a.wealth, px: a.x * cell, py: a.y * cell, baseSize: targetPx / 28 });
    }
  } else {
    const byCell = d3.group(state.agents, (a) => `${a.x},${a.y}`);
    for (const [, group] of byCell) {
      group.sort((a, b) => a.id - b.id); // stable slotting for smooth gliding
      const k = group.length;
      const cols = Math.ceil(Math.sqrt(k));
      const rows = Math.ceil(k / cols);
      const targetPx = cell * 0.72; // uniform size regardless of how crowded the cell is
      group.forEach((a, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        placed.push({
          id: a.id,
          wealth: a.wealth,
          px: a.x * cell + ((col + 0.5) / cols) * cell,
          py: a.y * cell + ((row + 0.5) / rows) * cell,
          baseSize: targetPx / 28,
        });
      });
    }
  }

  const kingId = state.agents.reduce((best, a) => (best === null || a.wealth > best.w ? { id: a.id, w: a.wealth } : best), null);
  const glide = document.getElementById("glide-toggle").checked && placed.length <= 250;
  const dur = Math.max(120, Math.min(500, S.playInterval * 0.9));

  // Record followed-agent position for the trail.
  if (S.followedId != null) {
    const f = placed.find((d) => d.id === S.followedId);
    if (f) {
      S.trail.push([f.px, f.py]);
      if (S.trail.length > 40) S.trail.shift();
    }
  }

  const sel = layer.selectAll("g.person").data(placed, (d) => d.id);
  sel.exit().remove();
  const ent = sel
    .enter()
    .append("g")
    .attr("class", "person")
    .attr("transform", (d) => `translate(${d.px},${d.py})`)
    .style("cursor", "pointer")
    .on("click", (_, d) => followAgent(d.id));
  const merged = ent.merge(sel);
  merged.html((d) => personMarkup(d, tierOf(d.wealth), { baseSize: d.baseSize, isKing: kingId && d.id === kingId.id, highlighted: d.id === S.followedId }));
  if (glide) merged.transition().duration(dur).attr("transform", (d) => `translate(${d.px},${d.py})`);
  else merged.interrupt().attr("transform", (d) => `translate(${d.px},${d.py})`);
}

function renderTrail(svg, cell) {
  const layer = svg.select("g.trail");
  if (S.followedId == null || S.trail.length < 2) {
    layer.selectAll("*").remove();
    return;
  }
  const line = d3.line().x((d) => d[0]).y((d) => d[1]);
  layer
    .selectAll("path")
    .data([S.trail])
    .join("path")
    .attr("fill", "none")
    .attr("stroke", "#22d3ee")
    .attr("stroke-width", 1.5)
    .attr("stroke-opacity", 0.5)
    .attr("stroke-dasharray", "3 2")
    .attr("d", line);
}

function followAgent(id) {
  S.followedId = S.followedId === id ? null : id;
  S.trail = [];
  S.followWealth = [];
  document.getElementById("follow-status").textContent =
    S.followedId == null ? "Not following anyone (click an agent)." : `Following agent #${S.followedId}`;
  document.getElementById("follow-card").style.display = S.followedId == null ? "none" : "";
  if (S.lastState) rerenderFromState();
}

// ---------------------------------------------------------------------------
// Transactions: flying coins + optional sound
// ---------------------------------------------------------------------------

let audioCtx = null;
let lastSoundAt = 0;

function playCoinSound() {
  if (!document.getElementById("sound-toggle").checked) return;
  const now = performance.now();
  if (now - lastSoundAt < 55) return;
  lastSoundAt = now;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    [
      { f: 880, t: 0 },
      { f: 1320, t: 0.08 },
    ].forEach(({ f, t }) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const start = audioCtx.currentTime + t;
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });
  } catch (e) {
    /* ignore */
  }
}

function playTransactions(state) {
  if (!document.getElementById("animate-toggle").checked) return;
  if (chosenView(state) !== "sprites") return; // no coins over the heatmap
  const txns = state.transactions || [];
  if (!txns.length) return;

  const { svg, cell } = fieldGeom(state);
  const fx = svg.select("g.fx");
  const continuous = state.space_mode === "continuous";

  const MAX_COINS = 40;
  const shown = txns.length > MAX_COINS ? d3.shuffle(txns.slice()).slice(0, MAX_COINS) : txns;

  shown.forEach((t) => {
    // Grid transfers are intra-cell (jitter within the cell); continuous fly for real.
    const jit = () => 0.28 + Math.random() * 0.44;
    const x0 = continuous ? t.fromX * cell : t.fromX * cell + jit() * cell;
    const y0 = continuous ? t.fromY * cell : t.fromY * cell + jit() * cell;
    const x1 = continuous ? t.toX * cell : t.toX * cell + jit() * cell;
    const y1 = continuous ? t.toY * cell : t.toY * cell + jit() * cell;
    const r = cell * 0.13;
    const lift = Math.max(cell * 0.2, Math.hypot(x1 - x0, y1 - y0) * 0.18);

    const coin = fx
      .append("circle")
      .attr("cx", x0)
      .attr("cy", y0)
      .attr("r", r)
      .attr("fill", "url(#coin-grad)")
      .attr("stroke", "#78350f")
      .attr("stroke-width", Math.max(0.5, r * 0.15));

    coin
      .transition()
      .duration(430)
      .ease(d3.easeQuadOut)
      .attrTween("cy", () => (u) => y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * lift)
      .attr("cx", x1)
      .attr("r", r * 0.7)
      .on("end", function () {
        fx.append("circle")
          .attr("cx", x1)
          .attr("cy", y1)
          .attr("r", r)
          .attr("fill", "none")
          .attr("stroke", PALETTE.coin)
          .attr("stroke-width", 2)
          .transition()
          .duration(260)
          .attr("r", cell * 0.45)
          .attr("stroke-opacity", 0)
          .remove();
        d3.select(this).remove();
      });

    playCoinSound();
  });
}
