"""Same model as `arx.ar_lm_predict`, restructured so a 1 827-day backtest is minutes
rather than an hour and a half.

Two observations make it much cheaper without changing the model:

1. Differencing and lagging are *local* operations, so the design matrix is
   window-independent — each day's calibration set is a contiguous row block of one
   global matrix. `arx` rebuilds a 17 500 x 199 matrix per day; here it's a view.
2. The 199-column normal equations solved by Cholesky read the design matrix once,
   where a QR reads it several times. At this shape the run is bandwidth-bound, so
   that is the dominant saving.

`06_validate_fast.py` checks this against `arx` and against the thesis's golden files.
"""

from __future__ import annotations

import numpy as np

from arx import _diff, _diffinv


class GlobalDesign:
    """Precomputed global design matrix for one (features, d, D) configuration."""

    def __init__(
        self,
        price: np.ndarray,
        features: np.ndarray | None,
        p: np.ndarray,
        d: int = 0,
        D: int = 0,
        s: int = 168,
    ) -> None:
        self.price = np.asarray(price, dtype=float)
        self.p = np.asarray(p, dtype=int)
        self.maxlag = int(self.p.max())
        self.d, self.D, self.s = d, D, s
        self.off = d + s * D

        # d-differenced series (needed for the seasonal xi), then D-differenced
        self.dy = _diff(self.price, differences=d) if d > 0 else self.price
        z = _diff(self.dy, differences=D, lag=s) if D > 0 else self.dy
        self.z = z

        n = len(z)
        k_feat = 0 if features is None else features.shape[1]
        X = np.empty((n, 1 + len(self.p) + k_feat), dtype=float, order="C")
        X[:, 0] = 1.0
        for c, L in enumerate(self.p, start=1):
            X[:L, c] = np.nan
            X[L:, c] = z[: n - L]
        if features is not None:
            # design row j pairs with the feature row at original index j + off
            X[:, 1 + len(self.p) :] = np.asarray(features, dtype=float)[self.off : self.off + n]
        self.X = X

    def forecast_day(self, start: int, end: int, h: int = 24) -> np.ndarray:
        """One day's 24-hour forecast. `start`/`end` are original-series indices for the
        calibration window [start, end), exactly as `arx.ar_lm_predict` receives it."""
        off, maxlag = self.off, self.maxlag
        lo, hi = start + maxlag, end - off
        X = self.X[lo:hi]
        y = self.z[lo:hi]

        G = X.T @ X
        b = X.T @ y
        try:
            L = np.linalg.cholesky(G)
            coef = np.linalg.solve(L.T, np.linalg.solve(L, b))
        except np.linalg.LinAlgError:  # pragma: no cover - only if a window is singular
            coef = np.linalg.lstsq(X, y, rcond=None)[0]

        ts_data = self.z[start : end - off]
        hist = np.empty(len(ts_data) + h)
        hist[: len(ts_data)] = ts_data
        m = len(ts_data)

        n_lag = len(self.p)
        row = np.empty(len(coef))
        row[0] = 1.0
        preds = np.empty(h)
        for i in range(h):
            row[1 : 1 + n_lag] = hist[m + i - self.p]
            if len(coef) > 1 + n_lag:
                row[1 + n_lag :] = self.X[end - off + i, 1 + n_lag :]
            yhat = float(row @ coef)
            preds[i] = yhat
            hist[m + i] = yhat

        full = np.concatenate([ts_data, preds])
        if self.D > 0:
            full = _diffinv(full, differences=self.D, lag=self.s, xi=self.dy[start : start + self.s * self.D])
        if self.d > 0:
            full = _diffinv(full, differences=self.d, lag=1, xi=self.price[start : start + self.d])
        return full[-h:]
