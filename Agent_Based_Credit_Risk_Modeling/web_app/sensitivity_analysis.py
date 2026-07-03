"""Standalone credit-risk sensitivity sweep.

Sweeps loan term x base default probability (with Monte-Carlo replications), writes the raw
results to a CSV, and prints two pivot-table summaries (mean defaulted-loan share and mean
ROI). Reuses the same ``run_one_simulation`` as the dashboard's ``/api/sensitivity`` endpoint
via ``sensitivity_core``.

Run:  python sensitivity_analysis.py
"""

import itertools
from concurrent.futures import ProcessPoolExecutor, as_completed

import pandas as pd
from tqdm import tqdm

from sensitivity_core import run_one_simulation_kwargs

# --- Sweep configuration ---------------------------------------------------------------
LOAN_TERM_VALUES = [12, 24, 36, 48, 60]
BASE_DEFAULT_PROB_VALUES = [0.01, 0.03, 0.05, 0.08, 0.12]
N_REPLICATIONS = 5
N_WORKERS = None  # None -> use all CPU cores
OUTPUT_CSV = "sensitivity_analysis_results.csv"

# Parameters held fixed across the whole sweep (dashboard defaults).
FIXED_PARAMS = {
    "n_borrowers": 60,
    "principal": 10_000.0,
}


def main():
    runs = [
        {
            "loan_term_months": term,
            "base_default_prob": prob,
            "replication": rep,
            **FIXED_PARAMS,
        }
        for term, prob in itertools.product(LOAN_TERM_VALUES, BASE_DEFAULT_PROB_VALUES)
        for rep in range(N_REPLICATIONS)
    ]

    results = []
    with ProcessPoolExecutor(max_workers=N_WORKERS) as executor:
        futures = [executor.submit(run_one_simulation_kwargs, run) for run in runs]
        for future in tqdm(as_completed(futures), total=len(futures),
                           desc="Sensitivity analysis"):
            results.append(future.result())

    df = pd.DataFrame(results)
    df.to_csv(OUTPUT_CSV, index=False)
    print(f"\nWrote {len(df)} runs to {OUTPUT_CSV}\n")

    grp = df.groupby(["loan_term_months", "base_default_prob"])
    for label, col in [
        ("Mean defaulted-loan share", "defaulted_share"),
        ("Mean ROI", "roi"),
        ("Mean default rate", "default_rate"),
    ]:
        print(f"{label} (rows = loan term, cols = base default prob):")
        print(grp[col].mean().unstack().round(3))
        print()


if __name__ == "__main__":
    main()
