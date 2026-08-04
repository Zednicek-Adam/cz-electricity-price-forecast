"""Checks `fastarx` against `arx` and against the thesis's golden files."""

from __future__ import annotations

import time

import numpy as np
import pandas as pd

import arx
import czdata
import fastarx

CALIB_DAYS = 730
LAGS = np.arange(1, 193)

CASES = {
    "gen+load, d=0": (["gen", "load"], False, 0, 0, "pred-ar-192_ext_2025-12-08_18-04.csv"),
    "none, d=0": ([], False, 0, 0, "pred-ar-192_custom_2025-12-08_17-27.csv"),
    "none, d=1": ([], False, 1, 0, "pred-ar_192_diff_2025-12-08_18-39.csv"),
    "gen+load+wd, d=1": (["gen", "load"], True, 1, 0, "pred-ar-192_ext_diff_2025-12-14_10-58.csv"),
    "gen+load, D=1": (["gen", "load"], False, 0, 1, None),
}


def main() -> None:
    df = czdata.load()
    price = df["el_price"].to_numpy(dtype=float)
    pos = pd.Series(np.arange(len(df)), index=df.index)

    rng = np.random.default_rng(7)
    test_days = pd.date_range("2020-01-01", "2024-12-31", freq="D")
    sample = [test_days[k] for k in sorted(rng.choice(len(test_days), size=5, replace=False))]

    for label, (cols, wd, d, D, golden_file) in CASES.items():
        feats = czdata.feature_block(df, cols, wd)
        gd = fastarx.GlobalDesign(price, feats, LAGS, d=d, D=D)

        max_vs_arx = 0.0
        max_vs_golden = 0.0
        t_fast = t_slow = 0.0
        golden = (
            pd.read_csv(f"{czdata.PREDICTIONS_DIR}/{golden_file}", parse_dates=["date"]).set_index(
                "date"
            )["pred_el_price"]
            if golden_file
            else None
        )

        for day in sample:
            s, e = pos[day - pd.Timedelta(days=CALIB_DAYS)], pos[day]
            t0 = time.time()
            fast = gd.forecast_day(s, e)
            t_fast += time.time() - t0
            t0 = time.time()
            slow = arx.ar_lm_predict(
                price[s:e],
                p=LAGS,
                d=d,
                D=D,
                features=None if feats is None else feats[s:e],
                new_features=None if feats is None else feats[e : e + 24],
            )
            t_slow += time.time() - t0
            max_vs_arx = max(max_vs_arx, float(np.max(np.abs(fast - slow))))
            if golden is not None:
                g = golden.loc[day : day + pd.Timedelta(hours=23)].to_numpy()
                max_vs_golden = max(max_vs_golden, float(np.max(np.abs(fast - g))))

        print(
            f"{label:<20} max|fast-arx|={max_vs_arx:.3e}  "
            f"max|fast-golden|={max_vs_golden:.3e}  "
            f"fast={t_fast/len(sample):.3f}s/day  arx={t_slow/len(sample):.3f}s/day"
        )


if __name__ == "__main__":
    main()
