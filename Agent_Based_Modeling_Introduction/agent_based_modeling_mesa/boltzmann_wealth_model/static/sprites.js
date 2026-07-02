// ---------------------------------------------------------------------------
// Comic-people sprites, tiered by wealth so differences stay legible at any
// scale. Tiers are assigned by quantile (see wealthTierFn in field.js): broke,
// poor, middle, rich. The single richest agent wears a crown; a followed agent
// gets a highlight ring. Shared filters live in <defs>.
// ---------------------------------------------------------------------------

// Wealth is encoded by shirt colour: dark navy (poor) → blue → light blue →
// white/gold (rich), and by how much the sprite glows. All sprites are the same
// size; only colour, glow and accessories change.
const TIER = {
  0: { coat: "#1e3a5f", trim: "#122744" }, // poorest — dark navy
  1: { coat: "#3b82f6", trim: "#1d4ed8" }, // blue
  2: { coat: "#93c5fd", trim: "#2563eb" }, // light blue
  3: { coat: "#ffffff", trim: "#f5b301" }, // richest — white + gold
};

// Glow filter id per tier (richer = stronger glow); "" = no glow.
const TIER_GLOW = { 0: "", 1: "", 2: "url(#glow-mid)", 3: "url(#glow-rich)" };

// Install one-time gradients/filters used by all sprites and coins.
function installDefs(svg) {
  if (!svg.select("defs.sprite-defs").empty()) return;
  const defs = svg.append("defs").attr("class", "sprite-defs");

  const addGlow = (id, dev, color, opacity) => {
    const f = defs.append("filter").attr("id", id).attr("x", "-60%").attr("y", "-60%").attr("width", "220%").attr("height", "220%");
    f.append("feDropShadow").attr("dx", 0).attr("dy", 0).attr("stdDeviation", dev).attr("flood-color", color).attr("flood-opacity", opacity);
  };
  addGlow("glow-mid", 1.1, "#bfdbfe", 0.7); // middle wealth — soft blue glow
  addGlow("glow-rich", 2.4, "#f5b301", 0.95); // rich — strong gold glow

  const coinGrad = defs.append("radialGradient").attr("id", "coin-grad").attr("cx", "35%").attr("cy", "35%");
  coinGrad.append("stop").attr("offset", "0%").attr("stop-color", "#fde68a");
  coinGrad.append("stop").attr("offset", "100%").attr("stop-color", "#d97706");
}

// Inner SVG markup for a person centred at (0,0) in a ~[-10,10] box, scaled by s.
function personMarkup(agent, tier, flags = {}) {
  const c = TIER[tier];
  const s = flags.baseSize || 1; // uniform size; wealth shows in colour, not scale
  const rich = tier === 3;
  const poor = tier <= 1;

  const mouth = rich
    ? `<path d="M -2.2 -7 Q 0 -4.8 2.2 -7" stroke="#1f2937" stroke-width="0.7" fill="none" stroke-linecap="round"/>`
    : poor
    ? `<path d="M -2 -6 Q 0 -7.8 2 -6" stroke="#1f2937" stroke-width="0.7" fill="none" stroke-linecap="round"/>`
    : `<line x1="-1.8" y1="-6.6" x2="1.8" y2="-6.6" stroke="#1f2937" stroke-width="0.7" stroke-linecap="round"/>`;

  const hat = rich
    ? `<rect x="-4.5" y="-13.2" width="9" height="1.4" rx="0.5" fill="#111827"/>
       <rect x="-3" y="-17.5" width="6" height="4.6" rx="0.6" fill="#111827"/>
       <rect x="-3" y="-14.4" width="6" height="1" fill="${c.trim}"/>`
    : "";

  const crown = flags.isKing
    ? `<path d="M -4 -13.5 L -4 -17 L -1.5 -15 L 0 -18 L 1.5 -15 L 4 -17 L 4 -13.5 Z" fill="#f5b301" stroke="#92400e" stroke-width="0.4"/>`
    : "";

  const glow = TIER_GLOW[tier] ? `filter="${TIER_GLOW[tier]}"` : "";
  const ring = flags.highlighted
    ? `<circle cx="0" cy="-2.5" r="14" fill="none" stroke="#22d3ee" stroke-width="1.4" stroke-dasharray="2 1.5" opacity="0.9"/>`
    : "";

  // Bigger, wider torso (the shirt) and a slightly smaller head, so the
  // wealth-coloured shirt dominates and agents are easier to tell apart.
  return `<g transform="scale(${s})">
    ${ring}
    <line x1="-2.2" y1="4.8" x2="-3.4" y2="10.5" stroke="${c.trim}" stroke-width="1.8" stroke-linecap="round"/>
    <line x1="2.2" y1="4.8" x2="3.4" y2="10.5" stroke="${c.trim}" stroke-width="1.8" stroke-linecap="round"/>
    <g ${glow}>
      <line x1="-3.8" y1="-1.8" x2="-6.8" y2="3" stroke="${c.coat}" stroke-width="2.1" stroke-linecap="round"/>
      <line x1="3.8" y1="-1.8" x2="6.8" y2="3" stroke="${c.coat}" stroke-width="2.1" stroke-linecap="round"/>
      <rect x="-4.2" y="-4.6" width="8.4" height="9.6" rx="1.8" fill="${c.coat}" stroke="${c.trim}" stroke-width="0.5"/>
      <circle cx="0" cy="-8.4" r="3.0" fill="#eaba8f"/>
      <circle cx="-1.1" cy="-8.9" r="0.5" fill="#1f2937"/>
      <circle cx="1.1" cy="-8.9" r="0.5" fill="#1f2937"/>
      ${mouth}
      ${hat}
      ${crown}
    </g>
  </g>`;
}
