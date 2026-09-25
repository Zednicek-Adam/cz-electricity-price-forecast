"""AR-168's structural tests (ADR-0003, ADR-0010).

Structural only, deliberately: there is no comparison with the thesis's
predictions, no sampled day and no metric band. What is tested is that the port
is an autoregression on 168 lags of the differenced series, forecast
recursively and integrated back to levels. Interface conformance and purity are
covered with the rest of the roster in test_models.py and test_purity.py.
"""

import numpy as np
import pandas as pd

from forecast.models.ar168 import AR168, LAGS, diffinv, fit_ar, recurse

CALIBRATION_HOURS = AR168.history_days * 24


def simulate_ar(
    intercept: float, coefficients: dict[int, float], n: int, seed: int = 0
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    lags = max(coefficients)
    series = np.zeros(n + lags)
    for t in range(lags, n + lags):
        series[t] = (
            intercept
            + sum(phi * series[t - k] for k, phi in coefficients.items())
            + rng.normal()
        )
    return series[lags:]


def test_a_synthetic_pure_ar_series_recovers_its_coefficients() -> None:
    truth = {1: 0.4, 24: 0.3, 168: -0.2}
    series = simulate_ar(0.5, truth, n=CALIBRATION_HOURS)

    intercept, coefficients = fit_ar(series, LAGS)

    expected = np.zeros(LAGS)
    for k, phi in truth.items():
        expected[k - 1] = phi
    assert len(coefficients) == LAGS
    np.testing.assert_allclose(coefficients, expected, atol=0.03)
    assert abs(intercept - 0.5) < 0.1


def test_diffinv_round_trips_the_first_difference() -> None:
    levels = np.array([10.0, 12.5, -3.0, -3.0, 40.25, 7.0])

    np.testing.assert_allclose(diffinv(np.diff(levels), levels[0]), levels)


def test_the_recursion_feeds_each_step_into_the_next() -> None:
    # x[t] = 1 + 0.5 x[t-1], starting from 0: 1, 1.5, 1.75, ... = 2 - 2^(1-k).
    coefficients = np.zeros(LAGS)
    coefficients[0] = 0.5
    history = np.zeros(LAGS)

    steps = recurse(history, 1.0, coefficients, 24)

    np.testing.assert_allclose(steps, [2 - 2.0 ** (1 - k) for k in range(1, 25)])


def test_the_forecast_is_24_levels_continuing_from_the_last_price() -> None:
    # A price that rises by exactly 1 every hour: the differences are all 1, so
    # every fitted model predicts differences of 1 and the levels carry on.
    index = pd.date_range("2018-01-01", periods=CALIBRATION_HOURS, freq="h")
    history = pd.Series(np.arange(len(index), dtype="float64"), index=index)

    forecast = AR168().forecast(history, index[-1].date())

    np.testing.assert_allclose(forecast, len(index) + np.arange(24), atol=1e-6)
