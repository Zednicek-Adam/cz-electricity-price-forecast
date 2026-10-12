"""Published metrics, the running metric and the Diebold-Mariano tests.

Every number the dashboard shows is computed here, once per export, so every
reader sees the same figure computed the same way and the browser never
recalculates. `CONTEXT.md` is the definition of record for every formula; with
`e = observed - forecast` over the delivery periods in scope:

    MAE   = mean(|e|)
    RMSE  = sqrt(mean(e^2))
    SMAPE = 200 * mean(|e| / (|observed| + |forecast|)), a 0/0 ratio taken as 0
    rMAE  = MAE(model) / MAE(day-lag naïve)

Forecasts are scored against the repaired observed prices, the series the
models were fed (ADR-0002). Backtest and live forecasts are pooled into one
record (ADR-0016); `run_type` stays on every forecast row as provenance.

Everything is rebuilt whole from the record on every export (ADR-0010): there
is no incremental path, and Diebold-Mariano rows are pairwise, so no per-model
update is even well defined.
"""

import itertools
import math
from collections.abc import Iterable, Sequence
from datetime import date
from typing import NamedTuple

import numpy as np
import pandas as pd
from scipy import stats

from forecast.forecasts import StoredRun
from forecast.grid import RepairedPrice
from forecast.models.daylag import DayLagNaive

NAIVE = DayLagNaive.slug
METRICS = ("mae", "rmse", "smape", "rmae")

# A delivery period on the repaired grid, as the scored frame keys it.
PERIOD = ["delivery_date", "period_ordinal"]

# scope_type -> the first delivery day of the scope each scored period is in.
# `overall` starts at the record's first scored day, the same date for every
# model, so every model's whole-record figure has one key.
SCOPES = {
    "delivery_day": lambda scored: scored["delivery_date"],
    "month": lambda scored: scored["delivery_date"].dt.to_period("M").dt.start_time,
    "year": lambda scored: scored["delivery_date"].dt.to_period("Y").dt.start_time,
    "overall": lambda scored: pd.Series(
        scored["delivery_date"].min(), index=scored.index
    ),
}


class MetricRow(NamedTuple):
    model: str
    scope_type: str
    scope_start: date
    metric: str
    value: float
    n_forecasts: int


class ComparisonRow(NamedTuple):
    model_a: str
    model_b: str
    period_ordinal: int
    dm_statistic: float
    p_value: float


def scored_forecasts(
    runs: Iterable[StoredRun], repaired: Iterable[RepairedPrice]
) -> pd.DataFrame:
    """Every forecast that has a repaired observed price to score it, one row
    per model and delivery period."""
    observed = pd.DataFrame(
        [(r.delivery_date, r.period_ordinal, float(r.price)) for r in repaired],
        columns=[*PERIOD, "observed"],
    )
    forecasts = pd.DataFrame(
        [
            (run.model, run.delivery_date, ordinal, price)
            for run in runs
            for ordinal, price in enumerate(run.prices, start=1)
        ],
        columns=["model", *PERIOD, "forecast"],
    )
    scored = forecasts.merge(observed, on=PERIOD, how="inner")
    scored["delivery_date"] = pd.to_datetime(scored["delivery_date"])
    scored["observed"] = scored["observed"].astype("float64")
    scored["forecast"] = scored["forecast"].astype("float64")
    scored["error"] = scored["observed"] - scored["forecast"]
    return scored.sort_values(["model", *PERIOD], ignore_index=True)


def published_metrics(scored: pd.DataFrame) -> list[MetricRow]:
    """All four metrics at all four scopes, per model.

    rMAE is `MAE(model) / MAE(day-lag naïve)` over the same scope, each MAE over
    its own scored periods, exactly as CONTEXT.md defines it. Where the naïve
    has no MAE in a scope, or an MAE of zero, the ratio is undefined and no
    figure is published.
    """
    if scored.empty:
        return []
    frame = scored.assign(
        abs_error=scored["error"].abs(),
        squared_error=scored["error"] ** 2,
        smape_ratio=_smape_ratio(scored["observed"], scored["forecast"]),
    )
    rows: list[MetricRow] = []
    for scope_type, scope_start in SCOPES.items():
        frame["scope_start"] = scope_start(frame)
        sums = frame.groupby(["model", "scope_start"]).agg(
            n=("abs_error", "size"),
            abs_sum=("abs_error", "sum"),
            squared_sum=("squared_error", "sum"),
            smape_sum=("smape_ratio", "sum"),
        )
        mae = sums["abs_sum"] / sums["n"]
        for (model, start), scope in sums.iterrows():
            n = int(scope["n"])
            key = (model, scope_type, start.date())
            rows.append(MetricRow(*key, "mae", mae[model, start], n))
            rows.append(MetricRow(*key, "rmse", math.sqrt(scope["squared_sum"] / n), n))
            rows.append(MetricRow(*key, "smape", 200 * scope["smape_sum"] / n, n))
            naive_mae = mae.get((NAIVE, start), 0.0)
            if naive_mae > 0:
                ratio = mae[model, start] / naive_mae
                rows.append(MetricRow(*key, "rmae", ratio, n))
    return rows


def _smape_ratio(observed: pd.Series, forecast: pd.Series) -> pd.Series:
    """|e| / (|observed| + |forecast|), with 0/0 taken as 0 (CONTEXT.md)."""
    denominator = observed.abs() + forecast.abs()
    ratio = (observed - forecast).abs() / denominator.where(denominator != 0)
    return ratio.fillna(0.0)


def model_comparisons(scored: pd.DataFrame) -> list[ComparisonRow]:
    """Diebold-Mariano tests for every ordered model pair, per period ordinal.

    H1 is that `model_a` is more accurate than
    `model_b`, on absolute loss, so a small p-value means `model_a` wins. A test
    that fails to compute writes no row.
    """
    rows: list[ComparisonRow] = []
    by_model = {
        model: frame.set_index(PERIOD)["error"]
        for model, frame in scored.groupby("model")
    }
    for model_a, model_b in itertools.permutations(sorted(by_model), 2):
        pair = pd.concat(
            [by_model[model_a].rename("a"), by_model[model_b].rename("b")],
            axis=1,
            join="inner",
        ).sort_index()
        for ordinal, bucket in pair.groupby(level="period_ordinal"):
            loss = bucket["a"].abs() - bucket["b"].abs()
            result = diebold_mariano(loss.to_numpy(), h=int(ordinal))
            if result is not None:
                statistic, p_value = result
                rows.append(
                    ComparisonRow(model_a, model_b, int(ordinal), statistic, p_value)
                )
    return rows


def diebold_mariano(
    loss_differential: np.ndarray, h: int
) -> tuple[float, float] | None:
    """R's `forecast::dm.test(e1, e2, alternative = "less", h, power = 1)`.

    `loss_differential` is |e1| - |e2| in date order. The variance comes from
    the autocovariances up to lag h - 1, with the Harvey-Leybourne-Newbold
    small-sample correction; the p-value is one-sided, from a t distribution
    with n - 1 degrees of freedom. As in R, a non-positive variance retries at
    h = 1, and a zero variance at h = 1 fails. Failure returns None.

    `h` is the bucket's period ordinal, following the thesis (ADR-0005).
    """
    d = np.asarray(loss_differential, dtype="float64")
    n = len(d)
    if n < 2 or h > n:
        return None
    centred = d - d.mean()
    autocovariance = [float(centred[: n - k] @ centred[k:]) / n for k in range(h)]
    variance = (autocovariance[0] + 2 * sum(autocovariance[1:])) / n
    if variance <= 0:
        return None if h == 1 else diebold_mariano(d, h=1)
    correction = (n + 1 - 2 * h + h * (h - 1) / n) / n
    if correction <= 0:
        return None
    statistic = d.mean() / math.sqrt(variance) * math.sqrt(correction)
    p_value = float(stats.t.cdf(statistic, df=n - 1))
    if not (math.isfinite(statistic) and math.isfinite(p_value)):
        return None
    return float(statistic), p_value


class DayFigure(NamedTuple):
    """One model's published metric for one delivery day."""

    delivery_date: date
    value: float
    n_forecasts: int


def _accumulate(
    dates: Sequence[date], figures: Iterable[DayFigure], squared: bool
) -> list[float | None]:
    by_date = {f.delivery_date: f for f in figures}
    total = 0.0
    count = 0
    values: list[float | None] = []
    for day in dates:
        if (figure := by_date.get(day)) is not None:
            value = figure.value**2 if squared else figure.value
            total += figure.n_forecasts * value
            count += figure.n_forecasts
        if count == 0:
            values.append(None)
        else:
            values.append(math.sqrt(total / count) if squared else total / count)
    return values


def running(
    metric: str,
    dates: Sequence[date],
    figures: Iterable[DayFigure],
    naive_mae: Iterable[DayFigure] = (),
) -> list[float | None]:
    """The running metric for one model on each of `dates`: a cumulative sum
    over a cumulative count of delivery periods, never a running mean of
    per-day figures. Each per-day figure is weighted by its own `n_forecasts`,
    which turns it back into the day's sum exactly:

        mae, smape   carry n * value      running = sum(n * value) / sum(n)
        rmse         carry n * value^2    running = sqrt(sum(n * value^2) / sum(n))
        rmae         the model's running MAE over the naive's

    For rMAE, `figures` are the model's per-day MAEs and `naive_mae` the
    naive's: the ratio of two running MAEs, not a running mean of per-day
    ratios, which one near-flat naive day would drag for the rest of the record.
    `None` until the model's first day.
    """
    if metric != "rmae":
        return _accumulate(dates, figures, squared=metric == "rmse")
    numerator = _accumulate(dates, figures, squared=False)
    denominator = _accumulate(dates, naive_mae, squared=False)
    return [
        None if value is None or not naive else value / naive
        for value, naive in zip(numerator, denominator, strict=True)
    ]
