"""The daily run (ADR-0011, ADR-0012): ingest, then forecast the pending day.

    ENTSOE_API_TOKEN=... uv run --extra chronos python -m forecast.daily

1. **Ingest** reconciles: it fetches every delivery day after the last one
   `data/cz-day-ahead-prices.csv` holds, through tomorrow in `Europe/Prague`,
   and appends the complete ones. A day that is not published yet ends the
   range quietly; a day published only in part, or a published day after a
   missing one, fails the run. It never re-reads a day it holds.
2. **Forecast**: every model on the roster forecasts the first delivery day
   with no published price, as a `live` run, unless it already has. At 14:35
   that is D+2. The cutoff is the day before it, which ingest has just closed,
   so the runner holds nothing it may not use.

Scoring is the export's: the forecast the previous run made now has its price,
and the next deploy rebuilds every metric whole.

The run writes the two CSVs and nothing else. Committing them is the
workflow's, so a run that fails anywhere leaves `main` as it was: the price is
fetched again tomorrow, and the forecast it did not write stays a hole.
"""

import logging
import os
import sys
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from forecast.entsoe import MAX_RANGE, Fetch, fetcher, parse_prices
from forecast.forecasts import FORECASTS, merge, read_forecasts, write_forecasts
from forecast.grid import PRAGUE, day_bounds, delivery_day
from forecast.loader import (
    PRICES,
    ObservedPrice,
    append_prices,
    complete_days,
    last_delivery_day,
    read_prices,
    repaired_history,
    resolution_on,
)
from forecast.models import ROSTER, build
from forecast.runner import current_code_version, run_forecast

log = logging.getLogger("forecast.daily")


class IngestFailed(RuntimeError):
    """The platform published a day in part, or skipped one."""


def ingest(fetch: Fetch, through: date, path: Path = PRICES) -> list[date]:
    """Append every complete delivery day after the last one held, up to and
    including `through`. Returns the days appended."""
    first = last_delivery_day(read_prices(path)) + timedelta(days=1)
    if first > through:
        return []

    published: dict[datetime, ObservedPrice] = {}
    touched: set[date] = set()
    start, end = day_bounds(first)[0], day_bounds(through)[1]
    while start < end:
        chunk_end = min(start + MAX_RANGE, end)
        for p in parse_prices(fetch(start, chunk_end)):
            day = delivery_day(p.delivery_start)
            if not first <= day <= through:
                continue
            touched.add(day)
            # A day at any other resolution than the market's is left out, so
            # it reads as published in part below.
            if p.resolution_minutes == resolution_on(day):
                published[p.delivery_start] = p
        start = chunk_end

    complete = complete_days({t: p.price for t, p in published.items()})
    appended: list[date] = []
    day = first
    while day in complete:
        appended.append(day)
        day += timedelta(days=1)
    if day in touched:
        raise IngestFailed(f"{day} is published only in part")
    if later := sorted(d for d in touched if d > day):
        raise IngestFailed(f"{day} is missing, but {later[0]} is published")

    append_prices([published[t] for d in appended for t in sorted(complete[d])], path)
    return appended


def forecast_pending(
    prices_path: Path = PRICES,
    forecasts_path: Path = FORECASTS,
    *,
    models: Sequence[str] = tuple(ROSTER),
    code_version: str | None = None,
) -> tuple[date, list[str]]:
    """Forecast the first delivery day without a published price, for every
    model that has no forecast for it yet. Returns the day and those models."""
    history = repaired_history(prices_path)
    target = history.index[-1].date() + timedelta(days=1)
    held = read_forecasts(forecasts_path)
    have = {r.model for r in held if r.delivery_date == target}
    todo = [slug for slug in models if slug not in have]
    if not todo:
        return target, []
    code_version = code_version or current_code_version()
    runs = []
    for slug in todo:
        log.info("%s: forecasting %s", slug, target)
        run = run_forecast(build(slug), target, history)
        runs.append(
            run.stored(
                run_type="live",
                code_version=code_version,
                executed_at=datetime.now(UTC).replace(microsecond=0),
            )
        )
    write_forecasts(merge(held, runs), forecasts_path)
    return target, todo


def main(argv: Sequence[str] | None = None) -> int:
    del argv
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    token = os.environ.get("ENTSOE_API_TOKEN")
    if not token:
        log.error("ENTSOE_API_TOKEN is not set")
        return 2
    tomorrow = datetime.now(PRAGUE).date() + timedelta(days=1)
    try:
        days = ingest(fetcher(token), through=tomorrow)
        log.info(
            "ingest: %s",
            f"{len(days)} delivery day(s), {days[0]} to {days[-1]}"
            if days
            else "nothing new",
        )
        target, models = forecast_pending()
        log.info("forecast %s: %s", target, ", ".join(models) or "already forecast")
    except Exception as failure:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=Daily run failed::{failure}")
        raise
    return 0


if __name__ == "__main__":
    sys.exit(main())
