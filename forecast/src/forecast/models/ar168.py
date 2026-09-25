"""AR-168: an autoregression on 168 lags of the once-differenced price series.

A hand-written port of `ar_lm_predict` from the thesis (`epf-diploma`,
`models/_utils.R`, run by `models/R/AR168.R`), with no history transplanted
(ADR-0004). Its specification is the bar, not the thesis output (ADR-0003):

* take the last 730 delivery days of history — the thesis's calibration window,
  which is what forces the replay to start 2020-01-01 against a record opening
  2018-01-01;
* difference once (`d = 1`);
* fit by ordinary least squares, with an intercept as R's `lm` has by default,
  on lags 1 to 168 of the differenced series, over every hour where all 168
  lags exist;
* forecast 24 steps recursively, each step feeding the next;
* undo the differencing (`diffinv`) from the last observed level.

It refits for every forecast run, in well under a second, so nothing about it is
a stored artifact.
"""

from datetime import date

import numpy as np
import pandas as pd
from numpy.lib.stride_tricks import sliding_window_view

LAGS = 168
STEPS = 24


def fit_ar(series: np.ndarray, lags: int) -> tuple[float, np.ndarray]:
    """OLS of `series[t]` on an intercept and `series[t - 1] .. series[t - lags]`.

    Returns the intercept and the coefficients, lag 1 first.
    """
    windows = sliding_window_view(series, lags)[:-1]  # series[t - lags : t]
    design = np.column_stack([np.ones(len(windows)), windows[:, ::-1]])
    solution, *_ = np.linalg.lstsq(design, series[lags:], rcond=None)
    return float(solution[0]), solution[1:]


def recurse(
    series: np.ndarray, intercept: float, coefficients: np.ndarray, steps: int
) -> np.ndarray:
    """Forecast `steps` values ahead, each one fed back in as a lag of the next."""
    lags = len(coefficients)
    extended = list(series[-lags:])
    for _ in range(steps):
        recent = np.array(extended[-lags:][::-1])  # lag 1 first
        extended.append(intercept + float(coefficients @ recent))
    return np.array(extended[lags:])


def diffinv(differences: np.ndarray, start: float) -> np.ndarray:
    """R's `diffinv` for `d = 1`: the levels whose first differences these are,
    beginning at `start`. Its output is one longer than its input."""
    return start + np.concatenate([[0.0], np.cumsum(differences)])


class AR168:
    slug = "ar168"
    version = "ar168-d1-lags168"
    history_days = 730

    def forecast(self, history: pd.Series, target_day: date) -> list[float]:
        levels = history.to_numpy(dtype="float64")
        differences = np.diff(levels)
        intercept, coefficients = fit_ar(differences, LAGS)
        predicted = recurse(differences, intercept, coefficients, STEPS)
        return [float(x) for x in diffinv(predicted, levels[-1])[1:]]
