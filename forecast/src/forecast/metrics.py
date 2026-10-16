"""Published metrics, the running and trailing metrics, the profiles and the
Diebold-Mariano tests.

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
from datetime import date, timedelta
from typing import NamedTuple

import numpy as np
import pandas as pd
from scipy import stats

from forecast.forecasts import StoredRun
from forecast.grid import RepairedPrice
from forecast.models.daylag import DayLagNaive

NAIVE = DayLagNaive.slug
METRICS = ("mae", "rmse", "smape", "rmae")

# The trailing window, in calendar delivery days, that the 30-day view and the
# scoreboard's "last 30 days" scope are computed over (ADR-0017).
WINDOW_DAYS = 30

# The trailing scopes the history switch offers, in calendar delivery days
# (ADR-0018): the window, and the last week.
WINDOWS = {"window": WINDOW_DAYS, "week": 7}

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

# profile -> what each scored period is grouped by, and how many buckets there
# are (ADR-0018). Every delivery day is on the repaired 24-period grid.
PROFILES = {
    "weekday": (lambda scored: scored["delivery_date"].dt.dayofweek, 7),
    "period": (lambda scored: scored["period_ordinal"] - 1, 24),
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
    rows: list[MetricRow] = []
    for scope_type, scope_start in SCOPES.items():
        pooled = _pooled(scored, scope_start(scored))
        for (model, start), figures in pooled.iterrows():
            n = int(figures["n"])
            key = (model, scope_type, start.date())
            rows += [
                MetricRow(*key, metric, float(figures[metric]), n)
                for metric in METRICS
                if not math.isnan(figures[metric])
            ]
    return rows


def profile(scored: pd.DataFrame, by: str) -> dict[str, dict[str, list[float | None]]]:
    """Each model's four metrics over the scored periods in `scored`, in each
    bucket of a profile (ADR-0018): per metric, per model, one figure per weekday from
    Monday, or per period ordinal from 1.

    A bucket pools its delivery periods exactly as a published metric's scope
    does, and its rMAE is the ratio of the model's MAE to the naïve's in the
    same bucket. `None` where a model has no scored period in a bucket, or the
    ratio is undefined.
    """
    bucket, size = PROFILES[by]
    figures: dict[str, dict[str, list[float | None]]] = {m: {} for m in METRICS}
    if scored.empty:
        return figures
    pooled = _pooled(scored, bucket(scored))
    for model, buckets in pooled.groupby(level="model"):
        buckets = buckets.droplevel("model").reindex(range(size))
        for metric in METRICS:
            figures[metric][str(model)] = [
                None if math.isnan(v) else float(v) for v in buckets[metric]
            ]
    return figures


def _pooled(scored: pd.DataFrame, bucket: pd.Series) -> pd.DataFrame:
    """Per model and bucket, the count of scored periods `n` and the four
    metrics pooled over them; rMAE is NaN where the naïve's MAE in the bucket
    is missing or zero."""
    frame = scored.assign(
        bucket=bucket,
        abs_error=scored["error"].abs(),
        squared_error=scored["error"] ** 2,
        smape_ratio=_smape_ratio(scored["observed"], scored["forecast"]),
    )
    sums = frame.groupby(["model", "bucket"]).agg(
        n=("abs_error", "size"),
        abs_sum=("abs_error", "sum"),
        squared_sum=("squared_error", "sum"),
        smape_sum=("smape_ratio", "sum"),
    )
    pooled = pd.DataFrame(
        {
            "n": sums["n"],
            "mae": sums["abs_sum"] / sums["n"],
            "rmse": np.sqrt(sums["squared_sum"] / sums["n"]),
            "smape": 200 * sums["smape_sum"] / sums["n"],
        }
    )
    models = pooled.index.get_level_values("model")
    naive = pooled.loc[NAIVE, "mae"] if NAIVE in models else pd.Series(dtype="float64")
    naive_mae = naive.reindex(pooled.index.get_level_values("bucket")).to_numpy()
    pooled["rmae"] = (pooled["mae"] / naive_mae).where(naive_mae > 0)
    return pooled


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


def _windowed(
    dates: Sequence[date], figures: Iterable[DayFigure], squared: bool, days: int
) -> list[float | None]:
    by_date = {f.delivery_date: f for f in figures}
    values: list[float | None] = []
    for day in dates:
        start = day - timedelta(days=days - 1)
        if start < dates[0]:
            values.append(None)
            continue
        total = 0.0
        count = 0
        for k in range(days):
            if (figure := by_date.get(start + timedelta(days=k))) is not None:
                total += figure.n_forecasts * (
                    figure.value**2 if squared else figure.value
                )
                count += figure.n_forecasts
        if count == 0:
            values.append(None)
        else:
            values.append(math.sqrt(total / count) if squared else total / count)
    return values


def _ratio(
    numerator: list[float | None], denominator: list[float | None]
) -> list[float | None]:
    return [
        None if value is None or not naive else value / naive
        for value, naive in zip(numerator, denominator, strict=True)
    ]


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
    return _ratio(
        _accumulate(dates, figures, squared=False),
        _accumulate(dates, naive_mae, squared=False),
    )


def trailing(
    metric: str,
    dates: Sequence[date],
    figures: Iterable[DayFigure],
    naive_mae: Iterable[DayFigure] = (),
    days: int = WINDOW_DAYS,
) -> list[float | None]:
    """The trailing metric for one model on each of `dates`: the metric over
    every delivery period in the `days` calendar delivery days ending on that
    day, pooled exactly as `running` pools, and rMAE likewise the ratio of two
    windowed MAEs.

    `None` until the window fits inside the record, so the first figure is
    already a whole window and not a few noisy days, and `None` where the
    model has no scored day in the window.
    """
    if metric != "rmae":
        return _windowed(dates, figures, metric == "rmse", days)
    return _ratio(
        _windowed(dates, figures, False, days),
        _windowed(dates, naive_mae, False, days),
    )
