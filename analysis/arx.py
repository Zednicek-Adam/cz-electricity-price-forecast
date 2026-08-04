"""Python port of the thesis's `ar_lm_predict` (predict.R) plus its metrics.

Throwaway analysis code for wayfinder ticket #13 — measuring what dropping the
`gen` (day-ahead generation forecast) regressor costs. Not production code.

The port follows predict.R line for line:
  - optional regular differencing (d) and seasonal differencing (D, lag s),
  - OLS on lags p (1..192 by default) plus contemporaneous exogenous features,
  - 24-step recursive forecast,
  - diffinv reconstruction.
"""

from __future__ import annotations

import numpy as np

HOURS_PER_DAY = 24


def _diff(x: np.ndarray, differences: int, lag: int = 1) -> np.ndarray:
    """R's stats::diff(x, differences=, lag=)."""
    for _ in range(differences):
        x = x[lag:] - x[:-lag]
    return x


def _diffinv(x: np.ndarray, differences: int, lag: int, xi: np.ndarray) -> np.ndarray:
    """R's stats::diffinv(x, differences=, lag=, xi=).

    Inverts `differences` rounds of lag-`lag` differencing. `xi` holds the
    `lag * differences` initial values, ordered as in R.
    """
    for k in range(differences):
        # invert one round; the seed for this round is the tail of xi
        seed = xi[(differences - 1 - k) * lag : (differences - k) * lag]
        out = np.empty(len(x) + lag, dtype=float)
        out[:lag] = seed
        for i in range(len(x)):
            out[i + lag] = out[i] + x[i]
        x = out
    return x


def _lag_matrix(y: np.ndarray, lags: np.ndarray) -> np.ndarray:
    """Columns y[t-lag] for each lag, rows aligned to t = 0..len(y)-1, NaN where undefined."""
    n = len(y)
    out = np.full((n, len(lags)), np.nan)
    for j, L in enumerate(lags):
        out[L:, j] = y[: n - L]
    return out


def _ols(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Least squares via QR — the same factorisation R's `lm` uses, and roughly an
    order of magnitude cheaper than numpy's SVD-based `lstsq` at this shape
    (~17 300 x 199), which matters across ~18 000 refits."""
    Q, R = np.linalg.qr(X, mode="reduced")
    return np.linalg.solve(R, Q.T @ y)


def ar_lm_predict(
    data: np.ndarray,
    p: np.ndarray,
    d: int = 0,
    D: int = 0,
    s: int = 168,
    h: int = HOURS_PER_DAY,
    features: np.ndarray | None = None,
    new_features: np.ndarray | None = None,
) -> np.ndarray:
    """Port of ar_lm_predict. `features` is (len(data), k); `new_features` is (h, k)."""
    work = np.asarray(data, dtype=float)
    has_xreg = features is not None

    rows_lost_d = 0
    rows_lost_D = 0

    xi_d = None
    if d > 0:
        xi_d = work[:d].copy()
        work = _diff(work, differences=d)
        rows_lost_d = d

    xi_D = None
    if D > 0:
        xi_D = work[: s * D].copy()
        work = _diff(work, differences=D, lag=s)
        rows_lost_D = s * D

    ts_data = work

    features_train = None
    if has_xreg:
        features_train = np.asarray(features, dtype=float)[rows_lost_d + rows_lost_D :]

    lag_cols = _lag_matrix(ts_data, p)
    blocks = [np.ones((len(ts_data), 1)), lag_cols]
    if has_xreg:
        blocks.append(features_train)
    X = np.hstack(blocks)

    keep = ~np.isnan(X).any(axis=1)
    coef = _ols(X[keep], ts_data[keep])

    hist = list(ts_data)
    preds = np.empty(h)
    for i in range(h):
        row = [1.0]
        row.extend(hist[len(hist) - L] for L in p)
        if has_xreg:
            row.extend(np.asarray(new_features, dtype=float)[i])
        yhat = float(np.dot(coef, row))
        preds[i] = yhat
        hist.append(yhat)

    full = np.concatenate([ts_data, preds])
    if D > 0:
        full = _diffinv(full, differences=D, lag=s, xi=xi_D)
    if d > 0:
        full = _diffinv(full, differences=d, lag=1, xi=xi_d)

    return full[-h:]


# --- metrics, matching predict.R ------------------------------------------------


def mae(err: np.ndarray) -> float:
    return float(np.mean(np.abs(err)))


def rmse(err: np.ndarray) -> float:
    return float(np.sqrt(np.mean(err**2)))


def smape(actual: np.ndarray, forecast: np.ndarray) -> float:
    denom = np.abs(actual) + np.abs(forecast)
    ratio = np.abs(actual - forecast) / denom
    ratio[np.isnan(ratio)] = 0.0
    return float(np.mean(ratio) * 200)


def rmae(actual: np.ndarray, forecast: np.ndarray, naive: np.ndarray) -> float:
    return mae(actual - forecast) / mae(actual - naive)
