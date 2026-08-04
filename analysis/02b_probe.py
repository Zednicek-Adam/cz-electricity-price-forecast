"""Which (features, d, D) configuration actually generated each golden file?

The port doesn't match `pred-ar-192_ext` exactly on a first pass, so before trusting
it, search the small configuration space and see which one lands closest.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

import arx
import czdata

CALIB_DAYS = 730
LAGS = np.arange(1, 193)

CONFIGS = {
    "gen+load+wd": (["gen", "load"], True),
    "gen+load": (["gen", "load"], False),
    "load+wd": (["load"], True),
    "wd only": ([], True),
    "none": ([], False),
}

GOLDEN_FILES = [
    "pred-ar-192_ext_2025-12-08_18-04.csv",
    "pred-ar-192_ext_diff_2025-12-14_10-58.csv",
    "pred-ar-192-AIC_sel_2025-12-01_14-56.csv",
    "pred-ar-192_custom_2025-12-08_17-27.csv",
    "pred-ar_192_diff_2025-12-08_18-39.csv",
]


def main() -> None:
    df = czdata.load()
    price = df["el_price"].to_numpy(dtype=float)
    pos = pd.Series(np.arange(len(df)), index=df.index)

    rng = np.random.default_rng(1)
    test_days = pd.date_range("2020-01-01", "2024-12-31", freq="D")
    sample = [test_days[k] for k in sorted(rng.choice(len(test_days), size=5, replace=False))]

    goldens = {
        f: pd.read_csv(f"{czdata.PREDICTIONS_DIR}/{f}", parse_dates=["date"]).set_index("date")[
            "pred_el_price"
        ]
        for f in GOLDEN_FILES
    }

    rows = []
    for cfg_name, (cols, wd) in CONFIGS.items():
        feats = czdata.feature_block(df, cols, wd)
        for d, D in [(0, 0), (1, 0), (0, 1)]:
            preds = {}
            for day in sample:
                s, e = pos[day - pd.Timedelta(days=CALIB_DAYS)], pos[day]
                preds[day] = arx.ar_lm_predict(
                    price[s:e],
                    p=LAGS,
                    d=d,
                    D=D,
                    features=None if feats is None else feats[s:e],
                    new_features=None if feats is None else feats[e : e + 24],
                )
            row = {"config": cfg_name, "d": d, "D": D}
            for f, g in goldens.items():
                diffs = [
                    np.abs(preds[day] - g.loc[day : day + pd.Timedelta(hours=23)].to_numpy())
                    for day in sample
                ]
                row[f.split("_2025")[0].replace("pred-", "")] = float(np.mean(np.concatenate(diffs)))
            rows.append(row)

    out = pd.DataFrame(rows)
    print("mean |port - golden| over 5 sampled days, EUR/MWh")
    print(out.to_string(index=False, float_format=lambda v: f"{v:.3f}"))


if __name__ == "__main__":
    main()
