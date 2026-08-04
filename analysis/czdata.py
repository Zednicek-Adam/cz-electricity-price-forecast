"""Loads the thesis's sources/CZ.csv and builds the feature blocks."""

from __future__ import annotations

import os

import numpy as np
import pandas as pd

CZ_CSV = os.environ.get("CZ_CSV", "/tmp/epf-diploma/sources/CZ.csv")
PREDICTIONS_DIR = os.environ.get("PREDICTIONS_DIR", "/tmp/epf-diploma/predictions")


def load() -> pd.DataFrame:
    df = pd.read_csv(CZ_CSV, parse_dates=["date"])
    df = df.set_index("date").sort_index()
    # A stale generation forecast is unambiguously available at 13:00 on D-1:
    # `gen` for the same hour of D-1 published at 18:00 on D-2. Candidate substitute.
    df["gen_lag24"] = df["gen"].shift(24)
    return df


def weekday_dummies(index: pd.DatetimeIndex) -> np.ndarray:
    """Six weekday dummies (Monday dropped) — equivalent under an intercept to the
    thesis's seven `model.matrix(~ weekdays_factor - 1)` columns, one of which R's
    `lm` aliases away against the intercept."""
    dow = index.dayofweek.to_numpy()
    return np.column_stack([(dow == k).astype(float) for k in range(1, 7)])


def feature_block(df: pd.DataFrame, cols: list[str], weekday: bool) -> np.ndarray | None:
    blocks = [df[c].to_numpy(dtype=float).reshape(-1, 1) for c in cols]
    if weekday:
        blocks.append(weekday_dummies(df.index))
    if not blocks:
        return None
    return np.hstack(blocks)
