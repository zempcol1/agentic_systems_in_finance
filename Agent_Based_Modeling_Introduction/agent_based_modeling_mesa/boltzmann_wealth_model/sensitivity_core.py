"""Shared simulation-run logic for the Boltzmann wealth sensitivity analysis.

Used by both the standalone CLI script (``sensitivity_analysis.py``) and the web
dashboard's ``/api/sensitivity`` endpoint (``server.py``). Kept as a top-level,
picklable function since both callers run it via ``ProcessPoolExecutor``.
"""

from model import BoltzmannGame, GameScenario


def run_one_simulation(n, grid_size, replication, n_steps, **scenario_overrides):
    """Run one Boltzmann simulation and report inequality at the end.

    ``grid_size`` sets both width and height (a square grid). Extra keyword
    arguments (e.g. ``space_mode``, ``exchange_rule``, ``tax_rate``) are passed
    straight through to the scenario, defaulting to the classic model. Returns the
    final Gini coefficient and the richest agent's wealth after ``n_steps`` steps.
    """
    model = BoltzmannGame(
        scenario=GameScenario(
            n=n, width=grid_size, height=grid_size, **scenario_overrides
        )
    )

    for _ in range(n_steps):
        model.step()

    wealths = [agent.wealth for agent in model.agents]

    return {
        "n": n,
        "grid_size": grid_size,
        "replication": replication,
        "steps_run": n_steps,
        "final_gini": float(model.gini),
        "final_max_wealth": int(max(wealths)) if wealths else 0,
    }


def run_one_simulation_kwargs(kwargs):
    return run_one_simulation(**kwargs)
