"""Scores every backtest configuration and runs Diebold-Mariano tests on the pairs
that answer the ticket: does the `gen` regressor buy anything real?
"""

from __future__ import annotations

import math
import os

import numpy as np
import pandas as pd

import arx
import czdata

TEST_START = "2020-01-01"
TEST_END = "2024-12-31 23:00"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

LABELS = {
    "d0_none": "AR-192 (no exogenous)",
    "d0_gen": "AR-X: gen",
    "d0_load": "AR-X: load",
    "d0_genload": "AR-X: gen + load  [= thesis 'AR-X']",
    "d0_genlag24": "AR-X: gen(t-24)",
    "d0_genlag24load": "AR-X: gen(t-24) + load",
    "d1_wd": "Diff-AR-X: weekday",
    "d1_gen_wd": "Diff-AR-X: gen + weekday",
    "d1_load_wd": "Diff-AR-X: load + weekday",
    "d1_genload_wd": "Diff-AR-X: gen + load + weekday  [= thesis 'Diff-AR-X']",
}

# (with-gen, without-gen) pairs — the isolated effect of the unavailable regressor
DM_PAIRS = [
    # does `gen` buy anything, holding everything else fixed?
    ("d0_genload", "d0_load"),
    ("d0_gen", "d0_none"),
    ("d1_genload_wd", "d1_load_wd"),
    ("d1_gen_wd", "d1_wd"),
    # does `load` — the regressor that *is* available at forecast time — buy anything?
    ("d0_load", "d0_none"),
    ("d1_load_wd", "d1_wd"),
    # the whole exogenous block
    ("d0_genload", "d0_none"),
    # substitute: yesterday's generation forecast instead of tomorrow's
    ("d0_genlag24load", "d0_genload"),
    ("d0_genlag24load", "d0_load"),
    ("d0_genlag24load", "d0_none"),
]


def dm_test(err_a: np.ndarray, err_b: np.ndarray) -> tuple[float, float]:
    """Multivariate Diebold-Mariano on daily MAE loss differentials (Lago et al. 2021).

    H0: equal accuracy. One-sided alternative: A is more accurate than B.
    Returns (statistic, p-value); a small p-value means A really is better.
    """
    la = np.abs(err_a).reshape(-1, 24).mean(axis=1)
    lb = np.abs(err_b).reshape(-1, 24).mean(axis=1)
    d = la - lb
    n = len(d)
    stat = d.mean() / math.sqrt(d.var(ddof=1) / n)
    p = 0.5 * math.erfc(-stat / math.sqrt(2))  # P(Z <= stat)
    return stat, p


def main() -> None:
    df = czdata.load()
    actual = df.loc[TEST_START:TEST_END, "el_price"].to_numpy(dtype=float)
    idx = df.loc[TEST_START:TEST_END].index
    naive1 = df["el_price"].shift(24).loc[TEST_START:TEST_END].to_numpy(dtype=float)
    years = idx.year.to_numpy()

    preds: dict[str, np.ndarray] = {}
    for name in LABELS:
        path = os.path.join(OUT_DIR, f"{name}.csv")
        if not os.path.exists(path):
            print(f"(missing {name})")
            continue
        p = pd.read_csv(path, parse_dates=["date"]).set_index("date")["pred_el_price"]
        preds[name] = p.reindex(idx).to_numpy(dtype=float)

    print("=== full test period 2020-01-01 .. 2024-12-31 (43 848 hours) ===")
    rows = []
    for name, f in preds.items():
        e = actual - f
        rows.append(
            {
                "config": LABELS[name],
                "MAE": arx.mae(e),
                "RMSE": arx.rmse(e),
                "sMAPE": arx.smape(actual, f),
                "rMAE": arx.rmae(actual, f, naive1),
            }
        )
    table = pd.DataFrame(rows).sort_values("MAE")
    print(table.to_string(index=False, float_format=lambda v: f"{v:.4f}"))
    print()

    print("=== MAE by year ===")
    per_year = pd.DataFrame(
        {
            LABELS[n]: [arx.mae((actual - f)[years == y]) for y in sorted(set(years))]
            for n, f in preds.items()
        },
        index=sorted(set(years)),
    ).T
    print(per_year.to_string(float_format=lambda v: f"{v:.3f}"))
    print()

    print("=== Diebold-Mariano: is the first config genuinely more accurate? ===")
    print("(daily MAE loss differential; p < 0.05 => the gain is real, not noise)")
    for a, b in DM_PAIRS:
        if a not in preds or b not in preds:
            continue
        ea, eb = actual - preds[a], actual - preds[b]
        stat, p = dm_test(ea, eb)
        delta = arx.mae(ea) - arx.mae(eb)
        verdict = (
            "A better (p<0.05)"
            if p < 0.05
            else "B better (p<0.05)"
            if p > 0.95
            else "no difference"
        )
        print(
            f"  {LABELS[a]:<52} vs {LABELS[b]:<40} "
            f"dMAE={delta:+.4f}  DM={stat:+.3f}  p={p:.4f}  {verdict}"
        )
    print()

    print("=== cost of dropping `gen`, headline framing ===")
    for with_gen, without_gen in [("d0_genload", "d0_load"), ("d1_genload_wd", "d1_load_wd")]:
        if with_gen not in preds or without_gen not in preds:
            continue
        mw = arx.mae(actual - preds[with_gen])
        mo = arx.mae(actual - preds[without_gen])
        print(
            f"  {LABELS[with_gen]}\n"
            f"    MAE with gen    = {mw:.4f} EUR/MWh\n"
            f"    MAE without gen = {mo:.4f} EUR/MWh\n"
            f"    cost of dropping gen = {mo - mw:+.4f} EUR/MWh ({(mo/mw - 1)*100:+.3f}% MAE)"
        )


if __name__ == "__main__":
    main()
