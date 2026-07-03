"""Shared single-run logic for the credit-risk sensitivity analysis.

Used by both the standalone CLI script (``sensitivity_analysis.py``) and the dashboard's
``/api/sensitivity`` endpoint (``server.py``). Kept as a top-level, picklable function since
both callers run it via ``ProcessPoolExecutor``. AI mode is never used here -- sweeps must be
fast and deterministic.
"""

from model import CreditModel, CreditParams

# The outcome metrics every run reports (also the metric keys the dashboard can toggle).
METRIC_KEYS = ("defaulted_share", "roi", "default_rate")


def run_one_simulation(replication, **scenario):
    """Run one full credit-risk simulation to completion and report portfolio outcomes.

    ``replication`` seeds the run (Monte-Carlo repetition). Every other keyword is a scenario
    parameter passed straight through to ``CreditParams`` (this is what lets the caller sweep
    *any* parameter, not a fixed pair).
    """
    scenario.pop("ai_mode", None)
    scenario.pop("seed", None)

    params = CreditParams(ai_mode=False, seed=1000 + int(replication), **scenario)
    model = CreditModel(params)
    while model.running:
        model.step()

    n = params.n_borrowers or 1
    result = dict(scenario)                      # echo the swept parameters back
    result["replication"] = int(replication)
    result["steps_run"] = int(model.month)
    result["defaulted_share"] = float(model.defaulted_share)  # P+I never recovered / scheduled
    result["roi"] = float(model.roi)                          # (collected - lent) / lent
    result["default_rate"] = float(model.defaulted_count / n) # fraction of borrowers defaulting
    return result


def run_one_simulation_kwargs(kwargs):
    return run_one_simulation(**kwargs)
