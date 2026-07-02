# Boltzmann Wealth Model — "Money Game"

Folder: `Agent_Based_Modeling_Introduction/agent_based_modeling_mesa/boltzmann_wealth_model/`

## Summary

An interactive agent-based model of a random-exchange economy (Dragulescu &
Yakovenko, "Statistical mechanics of money"). Every agent starts with the same
wealth, wanders around, and hands wealth to a neighbour when they meet. No agent
tries to get rich and the default rule is symmetric, yet inequality emerges: the
distribution relaxes toward the exponential (Boltzmann–Gibbs) shape and the
**Gini coefficient** climbs from 0 toward a steady value.

The app is built as a teaching sandbox — a "money game" where agents are drawn as
**little comic people** whose look tracks their wealth (ragged paupers → crowned,
top-hatted, money-bag tycoons), transfers show as **flying coins** with an
optional **"cha-ching"**, and you can change the rules of the economy live and
watch inequality respond.

## How to Run

The classic model (`BoltzmannWealth`, `MoneyAgent`) ships with `mesa`; here we
build our own thin engine in `model.py` on top of Mesa's spaces and agents so we
can log transfers, support continuous space, add exchange-rule variants and tax,
and keep everything reproducible.

From this folder:

```
    $ python server.py
```
Then open http://localhost:8002/ in a browser. Requires `mesa`, `flask`,
`pandas`, and (for the CLI sweep) `tqdm`.

## Model Parameters

| Parameter | Default | Meaning |
|---|---|---|
| Number of Agents | 60 | How many money-holding agents. |
| Starting wealth each | 1 | Units every agent begins with. Raise it for finer-grained distributions (needed to see the saving-model's peak). |
| Space size W/H | 30×10 | Size of the space. |
| Space | Continuous | **Grid** = classic Moore grid, trade with a cell-mate. **Continuous** (default) = agents random-walk in a bounded continuous space and trade with any neighbour within an interaction radius (coins then fly across space). |
| Interaction radius / Step size | 1 / 1 | Continuous mode only: who counts as a neighbour, and how far agents walk per step. Radius replaces grid size as the "how often they meet" knob. |
| Exchange rule | Give 1 to random | See below. |
| Give fraction | 0.5 | `give_fraction` rule: share of wealth transferred. |
| Saving λ | 0.5 | `saving_propensity` rule: fraction each agent keeps before the rest is pooled and split. |
| Tax / redistribution | 0 | Each step, skim this fraction of everyone's wealth and redistribute it evenly. |

### Exchange rules

- **Give 1 to random neighbour** — the classic additive model → exponential
  (Boltzmann–Gibbs) distribution.
- **Give 1 to the poorest neighbour** — a mild equalising rule; steady-state Gini
  is lower.
- **Give a fraction of wealth** — multiplicative-ish transfer.
- **Saving propensity** (Chakraborti–Chakrabarti) — both partners keep a fraction
  λ and randomly split the pooled remainder → a **peaked (Gamma-like)**
  distribution rather than exponential. Use a higher "starting wealth" to see the
  peak clearly (the "Careful savers" preset does this).

Wealth is kept as an **integer** in every mode (the saving model uses an integer
approximation) so the per-unit histogram and the theory overlay stay clean.

## What the Dashboard Shows

- **KPI tiles** (Gini, richest, % broke, total wealth) with live sparklines, plus
  an **inequality gauge** with real-world Gini reference ticks.
- **The field**: comic-people sprites (crown on the current richest, click any
  agent to **follow** it — highlight, path trail, and a personal wealth chart), a
  **wealth heatmap** view, and an **Auto** mode that switches to the heatmap when
  the field gets crowded. "Glide" gives smooth motion instead of teleporting.
- **Inequality over time (Gini)** with real-world reference lines (Sweden/US/Brazil).
- **Lorenz curve** with the 45° line of equality.
- **Wealth distribution** histogram with the **Boltzmann–Gibbs (ideal) overlay**
  `N/⟨m⟩·e^(−m/⟨m⟩)` — for the additive rule the bars converge to this curve.
- **Distribution on a log scale** — the same distribution with a log count axis,
  the classic econophysics view: the Boltzmann–Gibbs exponential appears as a
  **straight line**, so departures from it (e.g. the saving model) are obvious.
- **Presets** ("Equal start", "Robin Hood", "Winner takes most", "Careful savers",
  "Continuous space"), a **CSV export** of the run, and the sensitivity panel.

### Gini and the Lorenz curve

The Gini coefficient is computed with the standard formula (the `BoltzmannGame.gini`
property): 0 = perfect equality, closer to 1 = one agent holds almost everything.
It is exactly the single-number summary of the Lorenz curve shown alongside it.

## Design Decisions (and why)

- **Faithful spaces.** Grid mode keeps the classic same-cell exchange; continuous
  mode uses Mesa's `ContinuousSpace`, bounded (agents reflect off the walls, no
  wrap-around), with a radius neighbour query. Both spaces are non-toroidal.
- **Sprites encode wealth continuously** (coat colour, size, glow, coins-in-hand),
  with a crown for the single richest so it's trackable.
- **Integer wealth everywhere** so the histogram and exponential overlay stay
  exact; `initial_wealth` exposes resolution when a rule (saving) needs it.
- **Synthesized sound**, muted by default; **heatmap LOD** and **gliding** keep
  fast runs readable.
- **Chart palette** taken from the validated dark-mode reference in the `dataviz`
  skill; heatmaps use a single-hue sequential ramp.

## Frontend structure

Buildless plain scripts (no bundler), loaded in order by `index.html`:
`config.js` (palette, presets, shared state) → `sprites.js` → `charts.js`
(KPIs, gauge, Gini/Lorenz/histogram/bar-race/follow) → `field.js` (grid &
continuous rendering, heatmap, transactions, sound, follow) → `sensitivity.js` →
`app.js` (fetch + orchestrate + wiring).

## Sensitivity Analysis

The "Sensitivity Analysis" card sweeps **Number of Agents × Grid Size** in the
browser, holding the current exchange rule / space / tax fixed, and renders a
heatmap of the mean final Gini (or mean richest-agent wealth). Denser
configurations (more agents, smaller grid) trade more per step, so inequality
builds faster.

Standalone CLI for bigger sweeps:
```
    $ python sensitivity_analysis.py
```
prints console pivot tables and writes `sensitivity_analysis_results.csv`. Both
share the per-run logic in `sensitivity_core.py`.

## Sanity Checks

- On **Reset**, all agents hold the starting wealth → Gini ≈ 0, Lorenz on the
  diagonal, histogram a single bar.
- **Play** makes inequality emerge (Gini rises, Lorenz sags, histogram spreads).
- **Robin Hood / tax** bends the Gini curve down; **give-to-poorer** lowers the
  steady state; **saving propensity** produces a peaked distribution.
- **Continuous** mode: agents move continuously and coins fly between them.

## Files

* `model.py`: the money-game engine — `GridMoneyAgent`, `ContinuousMoneyAgent`,
  `BoltzmannGame`, exchange rules, tax, and the `lorenz_points` / `wealth_histogram` helpers.
* `server.py`: Flask backend (`/api/reset`, `/api/step`, `/api/state`, `/api/sensitivity`).
* `static/`: buildless JS/D3 frontend (see structure above).
* `sensitivity_core.py` / `sensitivity_analysis.py`: shared per-run logic + CLI sweep.

## Further Reading

Mesa example:
https://mesa.readthedocs.io/latest/examples/basic/boltzmann_wealth_model.html

Dragulescu, A. & Yakovenko, V. M., *Statistical mechanics of money*, Eur. Phys.
J. B 17, 723–729 (2000). ArXiv: https://arxiv.org/abs/cond-mat/0001432

Chakraborti, A. & Chakrabarti, B. K., *Statistical mechanics of money: how saving
propensity affects its distribution*, Eur. Phys. J. B 17, 167–170 (2000).
