"""Cheap groundwork: data sanity, gen-vs-load collinearity, golden-file metrics."""

from __future__ import annotations

import os

import numpy as np
import pandas as pd

import arx
import czdata

TEST_START = "2020-01-01"
TEST_END = "2024-12-31 23:00"


def main() -> None:
    df = czdata.load()
    print("=== data sanity ===")
    print("rows:", len(df), "range:", df.index[0], "->", df.index[-1])
    expected = pd.date_range(df.index[0], df.index[-1], freq="h")
    print("missing hours:", len(expected.difference(df.index)))
    print("NaNs:\n", df.isna().sum().to_string())
    print()

    print("=== correlation (whole 2018-2024 sample) ===")
    print(df.corr().round(4).to_string())
    print()

    print("=== is `gen` collinear with `load`? ===")
    for label, sl in [
        ("2018-2024", slice(None)),
        ("2020-2024 (test period)", slice(TEST_START, TEST_END)),
    ]:
        sub = df.loc[sl]
        # R^2 of gen ~ load + weekday dummies + intercept
        X = np.hstack(
            [
                np.ones((len(sub), 1)),
                sub["load"].to_numpy().reshape(-1, 1),
                czdata.weekday_dummies(sub.index),
            ]
        )
        y = sub["gen"].to_numpy(dtype=float)
        coef, *_ = np.linalg.lstsq(X, y, rcond=None)
        resid = y - X @ coef
        r2 = 1 - resid.var() / y.var()
        print(f"  {label}: corr(gen,load)={np.corrcoef(y, sub['load'])[0,1]:.4f}  "
              f"R2(gen ~ load + weekday)={r2:.4f}  VIF={1/(1-r2):.2f}")
    print()

    print("=== golden-file metrics over the thesis test period ===")
    actual = df.loc[TEST_START:TEST_END, "el_price"].to_numpy(dtype=float)
    idx = df.loc[TEST_START:TEST_END].index
    naive1 = df["el_price"].shift(24).loc[TEST_START:TEST_END].to_numpy(dtype=float)

    rows = []
    for fname in sorted(os.listdir(czdata.PREDICTIONS_DIR)):
        if not fname.endswith(".csv") or fname.endswith("_CW730.csv"):
            continue
        p = pd.read_csv(os.path.join(czdata.PREDICTIONS_DIR, fname), parse_dates=["date"])
        p = p.set_index("date").sort_index()
        col = [c for c in p.columns if "pred" in c][0]
        s = p[col].reindex(idx)
        if s.isna().any():
            print(f"  (skip {fname}: {int(s.isna().sum())} missing hours over test period)")
            continue
        f = s.to_numpy(dtype=float)
        rows.append(
            {
                "file": fname,
                "MAE": arx.mae(actual - f),
                "RMSE": arx.rmse(actual - f),
                "sMAPE": arx.smape(actual, f),
                "rMAE": arx.rmae(actual, f, naive1),
            }
        )
    rows.append(
        {
            "file": "NAIVE (lag-24)",
            "MAE": arx.mae(actual - naive1),
            "RMSE": arx.rmse(actual - naive1),
            "sMAPE": arx.smape(actual, naive1),
            "rMAE": 1.0,
        }
    )
    print(pd.DataFrame(rows).sort_values("MAE").to_string(index=False, float_format=lambda v: f"{v:.4f}"))


if __name__ == "__main__":
    main()
