"""The observed-price record: `data/cz-day-ahead-prices.csv`, read and appended.

The file holds the prices as the market published them, at true market periods
(ADR-0001): hourly up to delivery day 2025-09-30, quarter-hourly from
2025-10-01. Everything a model or a metric reads is derived from it here, on
the way out, in two declared steps:

1. **The Average Rule.** A quarter-hourly delivery day becomes hourly by
   averaging the four quarter-hours of each hour (CONTEXT.md). An hour short of
   any of its four quarter-hours raises.
2. **Grid repair** (`forecast.grid`) flattens the hourly true market periods
   onto the regular 24-period grid.

Both are exact in `Decimal`, and nothing else derives prices anywhere.

The record is append-only, and the only writer is ingest (`forecast.daily`),
which appends whole delivery days after the last one held. Git history is what
shows any other change to a price.
"""

import csv
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pandas as pd

from forecast.grid import (
    RESOLUTION_MINUTES,
    RepairedPrice,
    day_bounds,
    delivery_day,
    market_label,
    repair_grid,
)
from forecast.model import history_series

REPO_ROOT = Path(__file__).resolve().parents[3]
PRICES = REPO_ROOT / "data" / "cz-day-ahead-prices.csv"
COLUMNS = ["delivery_start", "resolution_minutes", "price"]
TIMESTAMP = "%Y-%m-%dT%H:%M:%SZ"

# The first delivery day the Czech day-ahead market cleared in quarter-hours.
QUARTER_HOURLY_FROM = date(2025, 10, 1)
QUARTER_HOUR_MINUTES = 15


@dataclass(frozen=True)
class ObservedPrice:
    delivery_start: datetime
    resolution_minutes: int
    price: Decimal


def resolution_on(day: date) -> int:
    """The resolution the market published `day` at, in minutes."""
    return QUARTER_HOUR_MINUTES if day >= QUARTER_HOURLY_FROM else RESOLUTION_MINUTES


def read_prices(path: Path = PRICES) -> list[ObservedPrice]:
    with path.open(newline="", encoding="utf-8") as fh:
        return [
            ObservedPrice(
                delivery_start=datetime.strptime(
                    row["delivery_start"], TIMESTAMP
                ).replace(tzinfo=UTC),
                resolution_minutes=int(row["resolution_minutes"]),
                price=Decimal(row["price"]),
            )
            for row in csv.DictReader(fh)
        ]


def append_prices(prices: Iterable[ObservedPrice], path: Path = PRICES) -> None:
    """Append periods to the record, which must start after the last one held."""
    rows = sorted(prices, key=lambda p: p.delivery_start)
    if not rows:
        return
    held = read_prices(path)
    if held and rows[0].delivery_start <= held[-1].delivery_start:
        raise ValueError(
            f"appending {rows[0].delivery_start:%Y-%m-%dT%H:%MZ}, which is not"
            f" after the last period held, {held[-1].delivery_start:%Y-%m-%dT%H:%MZ}"
        )
    with path.open("a", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        for p in rows:
            writer.writerow(
                [
                    p.delivery_start.strftime(TIMESTAMP),
                    p.resolution_minutes,
                    f"{p.price:.2f}",
                ]
            )


def last_delivery_day(prices: Iterable[ObservedPrice]) -> date:
    return delivery_day(max(p.delivery_start for p in prices))


def hourly_prices(prices: Iterable[ObservedPrice]) -> dict[datetime, Decimal]:
    """Every hourly period's price, the quarter-hours averaged (the Average Rule).

    A period may appear only once, and each delivery day at the resolution the
    market published it at.
    """
    hourly: dict[datetime, Decimal] = {}
    quarters: dict[datetime, list[Decimal]] = defaultdict(list)
    seen: set[datetime] = set()
    for p in prices:
        if p.delivery_start in seen:
            raise ValueError(f"duplicate delivery period: {p.delivery_start}")
        seen.add(p.delivery_start)
        expected = resolution_on(delivery_day(p.delivery_start))
        if p.resolution_minutes != expected:
            raise ValueError(
                f"{p.delivery_start:%Y-%m-%dT%H:%MZ}: resolution"
                f" {p.resolution_minutes}, expected {expected}"
            )
        if p.resolution_minutes == RESOLUTION_MINUTES:
            hourly[p.delivery_start] = p.price
        else:
            hour = p.delivery_start.replace(minute=0)
            quarters[hour].append(p.price)
    for hour, values in quarters.items():
        if len(values) != 4:
            raise ValueError(
                f"{hour:%Y-%m-%dT%H:%MZ}: {len(values)} quarter-hours, expected 4"
            )
        hourly[hour] = sum(values, Decimal(0)) / 4
    return dict(sorted(hourly.items()))


def repaired_prices(path: Path = PRICES) -> list[RepairedPrice]:
    """The repaired observed prices: every delivery day on the 24-period grid."""
    return repair_grid(hourly_prices(read_prices(path)))


def repaired_history(path: Path = PRICES) -> pd.Series:
    """The repaired observed prices in the shape a model is handed."""
    return as_history(repaired_prices(path))


def as_history(repaired: Iterable[RepairedPrice]) -> pd.Series:
    rows = list(repaired)
    return history_series(
        [market_label(r.delivery_date, r.period_ordinal) for r in rows],
        [float(r.price) for r in rows],
    )


def day_periods(day: date, resolution: int) -> list[datetime]:
    """Every true market period of a delivery day at `resolution`, as UTC
    instants: 23/24/25 hours, or 92/96/100 quarter-hours."""
    start, end = day_bounds(day)
    step = timedelta(minutes=resolution)
    return [start + i * step for i in range((end - start) // step)]


def complete_days(
    prices: Mapping[datetime, Decimal],
) -> dict[date, dict[datetime, Decimal]]:
    """Prices grouped by delivery day, keeping only the days that hold exactly
    their true market periods at the resolution the market published them at.
    The period count comes from the calendar, never assumed."""
    by_day: dict[date, dict[datetime, Decimal]] = defaultdict(dict)
    for start, price in prices.items():
        by_day[delivery_day(start)][start] = price
    return {
        day: periods
        for day, periods in sorted(by_day.items())
        if set(periods) == set(day_periods(day, resolution_on(day)))
    }
