"""The export: both records in, every file the dashboard reads out (ADR-0016).

    uv run python -m forecast.export [--out ../web/public/data]

It reads `data/cz-day-ahead-prices.csv` and `data/forecasts.csv`, repairs the
grid, computes every published metric, the running metric and the
Diebold-Mariano tests, and writes one JSON file per view:

| File                          | View                                     |
|-------------------------------|------------------------------------------|
| `record.json`                 | the record's extent and its pending day  |
| `days/<delivery date>.json`   | the Day view                             |
| `running/<metric>.json`       | the Over time view                       |
| `daily/<metric>.json`         | the ribbon, and worst / best / random    |
| `accuracy.json`               | the accuracy table                       |
| `comparisons/<model>.json`    | the Diebold-Mariano card                 |

Their shapes are `web/src/types.ts`. Nothing is written incrementally: every
deploy runs the export and rebuilds every file whole, so the dashboard can never
describe a forecast the record no longer holds (ADR-0010).

Before it writes, it checks the record and stops on the first failure:

* every model is on the roster, and has a forecast run on every delivery day
  of the frozen backtest, 2020-01-01 to 2024-12-31;
* at most one delivery day has forecasts but no published price: the pending
  forecast (CONTEXT.md);
* the day-lag naïve's own overall rMAE reads exactly 1.000.
"""

import argparse
import json
import logging
import shutil
import sys
from collections import defaultdict
from collections.abc import Iterable, Sequence
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from forecast.forecasts import FORECASTS, StoredRun, read_forecasts
from forecast.loader import PRICES, REPO_ROOT, repaired_prices
from forecast.metrics import (
    METRICS,
    NAIVE,
    DayFigure,
    model_comparisons,
    published_metrics,
    running,
    scored_forecasts,
)
from forecast.models import ROSTER

log = logging.getLogger("forecast.export")

OUT = REPO_ROOT / "web" / "public" / "data"

# The roster in the order the dashboard lists it, and the model it leads with:
# configuration, frozen (ADR-0003).
DISPLAY_ORDER = ("chronos2", "ar168", "daylag")
HEADLINE_MODEL = "chronos2"

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


def export(
    out: Path = OUT,
    *,
    prices_path: Path = PRICES,
    forecasts_path: Path = FORECASTS,
) -> dict[str, Any]:
    """Check the records and write every file. Returns `record.json`."""
    repaired = repaired_prices(prices_path)
    runs = read_forecasts(forecasts_path)
    check(len(runs) > 0, f"{len(runs)} forecast runs")

    observed: dict[date, list[float]] = defaultdict(list)
    for r in repaired:
        observed[r.delivery_date].append(float(r.price))
    forecasts: dict[date, dict[str, StoredRun]] = defaultdict(dict)
    for run in runs:
        forecasts[run.delivery_date][run.model] = run

    models = {run.model for run in runs}
    check(models <= set(ROSTER), f"every model is on the roster: {sorted(models)}")
    for model in sorted(models):
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
    comparison_rows = model_comparisons(scored)

    naive_overall = [
        r.value
        for r in metric_rows
        if (r.model, r.scope_type, r.metric) == (NAIVE, "overall", "rmae")
    ]
    reads = f"{naive_overall[0]:.3f}" if naive_overall else "nothing"
    check(reads == "1.000", f"{NAIVE}: overall rMAE reads {reads}")

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

    if out.exists():
        shutil.rmtree(out)
    first, last = min(forecasts), max(forecasts)
    record = {
        "first": first.isoformat(),
        "last": last.isoformat(),
        "pending": pending[0].isoformat() if pending else None,
    }
    _write(out / "record.json", record)

    for day in days_between(first, last):
        _write(
            out / "days" / f"{day.isoformat()}.json",
            {
                "deliveryDate": day.isoformat(),
                "observed": observed.get(day),
                "forecasts": [
                    {"model": m, "prices": list(forecasts[day][m].prices)}
                    for m in by_display_order(forecasts[day])
                ],
                "metrics": _model_metrics(day_metrics[day]),
            },
        )

    scored_days = sorted({f.delivery_date for fs in per_day.values() for f in fs})
    for metric in METRICS:
        source = "mae" if metric == "rmae" else metric
        _write(
            out / "running" / f"{metric}.json",
            {
                "metric": metric,
                "deliveryDates": [d.isoformat() for d in scored_days],
                "series": [
                    {
                        "model": m,
                        "values": running(
                            metric,
                            scored_days,
                            per_day[m, source],
                            per_day[NAIVE, "mae"],
                        ),
                    }
                    for m in by_display_order(models)
                ],
            },
        )
        headline = per_day[HEADLINE_MODEL, metric]
        _write(
            out / "daily" / f"{metric}.json",
            {
                "model": HEADLINE_MODEL,
                "metric": metric,
                "deliveryDates": [f.delivery_date.isoformat() for f in headline],
                "values": [f.value for f in headline],
            },
        )

    _write(out / "accuracy.json", {"rows": _model_metrics(overall)})

    opponents: dict[str, dict[str, dict[str, list[float | None]]]] = defaultdict(dict)
    for c in comparison_rows:
        entry = opponents[c.model_a].setdefault(
            c.model_b, {"dmStatistic": [None] * 24, "pValue": [None] * 24}
        )
        entry["dmStatistic"][c.period_ordinal - 1] = c.dm_statistic
        entry["pValue"][c.period_ordinal - 1] = c.p_value
    for model in DISPLAY_ORDER:
        _write(
            out / "comparisons" / f"{model}.json",
            {
                "model": model,
                "opponents": [
                    {"opponent": o, **opponents[model][o]}
                    for o in by_display_order(opponents[model])
                ],
            },
        )
    log.info(
        "wrote %d delivery days, %s to %s, into %s",
        (last - first).days + 1,
        first,
        last,
        out,
    )
    return record


def _model_metrics(by_model: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    """One row of four metrics per model, `null` where a figure is undefined."""
    return [
        {"model": m, **{metric: by_model[m].get(metric) for metric in METRICS}}
        for m in by_display_order(by_model)
    ]


def _write(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8"
    )


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
