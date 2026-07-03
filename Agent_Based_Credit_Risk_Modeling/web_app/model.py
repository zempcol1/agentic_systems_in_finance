"""Agent-based credit-risk model.

Three plain classes, as suggested by the task:

* ``Lender``      -- turns a credit score into an interest rate (lower score -> higher rate).
* ``Borrower``    -- one agent holding its own loan state, with a ``step()`` that attempts
                     one month's amortized payment and may miss / default.
* ``CreditModel`` -- creates the borrower population and, on each ``step()``, advances every
                     borrower, records the month's cashflows, and tracks portfolio metrics.

No spatial grid is involved, so this is deliberately plain OOP (no Mesa). All numbers coming
out of the JSON-shaping helpers are cast to plain ``int``/``float`` so the Flask layer can
``jsonify`` them directly.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, asdict

import personas


# --------------------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------------------


@dataclass
class CreditParams:
    """Single source of truth for every tunable parameter.

    The field names match the ``SCENARIO_COERCE`` keys in ``server.py`` and the HTML input
    ids, so a value flows unchanged from a slider to the model.
    """

    n_borrowers: int = 60
    principal: float = 10_000.0
    loan_term_months: int = 36

    # Credit-score range the population is drawn from.
    score_min: int = 50
    score_max: int = 100

    # Risk-based pricing: annual APR at the best vs. worst score.
    apr_floor: float = 0.04
    apr_ceiling: float = 0.30

    # Monthly per-borrower probability of missing a payment (before score/economy scaling).
    base_default_prob: float = 0.03
    # How much more likely the worst-scored borrower is to miss vs. the best-scored one.
    risk_slope: float = 3.0
    max_consecutive_misses: int = 3

    seed: int = 42

    # Extra feature 1: let an LLM decide stressed borrowers' pay/miss choice.
    ai_mode: bool = False

    # Extra feature 2: an economic shock that temporarily raises default probability.
    shock_start: int = 0          # month the shock begins (0 = no scheduled shock)
    shock_duration: int = 6       # months the shock lasts
    shock_severity: float = 3.0   # default-probability multiplier during the shock


# --------------------------------------------------------------------------------------
# Lender
# --------------------------------------------------------------------------------------


class Lender:
    """Prices loans off credit scores. Lower score -> higher APR."""

    def __init__(self, params: CreditParams):
        self.params = params

    def price(self, score: float) -> float:
        """Return the annual APR charged to a borrower with the given credit score."""
        p = self.params
        span = max(p.score_max - p.score_min, 1)
        # frac = 1.0 at the worst score, 0.0 at the best score.
        frac = (p.score_max - score) / span
        frac = min(max(frac, 0.0), 1.0)
        return p.apr_floor + frac * (p.apr_ceiling - p.apr_floor)


# --------------------------------------------------------------------------------------
# Borrower agent
# --------------------------------------------------------------------------------------


def amortized_payment(principal: float, monthly_rate: float, n_months: int) -> float:
    """Constant monthly payment for a fully-amortizing loan.

    m = p * r * (1+r)^n / ((1+r)^n - 1), with the r == 0 edge case handled.
    """
    if n_months <= 0:
        return principal
    if monthly_rate <= 0:
        return principal / n_months
    growth = (1 + monthly_rate) ** n_months
    return principal * monthly_rate * growth / (growth - 1)


class Borrower:
    """One borrower agent holding its own loan state."""

    def __init__(self, borrower_id: int, credit_score: float, lender: Lender,
                 params: CreditParams):
        self.id = borrower_id
        self.credit_score = credit_score
        self.params = params

        self.apr = lender.price(credit_score)
        self.monthly_rate = self.apr / 12.0
        self.principal = params.principal
        self.term = params.loan_term_months
        self.balance = params.principal
        self.monthly_payment = amortized_payment(
            self.principal, self.monthly_rate, self.term
        )

        self.consecutive_misses = 0
        self.months_paid = 0
        self.total_paid = 0.0
        self.status = "active"          # active | paid_off | defaulted
        self.defaulted_month: int | None = None
        self.ai_reason: str | None = None

        # Set by personas.assign() in AI Borrower mode; None in the plain simulation.
        self.name: str | None = None
        self.persona: dict | None = None
        # Set once at reset by the AI profiler (0..1, higher = more likely to keep paying).
        self.reliability: float | None = None

    # -- risk -------------------------------------------------------------------------

    def miss_probability(self, economy_mult: float) -> float:
        """Per-month probability of missing, scaled by credit score and the economy.

        The worst-scored borrower is ``1 + risk_slope`` times as likely to miss as the
        best-scored one; the economy multiplier stacks on top (recession -> more misses).
        """
        p = self.params
        span = max(p.score_max - p.score_min, 1)
        frac = (p.score_max - self.credit_score) / span     # 0 (best) .. 1 (worst)
        risk = 1.0 + p.risk_slope * frac
        prob = p.base_default_prob * risk

        # A persona (AI mode) makes this borrower more/less reliable and more/less exposed
        # to the economy -- so the persona genuinely shifts the borrower's parameters.
        if self.persona:
            if self.reliability is not None:
                # The AI profiler set a reliability index at reset; map it to a miss
                # multiplier (reliability 1.0 -> 0.4x, 0.5 -> 1.1x, 0.0 -> 1.8x).
                prob *= 1.8 - 1.4 * self.reliability
            else:
                prob *= self.persona["risk_mult"]
            economy_mult = 1.0 + (economy_mult - 1.0) * self.persona["shock_mult"]

        prob *= economy_mult
        return min(max(prob, 0.0), 1.0)

    # -- one month --------------------------------------------------------------------

    def step(self, month: int, economy_mult: float, rng: random.Random,
             decision: str | None = None) -> dict | None:
        """Attempt one month's payment. Returns a cashflow event for the animation."""
        if self.status != "active":
            return None

        # Decide pay vs. miss: LLM decision if provided, else the probabilistic model.
        if decision is not None:
            paying = decision == "pay"
        else:
            paying = rng.random() >= self.miss_probability(economy_mult)

        if paying:
            interest = self.balance * self.monthly_rate
            principal_part = min(self.monthly_payment - interest, self.balance)
            # Guard against a negative principal part on tiny/edge loans.
            principal_part = max(principal_part, 0.0)
            paid = interest + principal_part
            self.balance -= principal_part
            self.total_paid += paid
            self.months_paid += 1
            self.consecutive_misses = 0

            if self.balance <= 1e-6 or self.months_paid >= self.term:
                self.balance = 0.0
                self.status = "paid_off"

            return {
                "id": self.id,
                "type": "payment",
                "amount": paid,
                "interest": interest,
                "principal_part": principal_part,
            }

        # Missed payment.
        self.consecutive_misses += 1
        if self.consecutive_misses >= self.params.max_consecutive_misses:
            self.status = "defaulted"
            self.defaulted_month = month
            loss = self.balance
            return {"id": self.id, "type": "default", "loss": loss}

        return {"id": self.id, "type": "miss"}


# --------------------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------------------


class CreditModel:
    """Creates the borrower population and steps them month by month."""

    def __init__(self, params: CreditParams | None = None, ai_profiler=None):
        self.params = params or CreditParams()
        self.rng = random.Random(self.params.seed)
        self.lender = Lender(self.params)
        # Optional callable run ONCE at reset: given the borrower list, it sets each
        # borrower's ``reliability`` (and ``ai_reason``) from their persona. Keeping the LLM
        # out of the per-step loop is what makes AI mode fast -- one call, then offline.
        self.ai_profiler = ai_profiler

        self.month = 0
        self.running = True
        # Safety horizon: loans that miss payments take longer than the nominal term to
        # complete, so we run until every loan resolves rather than cutting off at the
        # term. This cap only guards against a pathological non-terminating run.
        self.max_months = self.params.loan_term_months * 3 + 12
        self.transactions: list[dict] = []
        self.shock_windows: list[dict] = []
        if self.params.shock_start > 0:
            self.shock_windows.append(
                {"start": self.params.shock_start, "duration": self.params.shock_duration}
            )

        # Build the heterogeneous population.
        self.borrowers: list[Borrower] = []
        for i in range(self.params.n_borrowers):
            score = self.rng.uniform(self.params.score_min, self.params.score_max)
            self.borrowers.append(Borrower(i, round(score, 1), self.lender, self.params))

        # AI Borrower mode: give everyone a name + persona that shifts their behaviour, then
        # (once) let the AI profiler turn each persona into a reliability index.
        if self.params.ai_mode:
            personas.assign(self.borrowers, self.rng)
            if self.ai_profiler is not None:
                self.ai_profiler(self.borrowers)

        self.total_principal_lent = sum(b.principal for b in self.borrowers)
        # Total principal+interest that would be collected if everyone paid to term.
        self.total_scheduled = sum(
            b.monthly_payment * b.term for b in self.borrowers
        )

        # Portfolio time series (index 0 = origination, before any payments).
        self.history = {
            "months": [0],
            "outstanding": [self.total_outstanding],
            "active": [self.active_count],
            "defaulted": [0],
            "collected": [0.0],
            "loss": [0.0],
            "roi": [self.roi],
        }

    # -- economy ----------------------------------------------------------------------

    def economy_multiplier(self, month: int) -> float:
        """Default-probability multiplier for a given month (1.0 = normal times)."""
        for w in self.shock_windows:
            if w["start"] <= month < w["start"] + w["duration"]:
                return self.params.shock_severity
        return 1.0

    def trigger_shock(self) -> None:
        """Start a recession at the current month (runtime control from the UI)."""
        self.shock_windows.append(
            {"start": self.month + 1, "duration": self.params.shock_duration}
        )

    # -- one month --------------------------------------------------------------------

    def step(self) -> None:
        if not self.running:
            return

        self.month += 1
        self.transactions = []
        economy_mult = self.economy_multiplier(self.month)

        # Stepping is fully offline -- the AI already shaped each borrower's reliability at
        # reset, so no LLM calls happen here (that is what keeps AI mode fast).
        for b in self.borrowers:
            if b.status == "active":
                event = b.step(self.month, economy_mult, self.rng)
                if event is not None:
                    self.transactions.append(event)

        self._record_history()

        if self.active_count == 0 or self.month >= self.max_months:
            self.running = False

    def _record_history(self) -> None:
        self.history["months"].append(self.month)
        self.history["outstanding"].append(self.total_outstanding)
        self.history["active"].append(self.active_count)
        self.history["defaulted"].append(self.defaulted_count)
        self.history["collected"].append(self.cumulative_collected)
        self.history["loss"].append(self.cumulative_loss)
        self.history["roi"].append(self.roi)

    # -- metrics ----------------------------------------------------------------------

    @property
    def total_outstanding(self) -> float:
        return sum(b.balance for b in self.borrowers if b.status == "active")

    @property
    def active_count(self) -> int:
        return sum(1 for b in self.borrowers if b.status == "active")

    @property
    def defaulted_count(self) -> int:
        return sum(1 for b in self.borrowers if b.status == "defaulted")

    @property
    def paid_off_count(self) -> int:
        return sum(1 for b in self.borrowers if b.status == "paid_off")

    @property
    def cumulative_collected(self) -> float:
        return sum(b.total_paid for b in self.borrowers)

    @property
    def cumulative_loss(self) -> float:
        """Unrecovered principal charged off from defaulters (the money lent, not returned)."""
        return sum(b.balance for b in self.borrowers if b.status == "defaulted")

    @property
    def unrecovered_scheduled(self) -> float:
        """Principal+interest that defaulters were scheduled to pay but never did."""
        return sum(
            b.monthly_payment * b.term - b.total_paid
            for b in self.borrowers if b.status == "defaulted"
        )

    @property
    def defaulted_share(self) -> float:
        """Fraction of scheduled principal+interest never recovered due to defaults.

        Both numerator and denominator are in principal+interest terms (the amount defaulters
        still owed / the total the whole book was scheduled to pay).
        """
        if self.total_scheduled <= 0:
            return 0.0
        return self.unrecovered_scheduled / self.total_scheduled

    @property
    def roi(self) -> float:
        """Cash return: (total collected - total lent) / total lent.

        Defaults are already captured -- a defaulter simply contributes less to ``collected``
        -- so loss is *not* subtracted again. Bounded below by -100% (you cannot lose more
        than you lent).
        """
        if self.total_principal_lent <= 0:
            return 0.0
        return (self.cumulative_collected - self.total_principal_lent) / self.total_principal_lent


# --------------------------------------------------------------------------------------
# JSON-shaping helpers (keep the Flask layer thin)
# --------------------------------------------------------------------------------------


def borrower_dicts(model: CreditModel) -> list[dict]:
    out = []
    for b in model.borrowers:
        out.append({
            "id": b.id,
            "credit_score": float(b.credit_score),
            "apr": float(b.apr),
            "balance": float(b.balance),
            "principal": float(b.principal),
            "monthly_payment": float(b.monthly_payment),
            "consecutive_misses": int(b.consecutive_misses),
            "status": b.status,
            "ai_reason": b.ai_reason,
            "name": b.name,
            "persona": b.persona["title"] if b.persona else None,
            "persona_blurb": b.persona["blurb"] if b.persona else None,
            "reliability": float(b.reliability) if b.reliability is not None else None,
        })
    return out


def pricing_curve(params: CreditParams, steps: int = 26) -> list[dict]:
    """Sampled score -> APR line for the pricing chart overlay."""
    lender = Lender(params)
    pts = []
    for i in range(steps):
        score = params.score_min + (params.score_max - params.score_min) * i / (steps - 1)
        pts.append({"score": float(score), "apr": float(lender.price(score))})
    return pts


def score_rate_scatter(model: CreditModel) -> list[dict]:
    return [
        {"score": float(b.credit_score), "apr": float(b.apr), "status": b.status}
        for b in model.borrowers
    ]


def kpis(model: CreditModel) -> dict:
    return {
        "total_lent": float(model.total_principal_lent),
        "collected": float(model.cumulative_collected),
        "loss": float(model.cumulative_loss),
        "defaulted_share": float(model.defaulted_share),
        "roi": float(model.roi),
        "active": int(model.active_count),
        "defaulted": int(model.defaulted_count),
        "paid_off": int(model.paid_off_count),
    }


def state_dict(model: CreditModel) -> dict:
    """The full JSON payload the frontend renders each tick."""
    return {
        "step": int(model.month),
        "running": bool(model.running),
        "params": asdict(model.params),
        "borrowers": borrower_dicts(model),
        "vault": {
            "collected": float(model.cumulative_collected),
            "loss": float(model.cumulative_loss),
        },
        "kpis": kpis(model),
        "history": {
            "months": list(model.history["months"]),
            "outstanding": [float(v) for v in model.history["outstanding"]],
            "active": [int(v) for v in model.history["active"]],
            "defaulted": [int(v) for v in model.history["defaulted"]],
            "collected": [float(v) for v in model.history["collected"]],
            "loss": [float(v) for v in model.history["loss"]],
            "roi": [float(v) for v in model.history["roi"]],
        },
        "transactions": list(model.transactions),
        "pricing_curve": pricing_curve(model.params),
        "score_rate_scatter": score_rate_scatter(model),
        "economy": {
            "month": int(model.month),
            "multiplier": float(model.economy_multiplier(model.month)),
            "shock_windows": list(model.shock_windows),
        },
    }
