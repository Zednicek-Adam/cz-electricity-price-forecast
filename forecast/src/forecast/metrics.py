"""Published metrics and the Diebold-Mariano tests, rebuilt whole.

Every number the scoreboard shows is computed here, once, and stored, so every
reader sees the same figure computed the same way and the request path never
recalculates (ADR-0004). `CONTEXT.md` is the definition of record for every
formula; with `e = observed - forecast` over the delivery periods in scope:

    MAE   = mean(|e|)
    RMSE  = sqrt(mean(e^2))
    SMAPE = 200 * mean(|e| / (|observed| + |forecast|)), a 0/0 ratio taken as 0
    rMAE  = MAE(model) / MAE(day-lag naïve)

Forecasts are scored against the repaired observed prices, the series the
models were fed (ADR-0002). Backtest and live forecasts are never pooled: every
figure is per `run_type`.

**The rebuild is whole** (ADR-0010). `rebuild_derived_rows` deletes every
`published_metric` and `model_comparison` row and writes them all again from the
stored forecasts, in one transaction, so the scoreboard can never describe a
forecast that no longer exists. There is no incremental path: Diebold-Mariano
rows are pairwise, so no per-model update is even well defined.
"""

import itertools
import math
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import NamedTuple

import numpy as np
import pandas as pd
import psycopg
from scipy import stats

from forecast.models.daylag import DayLagNaive

NAIVE = DayLagNaive.slug

# A delivery period on the repaired grid, as the scored frame keys it.
PERIOD = ["delivery_date", "period_ordinal", "resolution_minutes"]

# scope_type -> the first delivery day of the scope each scored period is in.
# `overall` starts at the first replayed day of the run type, the same date for
# every model, so a reader finds every model's whole-record row by one key
# (ADR-0005: 2020-01-01 for the backtest).
SCOPES = {
    "delivery_day": lambda scored: scored["delivery_date"],
    "month": lambda scored: scored["delivery_date"].dt.to_period("M").dt.start_time,
    "year": lambda scored: scored["delivery_date"].dt.to_period("Y").dt.start_time,
    "overall": lambda scored: scored.groupby("run_type")["delivery_date"].transform(
        "min"
    ),
}


class MetricRow(NamedTuple):
    model: str
    run_type: str
    scope_type: str
    scope_start: date
    metric: str
    value: float
    n_forecasts: int


class ComparisonRow(NamedTuple):
    model_a: str
    model_b: str
    run_type: str
    period_ordinal: int
    resolution_minutes: int
    dm_statistic: float
    p_value: float


@dataclass(frozen=True)
class RebuildResult:
    published_metrics: int
    model_comparisons: int


def rebuild_derived_rows(conn: psycopg.Connection) -> RebuildResult:
    """Replace every published metric and model comparison, all or nothing."""
    computed_at = datetime.now(UTC)
    with conn.transaction():
        scored = _scored_forecasts(conn)
        metric_rows = _published_metrics(scored)
        comparison_rows = _model_comparisons(scored)
        conn.execute("DELETE FROM published_metric")
        conn.execute("DELETE FROM model_comparison")
        _copy(conn, "published_metric", MetricRow, metric_rows, computed_at)
        _copy(conn, "model_comparison", ComparisonRow, comparison_rows, computed_at)
    return RebuildResult(len(metric_rows), len(comparison_rows))


def _copy(
    conn: psycopg.Connection,
    table: str,
    shape: type[NamedTuple],
    rows: Iterable[tuple],
    computed_at: datetime,
) -> None:
    columns = ", ".join([*shape._fields, "computed_at"])
    with conn.cursor().copy(f"COPY {table} ({columns}) FROM STDIN") as copy:
        for row in rows:
            copy.write_row((*row, computed_at))


def _scored_forecasts(conn: psycopg.Connection) -> pd.DataFrame:
    """Every stored forecast that has a repaired observed price to score it."""
    rows = conn.execute(
        "SELECT f.model, f.run_type, f.delivery_date, f.period_ordinal,"
        " f.resolution_minutes, r.price, f.price"
        " FROM forecast f JOIN repaired_observed_price r"
        " USING (delivery_date, period_ordinal, resolution_minutes)"
    ).fetchall()
    scored = pd.DataFrame(
        rows, columns=["model", "run_type", *PERIOD, "observed", "forecast"]
    )
    scored["delivery_date"] = pd.to_datetime(scored["delivery_date"])
    scored["observed"] = scored["observed"].astype("float64")
    scored["forecast"] = scored["forecast"].astype("float64")
    scored["error"] = scored["observed"] - scored["forecast"]
    return scored


def _published_metrics(scored: pd.DataFrame) -> list[MetricRow]:
    """All four metrics at all four scopes, per model and run type.

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
        sums = frame.groupby(["model", "run_type", "scope_start"]).agg(
            n=("abs_error", "size"),
            abs_sum=("abs_error", "sum"),
            squared_sum=("squared_error", "sum"),
            smape_sum=("smape_ratio", "sum"),
        )
        mae = sums["abs_sum"] / sums["n"]
        for (model, run_type, start), scope in sums.iterrows():
            n = int(scope["n"])
            key = (model, run_type, scope_type, start.date())
            rows.append(MetricRow(*key, "mae", mae[model, run_type, start], n))
            rows.append(MetricRow(*key, "rmse", math.sqrt(scope["squared_sum"] / n), n))
            rows.append(MetricRow(*key, "smape", 200 * scope["smape_sum"] / n, n))
            naive_mae = mae.get((NAIVE, run_type, start), 0.0)
            if naive_mae > 0:
                ratio = mae[model, run_type, start] / naive_mae
                rows.append(MetricRow(*key, "rmae", ratio, n))
    return rows


def _smape_ratio(observed: pd.Series, forecast: pd.Series) -> pd.Series:
    """|e| / (|observed| + |forecast|), with 0/0 taken as 0 (CONTEXT.md)."""
    denominator = observed.abs() + forecast.abs()
    ratio = (observed - forecast).abs() / denominator.where(denominator != 0)
    return ratio.fillna(0.0)


def _model_comparisons(scored: pd.DataFrame) -> list[ComparisonRow]:
    """Diebold-Mariano tests for every ordered model pair, per period ordinal.

    H1 is that `model_a` is more accurate than
    `model_b`, on absolute loss, so a small p-value means `model_a` wins. A test
    that fails to compute writes no row.
    """
    rows: list[ComparisonRow] = []
    for run_type, run_type_scored in scored.groupby("run_type"):
        by_model = {
            model: frame.set_index(PERIOD)["error"]
            for model, frame in run_type_scored.groupby("model")
        }
        for model_a, model_b in itertools.permutations(sorted(by_model), 2):
            pair = pd.concat(
                [by_model[model_a].rename("a"), by_model[model_b].rename("b")],
                axis=1,
                join="inner",
            ).sort_index()
            for (ordinal, resolution), bucket in pair.groupby(
                level=["period_ordinal", "resolution_minutes"]
            ):
                loss = bucket["a"].abs() - bucket["b"].abs()
                result = diebold_mariano(loss.to_numpy(), h=int(ordinal))
                if result is not None:
                    statistic, p_value = result
                    rows.append(
                        ComparisonRow(
                            model_a,
                            model_b,
                            run_type,
                            int(ordinal),
                            int(resolution),
                            statistic,
                            p_value,
                        )
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
