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
from dataclasses import dataclass
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import psycopg
from scipy import stats

from forecast.models.daylag import DayLagNaive

NAIVE = DayLagNaive.slug

# scope_type -> how a delivery date maps to the first delivery day of its scope.
# `overall` starts at the first scored day of each model and run type.
SCOPES = {
    "delivery_day": lambda days: days,
    "month": lambda days: days.dt.to_period("M").dt.start_time,
    "year": lambda days: days.dt.to_period("Y").dt.start_time,
    "overall": None,
}


@dataclass(frozen=True)
class RebuildResult:
    published_metrics: int
    model_comparisons: int


def rebuild_derived_rows(conn: psycopg.Connection) -> RebuildResult:
    """Replace every published metric and model comparison, all or nothing."""
    computed_at = datetime.now(UTC)
    with conn.transaction():
        scored = _scored_forecasts(conn)
        metric_rows = published_metrics(scored)
        comparison_rows = model_comparisons(scored)
        conn.execute("DELETE FROM published_metric")
        conn.execute("DELETE FROM model_comparison")
        with conn.cursor().copy(
            "COPY published_metric (model, run_type, scope_type, scope_start,"
            " metric, value, n_forecasts, computed_at) FROM STDIN"
        ) as copy:
            for row in metric_rows:
                copy.write_row((*row, computed_at))
        with conn.cursor().copy(
            "COPY model_comparison (model_a, model_b, run_type, period_ordinal,"
            " resolution_minutes, dm_statistic, p_value, computed_at) FROM STDIN"
        ) as copy:
            for row in comparison_rows:
                copy.write_row((*row, computed_at))
    return RebuildResult(len(metric_rows), len(comparison_rows))


def _scored_forecasts(conn: psycopg.Connection) -> pd.DataFrame:
    """Every stored forecast that has a repaired observed price to score it."""
    rows = conn.execute(
        "SELECT f.model, f.run_type, f.delivery_date, f.period_ordinal,"
        " f.resolution_minutes, r.price, f.price"
        " FROM forecast f JOIN repaired_observed_price r"
        " USING (delivery_date, period_ordinal, resolution_minutes)"
    ).fetchall()
    scored = pd.DataFrame(
        rows,
        columns=[
            "model",
            "run_type",
            "delivery_date",
            "period_ordinal",
            "resolution_minutes",
            "observed",
            "forecast",
        ],
    )
    scored["delivery_date"] = pd.to_datetime(scored["delivery_date"])
    scored["observed"] = scored["observed"].astype("float64")
    scored["forecast"] = scored["forecast"].astype("float64")
    scored["error"] = scored["observed"] - scored["forecast"]
    return scored


def published_metrics(scored: pd.DataFrame) -> list[tuple]:
    """(model, run_type, scope_type, scope_start, metric, value, n_forecasts)."""
    if scored.empty:
        return []
    frame = scored.assign(
        abs_error=scored["error"].abs(),
        squared_error=scored["error"] ** 2,
        smape_ratio=_smape_ratio(scored["observed"], scored["forecast"]),
    )
    naive = frame.loc[
        frame["model"] == NAIVE,
        ["run_type", "delivery_date", "period_ordinal", "resolution_minutes"],
    ].assign(naive_abs_error=frame.loc[frame["model"] == NAIVE, "abs_error"])
    frame = frame.merge(
        naive,
        on=["run_type", "delivery_date", "period_ordinal", "resolution_minutes"],
        how="left",
    )

    rows: list[tuple] = []
    for scope_type, to_start in SCOPES.items():
        if to_start is None:
            first = frame.groupby(["model", "run_type"])["delivery_date"].transform(
                "min"
            )
            frame["scope_start"] = first
        else:
            frame["scope_start"] = to_start(frame["delivery_date"])
        keys = ["model", "run_type", "scope_start"]
        grouped = frame.groupby(keys).agg(
            n=("abs_error", "size"),
            abs_sum=("abs_error", "sum"),
            squared_sum=("squared_error", "sum"),
            smape_sum=("smape_ratio", "sum"),
        )
        benchmarked = (
            frame.dropna(subset=["naive_abs_error"])
            .groupby(keys)
            .agg(
                n=("abs_error", "size"),
                abs_sum=("abs_error", "sum"),
                naive_abs_sum=("naive_abs_error", "sum"),
            )
        )
        for (model, run_type, start), g in grouped.iterrows():
            scope = (model, run_type, scope_type, start.date())
            n = int(g["n"])
            rows.append((*scope, "mae", g["abs_sum"] / n, n))
            rows.append((*scope, "rmse", math.sqrt(g["squared_sum"] / n), n))
            rows.append((*scope, "smape", 200 * g["smape_sum"] / n, n))
        for (model, run_type, start), g in benchmarked.iterrows():
            # MAE over the periods both were scored on, so the ratio compares
            # like with like. A naïve that was exactly right on every period
            # leaves the ratio undefined, and an undefined figure is not stored.
            if g["naive_abs_sum"] > 0:
                scope = (model, run_type, scope_type, start.date())
                value = g["abs_sum"] / g["naive_abs_sum"]
                rows.append((*scope, "rmae", value, int(g["n"])))
    return rows


def _smape_ratio(observed: pd.Series, forecast: pd.Series) -> pd.Series:
    """|e| / (|observed| + |forecast|), with 0/0 taken as 0 (CONTEXT.md)."""
    denominator = observed.abs() + forecast.abs()
    ratio = (observed - forecast).abs() / denominator.where(denominator != 0)
    return ratio.fillna(0.0)


def model_comparisons(scored: pd.DataFrame) -> list[tuple]:
    """Diebold-Mariano tests for every ordered model pair, per period ordinal.

    (model_a, model_b, run_type, period_ordinal, resolution_minutes,
    dm_statistic, p_value). H1 is that `model_a` is more accurate than
    `model_b`, on absolute loss, so a small p-value means `model_a` wins. A test
    that fails to compute writes no row.
    """
    rows: list[tuple] = []
    keys = ["delivery_date", "period_ordinal", "resolution_minutes"]
    for run_type, of_run_type in scored.groupby("run_type"):
        by_model = {
            model: frame.set_index(keys)["error"]
            for model, frame in of_run_type.groupby("model")
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
                        (
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
