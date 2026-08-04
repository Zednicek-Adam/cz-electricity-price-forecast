"""Full 2020-2024 daily backtest.

Usage: python 03_backtest.py <config-name> [<config-name> ...]  |  python 03_backtest.py all
Writes out/<config-name>.csv with one row per test hour.

Uses `fastarx`, which `06_validate_fast.py` shows agrees with `arx` (and with the
thesis's golden files) to ~1e-10 EUR/MWh.
"""

from __future__ import annotations

import os
import sys
import time

import numpy as np
import pandas as pd

import czdata
import fastarx

CALIB_DAYS = 730
LAGS = np.arange(1, 193)
TEST_START = "2020-01-01"
TEST_END = "2024-12-31"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")

# name -> (exogenous columns, weekday dummies, d, D)
# The `d=0` family varies only the exogenous block against `ar-192_custom`/`_ext`,
# which the port reproduces exactly. The `d=1` family does the same against
# `ar_192_diff`/`_ext_diff` (the thesis's better-scoring "Diff-AR-X").
CONFIGS = {
    "d0_none": ([], False, 0, 0),
    "d0_gen": (["gen"], False, 0, 0),
    "d0_load": (["load"], False, 0, 0),
    "d0_genload": (["gen", "load"], False, 0, 0),
    "d1_wd": ([], True, 1, 0),
    "d1_gen_wd": (["gen"], True, 1, 0),
    "d1_load_wd": (["load"], True, 1, 0),
    "d1_genload_wd": (["gen", "load"], True, 1, 0),
    # substitute: yesterday's generation forecast, which *is* available at 13:00 D-1
    "d0_genlag24": (["gen_lag24"], False, 0, 0),
    "d0_genlag24load": (["gen_lag24", "load"], False, 0, 0),
}


def run(name: str, df: pd.DataFrame) -> None:
    cols, wd, d, D = CONFIGS[name]
    price = df["el_price"].to_numpy(dtype=float)
    feats = czdata.feature_block(df, cols, wd)
    pos = pd.Series(np.arange(len(df)), index=df.index)

    gd = fastarx.GlobalDesign(price, feats, LAGS, d=d, D=D)
    test_days = pd.date_range(TEST_START, TEST_END, freq="D")
    preds = np.empty(len(test_days) * 24)
    t0 = time.time()
    for k, day in enumerate(test_days):
        s, e = pos[day - pd.Timedelta(days=CALIB_DAYS)], pos[day]
        preds[k * 24 : (k + 1) * 24] = gd.forecast_day(s, e)
        if k % 400 == 0:
            print(f"[{name}] {k}/{len(test_days)} {time.time()-t0:.0f}s", flush=True)

    idx = pd.date_range(TEST_START, periods=len(preds), freq="h")
    os.makedirs(OUT_DIR, exist_ok=True)
    pd.DataFrame({"date": idx, "pred_el_price": preds}).to_csv(
        os.path.join(OUT_DIR, f"{name}.csv"), index=False
    )
    print(f"[{name}] done in {time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    names = list(CONFIGS) if sys.argv[1:] == ["all"] else sys.argv[1:]
    data = czdata.load()
    for n in names:
        run(n, data)
