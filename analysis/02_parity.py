"""Spot-check the Python port of ar_lm_predict against the thesis's own golden file.

If the port reproduces `pred-ar-192_ext` to within rounding, the with/without-gen
comparison in 03_backtest.py is measuring the thesis's model, not a lookalike.
"""

from __future__ import annotations

import sys
import time

import numpy as np
import pandas as pd

import arx
import czdata

CALIB_DAYS = 730
LAGS = np.arange(1, 193)
GOLDEN = "pred-ar-192_ext_2025-12-08_18-04.csv"


def main(n_days: int = 10) -> None:
    df = czdata.load()
    feats = czdata.feature_block(df, ["gen", "load"], weekday=True)
    price = df["el_price"].to_numpy(dtype=float)
    idx = df.index

    golden = pd.read_csv(f"{czdata.PREDICTIONS_DIR}/{GOLDEN}", parse_dates=["date"]).set_index("date")

    rng = np.random.default_rng(0)
    test_days = pd.date_range("2020-01-01", "2024-12-31", freq="D")
    sample = sorted(rng.choice(len(test_days), size=n_days, replace=False))

    pos = pd.Series(np.arange(len(idx)), index=idx)
    out = []
    t0 = time.time()
    for k in sample:
        day = test_days[k]
        start = pos[day - pd.Timedelta(days=CALIB_DAYS)]
        end = pos[day]  # exclusive: calibration is [day-730, day-1] inclusive
        fc = arx.ar_lm_predict(
            price[start:end],
            p=LAGS,
            features=feats[start:end],
            new_features=feats[end : end + 24],
        )
        g = golden.loc[day : day + pd.Timedelta(hours=23), "pred_el_price"].to_numpy()
        out.append(
            {
                "day": day.date(),
                "port_MAE_vs_actual": arx.mae(price[end : end + 24] - fc),
                "golden_MAE_vs_actual": arx.mae(price[end : end + 24] - g),
                "max_abs_diff": float(np.max(np.abs(fc - g))),
                "mean_abs_diff": float(np.mean(np.abs(fc - g))),
            }
        )
    elapsed = time.time() - t0
    print(pd.DataFrame(out).to_string(index=False, float_format=lambda v: f"{v:.6f}"))
    print(f"\n{n_days} days in {elapsed:.1f}s -> {elapsed/n_days:.2f}s per day-fit")
    print(f"projected full 1827-day backtest: {elapsed/n_days*1827/60:.1f} min per configuration")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 10)
