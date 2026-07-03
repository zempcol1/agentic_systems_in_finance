# Credit-Risk Lab — Agent-Based Loan Portfolio

Folder: `Agent_Based_Credit_Risk_Modeling/web_app/`

## Summary

An interactive agent-based credit-risk simulation. A **lender** prices loans off each
borrower's credit score (lower score → higher APR). Each **borrower** is an agent that takes
out a fixed-principal, fully-amortizing loan and, every month, either makes its constant
amortized payment or misses it; three consecutive misses (configurable) turn the borrower
into a **default**, and its remaining balance becomes a loss to the lender. The **model**
steps the whole population month by month until every loan resolves (paid off or defaulted),
tracking portfolio-level outcomes over time.

The dashboard visualizes this as a **wall of borrower tiles feeding a Lender vault**: each
month, coins fly from paying borrowers into the vault, missed payments flash amber with a red
✗, and defaults turn a tile into a tombstone (†) whose balance is flung to the loss bucket.
Alongside the field are KPI tiles, time-series charts (outstanding balance, active-vs-defaulted
population, cumulative collected-vs-loss), a risk-pricing scatter (score → APR), an economy
timeline, and an in-browser sensitivity heatmap.

Two extra features beyond the core model:

- **AI Borrowers tab** — a second tab (violet theme) where every borrower is given a random
  name and a **persona** (e.g. "Salaried professional", "Gig-economy driver", "Small-business
  owner"). Each persona carries behavioural modifiers that shift the borrower's parameters:
  `risk_mult` scales how often they miss, `shock_mult` scales how hard a recession hits them —
  so the persona genuinely changes outcomes, not just the tooltip. Hover any tile to meet the
  borrower. When an `OPENAI_API_KEY` is set, one small LLM call **at reset** rates each persona
  for payment reliability (0–1, shown on hover with a rationale); every borrower inherits its
  persona's score, nudged by its own credit score, and this drives the monthly miss
  probability. The per-month simulation runs fully offline, so stepping stays instant. Without
  a key, personas still shape behaviour via their built-in risk multipliers.
- **Economic shock timeline** — schedule a recession (or trigger one live) that temporarily
  multiplies every borrower's miss probability, and watch the portfolio react. Available in
  both tabs.

## How to Run

```bash
python server.py
```

Then open http://localhost:8005/ in a browser.

Optional, for AI Borrower mode: copy `.env.example` (repo root) to `.env` and set
`OPENAI_API_KEY`. Without it the app runs fine — the AI toggle simply stays disabled.

## Model Parameters

| Parameter | Default | Meaning |
| --- | ---: | --- |
| `n_borrowers` | 60 | Number of borrower agents in the portfolio. |
| `principal` | 10000 | Loan principal per borrower ($). |
| `loan_term_months` | 36 | Nominal loan term used for the amortized payment. |
| `base_default_prob` | 0.03 | Base monthly probability a borrower misses a payment. |
| `risk_slope` | 3.0 | How much more likely the worst-scored borrower is to miss vs. the best. |
| `max_consecutive_misses` | 3 | Consecutive misses that trigger a default. |
| `apr_floor` | 0.04 | Annual APR charged to the best credit score. |
| `apr_ceiling` | 0.30 | Annual APR charged to the worst credit score. |
| `score_min` / `score_max` | 50 / 100 | Range credit scores are drawn from. |
| `seed` | 42 | RNG seed (reset gives a reproducible run). |
| `ai_mode` | false | Set by the active tab: on in **AI Borrowers**, off in **Live Simulation**. Assigns names/personas and enables LLM pay-late decisions. |
| `shock_start` | 0 | Month a scheduled recession begins (0 = none). |
| `shock_duration` | 6 | Length of the shock window (months). |
| `shock_severity` | 3.0 | Miss-probability multiplier during a shock. |

## Model Logic

- **Pricing** (`Lender.price`): `apr = apr_ceiling − (score − score_min)/(score_max − score_min)
  · (apr_ceiling − apr_floor)`, so a lower score always yields a higher rate.
- **Amortized payment**: `m = p·r·(1+r)ⁿ / ((1+r)ⁿ − 1)`, with `r` the monthly rate and `n`
  the term (verified against calculator.net: $100k / 5% / 30y → $536.82).
- **Repayment**: each paid month, interest = `balance · r`, the rest of the fixed payment
  reduces principal; the interest/principal split shifts toward principal over time.
- **Miss / default**: monthly miss probability = `base_default_prob · risk(score) · economy`,
  where riskier scores and recessions raise it; `max_consecutive_misses` in a row → default.

## Portfolio Metrics

- **Total lent / Collected / Losses** — cash out (Σ principal), cash in (Σ payments =
  principal + interest received), and unrecovered principal charged off from defaulters.
- **Defaulted share** = principal+interest that defaulters never paid ÷ total principal+interest
  the whole book was scheduled to pay (both sides in principal+interest terms).
- **ROI** = `(collected − principal lent) ÷ principal lent` (annualizable by `term/12`).
  Defaults are already captured in `collected`, so loss is not subtracted again; ROI is bounded
  below by −100%.

## Sensitivity Analysis

Two ways, sharing one run function (`sensitivity_core.run_one_simulation`):

- **In the browser** — the *Sensitivity* card lets you pick **any two parameters** for the X and
  Y axes (base miss probability, loan term, APR ceiling, risk slope, misses-to-default, or shock
  severity), sweeps them in parallel, and renders a heatmap you can colour by **defaulted share,
  ROI, or default rate**. Non-swept parameters are held at the current sidebar settings. (A
  useful thing to notice: APR ceiling moves ROI but not the default rate — pricing changes
  profit, not who defaults.)
- **From the CLI** —

  ```bash
  python sensitivity_analysis.py
  ```

  writes `sensitivity_analysis_results.csv` and prints pivot tables of mean defaulted-share
  and mean ROI over the same axes.

## Files

- `model.py` — `Lender`, `Borrower`, `CreditModel`, and JSON-shaping helpers.
- `personas.py` — random borrower names and archetypes (with behavioural modifiers) for the AI tab.
- `ai_borrower.py` — optional LLM decision layer with graceful fallback.
- `server.py` — Flask backend (`/api/reset|step|state|shock|sensitivity`), port 8005.
- `sensitivity_core.py` — shared, picklable single-run function.
- `sensitivity_analysis.py` — standalone parameter sweep → CSV + summaries.
- `static/` — hand-built D3 frontend: `index.html`, `style.css`, `app.js` (orchestrator),
  `field.js` (vault & wall + animation), `charts.js`, `economy.js`, `sensitivity.js`.

## Further Reading

- The five Cs of credit (Investopedia): https://www.investopedia.com/terms/f/five-c-credit.asp
- Loan amortization calculator (payment check): https://www.calculator.net/loan-calculator.html
