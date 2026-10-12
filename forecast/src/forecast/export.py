"""The export: both records in, the one file the dashboard reads out (ADR-0016).

    uv run python -m forecast.export [--out ../web/public/dashboard.json]

It reads `data/cz-day-ahead-prices.csv` and `data/forecasts.csv`, repairs the
grid, computes every published metric, the running and trailing metrics, the
profiles and the Diebold-Mariano tests, and writes them into `dashboard.json`:

    record       the first and last delivery day, and the pending day
    models       the models in the record, in the order the dashboard lists them
    days         per delivery day: the observed prices (null while pending),
                 each model's 24 forecasts and its four metrics for the day
    running      the scored delivery days, and per metric each model's running
                 figure on them
    trailing     per window scope, `window` and `week`, per metric, each
                 model's figure over the 30 or 7 delivery days ending on each
                 of those days (null until a whole window fits)
    window       the last 30 delivery days that have been scored
    week         the last 7 delivery days that have been scored
    profiles     per scope, the `whole` record, the last 30 days (`window`) and
                 the last 7 (`week`), per profile, `weekday` and `period`, per
                 metric, each model's figure on each weekday from Monday, or at
                 each period ordinal
    accuracy     per scope as for profiles, each model's four metrics
    comparisons  per scope, `whole` and `window` only, per model and opponent,
                 the Diebold-Mariano statistic by period ordinal (null where it
                 could not be computed)

Its shape is `Dashboard` in `web/src/types.ts`. Forecasts are rounded to the
cent and figures to six significant digits: finer than anything on screen, and
every figure is computed before rounding. The file is rebuilt whole on every
deploy, so the dashboard can never describe a forecast the record no longer
holds (ADR-0010).

Before it writes, it checks the record and stops on the first failure:

* every model is on the roster, and has a forecast run on every delivery day
  of the 2020-01-01 to 2024-12-31 backtest;
* at most one delivery day has forecasts but no published price: the pending
  forecast (CONTEXT.md);
* the day-lag naïve's own overall rMAE reads exactly 1.000.
"""

import argparse
import json
import logging
import sys
from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

from forecast.forecasts import FORECASTS, StoredRun, read_forecasts
from forecast.loader import PRICES, REPO_ROOT, repaired_prices
from forecast.metrics import (
    METRICS,
    NAIVE,
    PROFILES,
    WINDOWS,
    DayFigure,
    model_comparisons,
    profile,
    published_metrics,
    running,
    scored_forecasts,
    trailing,
)
from forecast.models import ROSTER

log = logging.getLogger("forecast.export")

OUT = REPO_ROOT / "web" / "public" / "dashboard.json"

# The roster in the order the dashboard lists it (ADR-0003).
DISPLAY_ORDER = ("chronos2", "ar168", "daylag")

# The replayed backtest every model must cover in full (ADR-0002).
BACKTEST_FROM = date(2020, 1, 1)
BACKTEST_TO = date(2024, 12, 31)


class RecordInvalid(AssertionError):
    """The records are not what the dashboard may be built from."""


def check(condition: bool, message: str) -> None:
    if not condition:
        raise RecordInvalid(message)
    log.info("ok  %s", message)


def days_between(first: date, last: date) -> list[date]:
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def by_display_order(models: Iterable[str]) -> list[str]:
    return sorted(models, key=DISPLAY_ORDER.index)


def figure(value: float | None) -> float | None:
    """A computed figure, to six significant digits."""
    return None if value is None else float(f"{value:.6g}")


def export(
    out: Path = OUT,
    *,
    prices_path: Path = PRICES,
    forecasts_path: Path = FORECASTS,
) -> dict[str, Any]:
    """Check the records and write the dashboard's file. Returns its content."""
    repaired = repaired_prices(prices_path)
    runs = read_forecasts(forecasts_path)
    check(len(runs) > 0, f"{len(runs)} forecast runs")

    observed: dict[date, list[float]] = defaultdict(list)
    for r in repaired:
        observed[r.delivery_date].append(float(r.price))
    forecasts: dict[date, dict[str, StoredRun]] = defaultdict(dict)
    for run in runs:
        forecasts[run.delivery_date][run.model] = run

    models = by_display_order({run.model for run in runs})
    check(set(models) <= set(ROSTER), f"every model is on the roster: {models}")
    for model in models:
        missing = [
            d
            for d in days_between(BACKTEST_FROM, BACKTEST_TO)
            if model not in forecasts[d]
        ]
        check(
            not missing,
            f"{model}: a forecast run on every delivery day"
            f" {BACKTEST_FROM} to {BACKTEST_TO}",
        )
    pending = sorted(d for d in forecasts if d not in observed)
    check(len(pending) <= 1, f"{len(pending)} pending forecast(s): {pending}")

    scored = scored_forecasts(runs, repaired)
    metric_rows = published_metrics(scored)

    # (model, metric) -> per-day figures, in delivery-day order.
    per_day: dict[tuple[str, str], list[DayFigure]] = defaultdict(list)
    # delivery date -> model -> metric -> value
    day_metrics: dict[date, dict[str, dict[str, float]]] = defaultdict(
        lambda: defaultdict(dict)
    )
    overall: dict[str, dict[str, float]] = defaultdict(dict)
    for r in metric_rows:
        if r.scope_type == "delivery_day":
            per_day[r.model, r.metric].append(
                DayFigure(r.scope_start, r.value, r.n_forecasts)
            )
            day_metrics[r.scope_start][r.model][r.metric] = r.value
        elif r.scope_type == "overall":
            overall[r.model][r.metric] = r.value
    for figures in per_day.values():
        figures.sort()

    reads = f"{overall[NAIVE].get('rmae', float('nan')):.3f}"
    check(reads == "1.000", f"{NAIVE}: overall rMAE reads {reads}")

    def metrics_of(by_metric: dict[str, float]) -> dict[str, float | None]:
        return {m: figure(by_metric.get(m)) for m in METRICS}

    first, last = min(forecasts), max(forecasts)
    days = {
        day.isoformat(): {
            "observed": observed.get(day),
            "forecasts": {
                m: [round(p, 2) for p in forecasts[day][m].prices]
                for m in models
                if m in forecasts[day]
            },
            "metrics": {
                m: metrics_of(day_metrics[day][m])
                for m in models
                if m in day_metrics[day]
            },
        }
        for day in days_between(first, last)
    }

    scored_days = sorted({f.delivery_date for fs in per_day.values() for f in fs})

    def series_of(series: Callable[..., list[float | None]], **kwargs: int) -> Any:
        return {
            metric: {
                m: [
                    figure(v)
                    for v in series(
                        metric,
                        scored_days,
                        per_day[m, "mae" if metric == "rmae" else metric],
                        per_day[NAIVE, "mae"],
                        **kwargs,
                    )
                ]
                for m in models
            }
            for metric in METRICS
        }

    # Each window scope: its last `days` calendar delivery days, up to and
    # including the last scored one.
    window_last = scored_days[-1]
    windows = {
        scope: window_last - timedelta(days=days - 1) for scope, days in WINDOWS.items()
    }
    frames = {"whole": scored} | {
        scope: scored[scored["delivery_date"] >= pd.Timestamp(start)]
        for scope, start in windows.items()
    }
    scope_overall: dict[str, dict[str, dict[str, float]]] = {"whole": overall}
    for scope in WINDOWS:
        scope_overall[scope] = defaultdict(dict)
        for r in published_metrics(frames[scope]):
            if r.scope_type == "overall":
                scope_overall[scope][r.model][r.metric] = r.value

    def comparisons_of(frame: pd.DataFrame) -> dict[str, dict[str, Any]]:
        found: dict[str, dict[str, list[float | None]]] = {m: {} for m in models}
        for c in model_comparisons(frame):
            statistics = found[c.model_a].setdefault(c.model_b, [None] * 24)
            statistics[c.period_ordinal - 1] = figure(c.dm_statistic)
        return {m: {o: found[m][o] for o in by_display_order(found[m])} for m in models}

    def profiles_of(frame: pd.DataFrame) -> dict[str, dict[str, Any]]:
        return {
            by: {
                metric: {
                    m: [figure(v) for v in by_model[m]] for m in models if m in by_model
                }
                for metric, by_model in profile(frame, by).items()
            }
            for by in PROFILES
        }

    dashboard = {
        "record": {
            "first": first.isoformat(),
            "last": last.isoformat(),
            "pending": pending[0].isoformat() if pending else None,
        },
        "models": models,
        "days": days,
        "running": {
            "dates": [d.isoformat() for d in scored_days],
            **series_of(running),
        },
        "trailing": {
            scope: series_of(trailing, days=days) for scope, days in WINDOWS.items()
        },
        **{
            scope: {
                "days": WINDOWS[scope],
                "first": start.isoformat(),
                "last": window_last.isoformat(),
            }
            for scope, start in windows.items()
        },
        "profiles": {scope: profiles_of(frame) for scope, frame in frames.items()},
        "accuracy": {
            scope: {m: metrics_of(by_model[m]) for m in models if m in by_model}
            for scope, by_model in scope_overall.items()
        },
        # The Diebold-Mariano test needs more than a week of days per hour.
        "comparisons": {
            "whole": comparisons_of(scored),
            "window": comparisons_of(frames["window"]),
        },
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(dashboard, separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    log.info(
        "wrote %d delivery days, %s to %s, into %s (%.1f MB)",
        len(days),
        first,
        last,
        out,
        out.stat().st_size / 1e6,
    )
    return dashboard


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m forecast.export", description=__doc__.split("\n\n")[0]
    )
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        export(args.out)
    except RecordInvalid as failure:
        log.error("FAILED  %s", failure)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
