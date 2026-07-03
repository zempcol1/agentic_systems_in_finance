"""Flask backend for the agent-based credit-risk dashboard.

A single global model guarded by a lock, ``/api/reset|step|state`` for the live simulation,
``/api/shock`` to inject a recession at runtime, and ``/api/sensitivity`` for a parallel
parameter sweep. Serves the hand-built D3 frontend from ``static/``.

Run:  python server.py   ->   http://localhost:8005/
"""

import itertools
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import fields

import pandas as pd
from flask import Flask, jsonify, request

import ai_borrower
from model import CreditModel, CreditParams, state_dict
from sensitivity_core import METRIC_KEYS, run_one_simulation_kwargs

app = Flask(__name__, static_folder="static", static_url_path="")

_lock = threading.Lock()
_model: CreditModel | None = None

MAX_SENSITIVITY_RUNS = 4000

# Client-supplied parameters, with the coercion applied to each. Keys match CreditParams
# fields and the HTML input ids one-to-one.
SCENARIO_COERCE = {
    "n_borrowers": int,
    "principal": float,
    "loan_term_months": int,
    "score_min": int,
    "score_max": int,
    "apr_floor": float,
    "apr_ceiling": float,
    "base_default_prob": float,
    "risk_slope": float,
    "max_consecutive_misses": int,
    "seed": int,
    "ai_mode": lambda v: bool(v) and str(v).lower() not in ("false", "0", ""),
    "shock_start": int,
    "shock_duration": int,
    "shock_severity": float,
}

_PARAM_FIELDS = {f.name for f in fields(CreditParams)}


def _coerce(params: dict) -> dict:
    return {k: SCENARIO_COERCE[k](v) for k, v in params.items() if k in SCENARIO_COERCE}


def _build_model(scenario_kwargs: dict) -> CreditModel:
    return CreditModel(
        params=CreditParams(**scenario_kwargs),
        ai_profiler=ai_borrower.profile_borrowers,
    )


@app.route("/api/reset", methods=["POST"])
def reset():
    global _model
    params = request.get_json(silent=True) or {}
    with _lock:
        _model = _build_model(_coerce(params))
        payload = state_dict(_model)
    payload["ai_status"] = ai_borrower.availability()
    return jsonify(payload)


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
        return jsonify(state_dict(_model))


@app.route("/api/state", methods=["GET"])
def state():
    with _lock:
        if _model is None:
            return jsonify({"error": "Model not initialized, call /api/reset first"}), 400
        return jsonify(state_dict(_model))


@app.route("/api/shock", methods=["POST"])
def shock():
    with _lock:
        if _model is None:
            return jsonify({"error": "Model not initialized, call /api/reset first"}), 400
        _model.trigger_shock()
        return jsonify(state_dict(_model))


# Parameters that make sensible sensitivity axes, with the cast used for their axis values.
SWEEP_PARAMS = {
    "base_default_prob": float,       # core risk driver
    "loan_term_months": int,          # exposure duration
    "apr_ceiling": float,             # how aggressively risk is priced
    "risk_slope": float,              # how strongly a low score raises miss risk
    "max_consecutive_misses": int,    # forbearance policy before charge-off
    "shock_severity": float,          # recession stress test (auto-schedules a shock)
}


def _axis_values(spec: dict, cast=float) -> list:
    lo, hi, step = float(spec["min"]), float(spec["max"]), float(spec["step"])
    if step <= 0:
        return []
    values = []
    n = 0
    v = lo
    while v <= hi + 1e-9:
        values.append(int(round(v)) if cast is int else round(v, 6))
        n += 1
        v = lo + n * step
    # de-duplicate while preserving order (int rounding can collide)
    seen = set()
    return [x for x in values if not (x in seen or seen.add(x))]


def _json_metric_matrix(table) -> list[list]:
    return [
        [None if pd.isna(value) else float(value) for value in row]
        for row in table.values.tolist()
    ]


@app.route("/api/sensitivity", methods=["POST"])
def sensitivity():
    body = request.get_json(silent=True) or {}

    x_param = body.get("x_param", "base_default_prob")
    y_param = body.get("y_param", "loan_term_months")
    if x_param not in SWEEP_PARAMS or y_param not in SWEEP_PARAMS:
        return jsonify({"error": "Unknown sweep parameter"}), 400
    if x_param == y_param:
        return jsonify({"error": "Choose two different parameters for the axes"}), 400

    x_values = _axis_values(body.get("x", {}), SWEEP_PARAMS[x_param])
    y_values = _axis_values(body.get("y", {}), SWEEP_PARAMS[y_param])
    replications = int(body.get("replications", 3))

    # Non-swept parameters held fixed across the whole sweep (AI mode is always off here).
    fixed = _coerce(body.get("fixed_params") or {})
    for k in (x_param, y_param, "ai_mode", "seed"):
        fixed.pop(k, None)
    # A shock-severity sweep only has an effect if a shock is actually scheduled.
    if "shock_severity" in (x_param, y_param) and fixed.get("shock_start", 0) <= 0:
        fixed["shock_start"] = 6

    total_runs = len(x_values) * len(y_values) * replications
    if total_runs == 0:
        return jsonify({"error": "Parameter ranges produced an empty grid"}), 400
    if total_runs > MAX_SENSITIVITY_RUNS:
        return jsonify({
            "error": f"Requested {total_runs} runs, which exceeds the limit of "
                     f"{MAX_SENSITIVITY_RUNS}. Reduce the ranges or replications."
        }), 400

    runs = [
        {"replication": rep, x_param: xv, y_param: yv, **fixed}
        for xv, yv in itertools.product(x_values, y_values)
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
    summary = df.groupby([y_param, x_param]).agg(
        defaulted_share=("defaulted_share", "mean"),
        roi=("roi", "mean"),
        default_rate=("default_rate", "mean"),
    )

    metrics = {}
    for metric in METRIC_KEYS:
        table = summary[metric].unstack().reindex(index=y_values, columns=x_values)
        metrics[metric] = _json_metric_matrix(table)

    return jsonify({
        "x_param": x_param,
        "y_param": y_param,
        "x_values": x_values,
        "y_values": y_values,
        "metrics": metrics,
        "n_runs": total_runs,
        "elapsed_seconds": round(elapsed, 1),
    })


@app.route("/")
def index():
    return app.send_static_file("index.html")


if __name__ == "__main__":
    app.run(port=8005, debug=True, threaded=True, use_reloader=False)
