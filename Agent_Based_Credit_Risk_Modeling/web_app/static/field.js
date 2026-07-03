/* The centerpiece: a wall of borrower tiles + a Lender vault.
   Each month, coins fly from paying borrowers into the vault, missed payments flash
   amber with a red X, and defaults turn the tile into a tombstone whose remaining
   balance is flung to the loss bucket. Pure D3-into-SVG. */

const FIELD = { layout: null, coins: 0 };
const MAX_COINS = 45;

function renderField(state, opts = {}) {
  const svg = d3.select("#field");
  const el = document.getElementById("field");
  const box = el.getBoundingClientRect();
  const W = Math.max(box.width, 320);
  const H = Math.max(box.height, 320);
  svg.attr("viewBox", `0 0 ${W} ${H}`);

  // Persistent layers so coin animations survive re-renders.
  let root = svg.select("g.field-root");
  if (root.empty()) {
    root = svg.append("g").attr("class", "field-root");
    root.append("g").attr("class", "heat");
    root.append("g").attr("class", "tiles");
    root.append("g").attr("class", "vault");
    root.append("g").attr("class", "fx");
  }

  const pad = 8;
  const vaultW = Math.min(190, W * 0.32);
  const wallW = W - vaultW - pad * 2;
  const wallH = H - pad * 2;
  const wallX = pad, wallY = pad;

  const borrowers = state.borrowers;
  const n = borrowers.length || 1;
  const aspect = wallW / wallH;
  let cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
  let rows = Math.ceil(n / cols);
  const cell = Math.floor(Math.min(wallW / cols, wallH / rows));
  cols = Math.max(1, Math.floor(wallW / cell));
  rows = Math.ceil(n / cols);

  const view = chosenView(state, cell);
  const gap = view === "heatmap" ? 1 : Math.max(2, Math.round(cell * 0.12));
  const size = cell - gap;

  // Record centers for coin targets.
  const tileById = {};
  borrowers.forEach((b, i) => {
    const cx = wallX + (i % cols) * cell + size / 2;
    const cy = wallY + Math.floor(i / cols) * cell + size / 2;
    tileById[b.id] = { cx, cy };
  });
  const vaultCx = W - vaultW / 2 - pad;
  const vaultCy = H * 0.4;
  const lossCx = W - vaultW / 2 - pad;
  const lossCy = H * 0.82;
  FIELD.layout = { tileById, cell, size, view, vault: { cx: vaultCx, cy: vaultCy }, loss: { cx: lossCx, cy: lossCy } };

  drawVault(root.select("g.vault"), state, vaultCx, vaultCy, lossCx, lossCy, vaultW);
  drawTiles(root.select("g.tiles"), borrowers, tileById, size, view);

  if (opts.animate && state.transactions) playTransactions(state);
}

function chosenView(state, cell) {
  const sel = document.getElementById("view-select").value;
  if (sel === "tiles") return "tiles";
  if (sel === "heatmap") return "heatmap";
  return cell < 26 ? "heatmap" : "tiles";  // auto
}

function drawTiles(g, borrowers, tileById, size, view) {
  const showText = view === "tiles" && size >= 30;
  const r = view === "heatmap" ? 1 : Math.min(6, size * 0.18);

  const tiles = g.selectAll("g.tile").data(borrowers, (d) => d.id);
  tiles.exit().remove();

  const enter = tiles.enter().append("g").attr("class", "tile");
  enter.append("rect").attr("class", "bg");
  enter.append("rect").attr("class", "balbar");
  enter.append("text").attr("class", "score");
  enter.append("text").attr("class", "mark");

  const merged = enter.merge(tiles);
  merged.attr("transform", (d) => {
    const c = tileById[d.id];
    return `translate(${c.cx - size / 2},${c.cy - size / 2})`;
  });

  merged.select("rect.bg")
    .attr("width", size).attr("height", size)
    .attr("rx", r).attr("ry", r)
    .attr("fill", (d) => statusColor(d))
    .attr("fill-opacity", (d) => (d.status === "paid_off" ? 0.55 : 0.9))
    .attr("stroke", "rgba(0,0,0,0.35)").attr("stroke-width", 1)
    .style("cursor", "pointer")
    .on("mousemove", (ev, d) => showTip(borrowerTip(d), ev))
    .on("mouseleave", hideTip);

  // Remaining-balance bar along the bottom (share of principal still owed).
  merged.select("rect.balbar")
    .attr("x", 3)
    .attr("height", 4)
    .attr("y", size - 7)
    .attr("rx", 2)
    .attr("width", (d) => Math.max(0, (size - 6) * (d.principal > 0 ? d.balance / d.principal : 0)))
    .attr("fill", "rgba(0,0,0,0.55)")
    .attr("display", view === "heatmap" ? "none" : null);

  merged.select("text.score")
    .attr("x", size / 2).attr("y", size / 2 - 2)
    .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
    .attr("fill", "rgba(0,0,0,0.85)").attr("font-size", Math.min(15, size * 0.34))
    .attr("font-weight", 700)
    .text((d) => (showText && d.status !== "defaulted" ? Math.round(d.credit_score) : ""));

  // Tombstone cross for defaulted borrowers.
  merged.select("text.mark")
    .attr("x", size / 2).attr("y", size / 2 - 2)
    .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
    .attr("fill", "#fff").attr("font-size", Math.min(18, size * 0.5))
    .attr("font-weight", 700)
    .text((d) => (d.status === "defaulted" && view === "tiles" ? "†" : ""));
}

function borrowerTip(d) {
  const title = d.name
    ? `<span class="tt-name">${d.name}</span>` + (d.persona ? `<br/><span class="tt-persona">${d.persona}</span> &mdash; ${d.persona_blurb}` : "")
    : `<span class="tt-name">Borrower ${d.id}</span>`;
  let s = `${title}<br/>score ${Math.round(d.credit_score)} &middot; APR ${fmtPct(d.apr)}<br/>` +
    `balance ${fmtMoney(d.balance)} / ${fmtMoney(d.principal)}<br/>` +
    `payment ${fmtMoney(d.monthly_payment)}/mo &middot; ${d.status}`;
  if (d.consecutive_misses > 0) s += `<br/>missed ${d.consecutive_misses} in a row`;
  if (d.reliability != null) s += `<br/>AI reliability ${Math.round(d.reliability * 100)}%`;
  if (d.ai_reason) s += `<br/><i>“${d.ai_reason}”</i>`;
  return s;
}

function drawVault(g, state, vx, vy, lx, ly, vaultW) {
  const w = vaultW - 16;
  const h = 120;

  let vault = g.select("g.vault-box");
  if (vault.empty()) {
    vault = g.append("g").attr("class", "vault-box");
    vault.append("rect").attr("class", "vbg").attr("rx", 12);
    vault.append("text").attr("class", "vicon").text("🏦");
    vault.append("text").attr("class", "vlabel").text("LENDER VAULT");
    vault.append("text").attr("class", "vval");

    const loss = g.append("g").attr("class", "loss-box");
    loss.append("rect").attr("class", "lbg").attr("rx", 12);
    loss.append("text").attr("class", "licon").text("🔥");
    loss.append("text").attr("class", "llabel").text("LOSSES");
    loss.append("text").attr("class", "lval");
  }

  const vault2 = g.select("g.vault-box");
  vault2.select("rect.vbg")
    .attr("x", vx - w / 2).attr("y", vy - h / 2).attr("width", w).attr("height", h)
    .attr("fill", "rgba(12,163,12,0.10)").attr("stroke", PALETTE.good).attr("stroke-width", 1.5);
  vault2.select("text.vicon").attr("x", vx).attr("y", vy - 26).attr("text-anchor", "middle").attr("font-size", 30);
  vault2.select("text.vlabel").attr("x", vx).attr("y", vy + 12).attr("text-anchor", "middle")
    .attr("fill", PALETTE.muted).attr("font-size", 10).attr("letter-spacing", "1px");
  vault2.select("text.vval").attr("x", vx).attr("y", vy + 34).attr("text-anchor", "middle")
    .attr("fill", PALETTE.good).attr("font-size", 18).attr("font-weight", 700)
    .text(fmtMoney(state.vault.collected));

  const loss2 = g.select("g.loss-box");
  const lh = 78;
  loss2.select("rect.lbg")
    .attr("x", lx - w / 2).attr("y", ly - lh / 2).attr("width", w).attr("height", lh)
    .attr("fill", "rgba(208,59,59,0.10)").attr("stroke", PALETTE.critical).attr("stroke-width", 1.5);
  loss2.select("text.licon").attr("x", lx).attr("y", ly - 16).attr("text-anchor", "middle").attr("font-size", 20);
  loss2.select("text.llabel").attr("x", lx).attr("y", ly + 4).attr("text-anchor", "middle")
    .attr("fill", PALETTE.muted).attr("font-size", 9).attr("letter-spacing", "1px");
  loss2.select("text.lval").attr("x", lx).attr("y", ly + 24).attr("text-anchor", "middle")
    .attr("fill", PALETTE.critical).attr("font-size", 15).attr("font-weight", 700)
    .text(fmtMoney(state.vault.loss));
}

function playTransactions(state) {
  const L = FIELD.layout;
  if (!L) return;
  const fx = d3.select("#field").select("g.fx");
  const interval = Number(document.getElementById("play-interval").value) || 350;
  const dur = Math.min(700, interval * 0.85);

  const payments = state.transactions.filter((t) => t.type === "payment");
  const misses = state.transactions.filter((t) => t.type === "miss");
  const defaults = state.transactions.filter((t) => t.type === "default");

  // Coins fly from paying tiles into the vault (capped for performance).
  payments.slice(0, MAX_COINS - FIELD.coins).forEach((t) => {
    const from = L.tileById[t.id];
    if (!from) return;
    flyCoin(fx, from, L.vault, dur, PALETTE.gold);
  });
  if (payments.length) pulse(d3.select("#field").select("g.vault").select("g.vault-box"), PALETTE.good);

  // Misses: a red X pops on the tile.
  misses.forEach((t) => {
    const c = L.tileById[t.id];
    if (c) flashMark(fx, c, "✗", PALETTE.critical, dur);
  });

  // Defaults: fling the remaining balance to the loss bucket.
  defaults.forEach((t) => {
    const from = L.tileById[t.id];
    if (from) flyChunk(fx, from, L.loss, dur, PALETTE.critical);
  });
  if (defaults.length) pulse(d3.select("#field").select("g.vault").select("g.loss-box"), PALETTE.critical);
}

function flyCoin(fx, from, to, dur, color) {
  FIELD.coins++;
  const arc = -30 - Math.random() * 30;
  const coin = fx.append("circle")
    .attr("r", 5).attr("fill", color).attr("stroke", "#7a5a00").attr("stroke-width", 1)
    .attr("cx", from.cx).attr("cy", from.cy).attr("opacity", 0.95);
  coin.transition().duration(dur).ease(d3.easeQuadInOut)
    .attrTween("cx", () => (u) => from.cx + (to.cx - from.cx) * u)
    .attrTween("cy", () => (u) => from.cy + (to.cy - from.cy) * u + arc * Math.sin(Math.PI * u))
    .attr("opacity", 0.6)
    .on("end", () => { coin.remove(); FIELD.coins--; });
}

function flyChunk(fx, from, to, dur, color) {
  const chunk = fx.append("rect")
    .attr("width", 12).attr("height", 12).attr("rx", 2).attr("fill", color)
    .attr("x", from.cx - 6).attr("y", from.cy - 6).attr("opacity", 0.95);
  chunk.transition().duration(dur * 1.1).ease(d3.easeQuadIn)
    .attrTween("x", () => (u) => from.cx - 6 + (to.cx - from.cx) * u)
    .attrTween("y", () => (u) => from.cy - 6 + (to.cy - from.cy) * u)
    .attr("opacity", 0.4).on("end", () => chunk.remove());
}

function flashMark(fx, c, glyph, color, dur) {
  const t = fx.append("text")
    .attr("x", c.cx).attr("y", c.cy).attr("text-anchor", "middle").attr("dominant-baseline", "middle")
    .attr("fill", color).attr("font-size", 20).attr("font-weight", 700).text(glyph).attr("opacity", 1);
  t.transition().duration(dur * 1.4).attr("y", c.cy - 14).attr("opacity", 0).on("end", () => t.remove());
}

function pulse(sel, color) {
  const rect = sel.select("rect");
  if (rect.empty()) return;
  const orig = rect.attr("stroke-width");
  rect.transition().duration(140).attr("stroke-width", 4)
    .transition().duration(240).attr("stroke-width", orig);
}
