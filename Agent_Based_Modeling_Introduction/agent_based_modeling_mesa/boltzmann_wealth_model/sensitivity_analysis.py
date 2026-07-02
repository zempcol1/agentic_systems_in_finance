"""Sensitivity analysis for the Boltzmann wealth model via a full-factorial
parameter sweep.

Runs every combination of N_VALUES (number of agents) x GRID_VALUES (square grid
size) for N_REPLICATIONS random seeds each (Monte Carlo replications), in
parallel across CPU cores, and reports the final Gini coefficient. No web app,
no UI -- just a CSV of results plus a console summary table.

Intuition worth checking in the output: for a fixed number of agents, a smaller
grid packs agents more densely, so they meet and trade more often -- inequality
(Gini) tends to rise. More agents on the same grid behaves similarly.
"""

import itertools
from concurrent.futures import ProcessPoolExecutor, as_completed

import pandas as pd
from tqdm import tqdm

from sensitivity_core import run_one_simulation_kwargs

N_VALUES = [50, 100, 200, 400]
GRID_VALUES = [5, 10, 15, 20]
N_REPLICATIONS = 5
N_STEPS = 100
N_WORKERS = None  # None -> use all available CPU cores
OUTPUT_CSV = "sensitivity_analysis_results.csv"


def main():
    runs = [
        {
            "n": n,
            "grid_size": g,
            "replication": rep,
            "n_steps": N_STEPS,
        }
        for n, g in itertools.product(N_VALUES, GRID_VALUES)
        for rep in range(N_REPLICATIONS)
    ]

    results = []
    with ProcessPoolExecutor(max_workers=N_WORKERS) as executor:
        futures = [executor.submit(run_one_simulation_kwargs, run) for run in runs]
        for future in tqdm(as_completed(futures), total=len(futures), desc="Sensitivity analysis"):
            results.append(future.result())

    df = pd.DataFrame(results)
    df.to_csv(OUTPUT_CSV, index=False)
    print(f"\nSaved {len(df)} runs to {OUTPUT_CSV}")

    summary = df.groupby(["n", "grid_size"]).agg(
        mean_final_gini=("final_gini", "mean"),
        mean_max_wealth=("final_max_wealth", "mean"),
    )
    pd.set_option("display.width", 120)
    print("\nMean final Gini, by number of agents (rows) x grid size (cols):")
    print(summary["mean_final_gini"].unstack().round(3))
    print("\nMean richest-agent wealth, by number of agents (rows) x grid size (cols):")
    print(summary["mean_max_wealth"].unstack().round(1))


if __name__ == "__main__":
    main()
