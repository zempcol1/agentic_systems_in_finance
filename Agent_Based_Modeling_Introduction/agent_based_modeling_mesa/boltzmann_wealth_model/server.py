"""Flask backend exposing the Boltzmann wealth model to a hand-built JS/D3 frontend.

Mirrors the structure of the sibling ``schelling_segregation_model`` and
``wolf_sheep_predator_model`` apps: a single global model guarded by a lock,
``/api/reset|step|state`` for the live simulation, and ``/api/sensitivity`` for a
parallel parameter sweep.
"""

import itertools
import threading
import time
from concurrent.futures import ProcessPoolExecutor

import pandas as pd
from flask import Flask, jsonify, request

from model import (
    BoltzmannGame,
    GameScenario,
    lorenz_points,
    wealth_histogram,
)
from sensitivity_core import run_one_simulation_kwargs

app = Flask(__name__, static_folder="static", static_url_path="")

_lock = threading.Lock()
_model: BoltzmannGame | None = None

MAX_SENSITIVITY_RUNS = 4000

# Scenario parameters accepted from the client, with the coercion applied to each.
SCENARIO_COERCE = {
    "n": int,
    "width": int,
    "height": int,
    "initial_wealth": int,
    "space_mode": str,
    "interaction_radius": float,
    "step_size": float,
    "exchange_rule": str,
    "give_fraction": float,
    "saving_lambda": float,
    "tax_rate": float,
}


def _agent_dicts():
    agents = []
    for agent in _model.agents:
        x, y = agent.locate()
        agents.append({"id": agent.unique_id, "x": x, "y": y, "wealth": agent.wealth})
    return agents


def _state():
    df = _model.datacollector.get_model_vars_dataframe().reset_index(drop=True)
    wealths = [agent.wealth for agent in _model.agents]
    total = sum(wealths)
    n = len(wealths)
    return {
        "step": len(df) - 1,
        "width": _model.width,
        "height": _model.height,
        "space_mode": _model.space_mode,
        "running": _model.running,
        "agents": _agent_dicts(),
        "gini": float(_model.gini),
        "max_wealth": int(max(wealths)) if wealths else 0,
        "mean_wealth": (total / n) if n else 0.0,
        "history": {
            "steps": list(range(len(df))),
            "gini": [float(v) for v in df["Gini"]],
        },
        "lorenz": lorenz_points(wealths),
        "histogram": wealth_histogram(wealths),
        "transactions": list(_model.transactions),
    }


@app.route("/api/reset", methods=["POST"])
def reset():
    global _model
    params = request.get_json(silent=True) or {}
    scenario_kwargs = {
        k: SCENARIO_COERCE[k](v) for k, v in params.items() if k in SCENARIO_COERCE
    }
    with _lock:
        _model = BoltzmannGame(scenario=GameScenario(**scenario_kwargs))
        return jsonify(_state())


@app.route("/api/step", methods=["POST"])
def step():
    n = request.args.get("n", default=1, type=int)
    with _lock:
        if _model is None:
            return jsonify({"error": "Model not initialized, call /api/reset first"}), 400
        for _ in range(n):
            if not _model.running:
                break
            _model.step()
        return jsonify(_state())


@app.route("/api/state", methods=["GET"])
def state():
    with _lock:
        if _model is None:
            return jsonify({"error": "Model not initialized, call /api/reset first"}), 400
        return jsonify(_state())


def _axis_values(spec):
    lo, hi, step = float(spec["min"]), float(spec["max"]), float(spec["step"])
    values = []
    n = 0
    v = lo
    while v <= hi + 1e-9:
        values.append(int(round(v)))
        n += 1
        v = lo + n * step
    return values


def _json_metric_matrix(table):
    return [
        [None if pd.isna(value) else float(value) for value in row]
        for row in table.values.tolist()
    ]


@app.route("/api/sensitivity", methods=["POST"])
def sensitivity():
    body = request.get_json(silent=True) or {}

    n_values = _axis_values(body.get("n", {}))
    grid_values = _axis_values(body.get("grid_size", {}))
    replications = int(body.get("replications", 5))
    n_steps = int(body.get("steps", 100))

    # Non-swept parameters held fixed across the whole sweep (rule, space, tax).
    fixed = body.get("fixed_params") or {}
    extra = {
        k: SCENARIO_COERCE[k](fixed[k])
        for k in ("space_mode", "exchange_rule", "tax_rate", "give_fraction",
                  "saving_lambda", "interaction_radius", "step_size")
        if k in fixed
    }

    total_runs = len(n_values) * len(grid_values) * replications
    if total_runs == 0:
        return jsonify({"error": "Parameter ranges produced an empty grid"}), 400
    if total_runs > MAX_SENSITIVITY_RUNS:
        return jsonify(
            {
                "error": f"Requested {total_runs} runs, which exceeds the limit of "
                f"{MAX_SENSITIVITY_RUNS}. Reduce the ranges, replications, or steps."
            }
        ), 400

    runs = [
        {
            "n": n,
            "grid_size": g,
            "replication": rep,
            "n_steps": n_steps,
            **extra,
        }
        for n, g in itertools.product(n_values, grid_values)
        for rep in range(replications)
    ]

    start = time.perf_counter()
    try:
        with ProcessPoolExecutor() as executor:
            results = list(executor.map(run_one_simulation_kwargs, runs))
    except Exception as exc:
        return jsonify({"error": f"Sensitivity analysis failed: {exc}"}), 500
    elapsed = time.perf_counter() - start

    df = pd.DataFrame(results)
    summary = df.groupby(["n", "grid_size"]).agg(
        mean_final_gini=("final_gini", "mean"),
        mean_max_wealth=("final_max_wealth", "mean"),
    )

    metrics = {}
    for metric in ("mean_final_gini", "mean_max_wealth"):
        table = summary[metric].unstack().reindex(index=n_values, columns=grid_values)
        metrics[metric] = _json_metric_matrix(table)

    return jsonify(
        {
            "n_values": n_values,
            "grid_values": grid_values,
            "metrics": metrics,
            "n_runs": total_runs,
            "elapsed_seconds": round(elapsed, 1),
        }
    )


@app.route("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(port=8002, debug=True, threaded=True, use_reloader=False)
