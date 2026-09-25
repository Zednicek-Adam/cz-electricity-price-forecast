"""Grid repair: the one implementation (ADR-0001, ADR-0005).

Observed prices are stored at true market periods, so a delivery day in
`Europe/Prague` has 23, 24 or 25 of them. The models work on a regular grid of
24 period ordinals. Grid repair flattens the first onto the second:

* an ordinary hour keeps its price;
* on a fall-back day the two periods sharing the local label 02:00 are averaged
  into one;
* on a spring-forward day the missing 02:00 is interpolated linearly, as the
  mean of the periods either side of the gap.

It is lossy, and it is applied exactly once: the loader stores its output in
`repaired_observed_price`, in the same transaction as the observed prices, and
everything downstream reads the stored series. Nothing repairs at read time.

Prices are `Decimal` so the repair is exact: the mean of two prices published to
two decimals has at most three, and `numeric` stores it as it is.
"""

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

PRAGUE = ZoneInfo("Europe/Prague")
HOUR = timedelta(hours=1)
PERIODS_PER_DAY = 24


class IncompleteDeliveryDay(ValueError):
    """A delivery day's true market periods are not all present."""


@dataclass(frozen=True)
class RepairedPrice:
    delivery_date: date
    period_ordinal: int
    price: Decimal


def delivery_day(delivery_start: datetime) -> date:
    """The delivery day a period belongs to: its local date in Europe/Prague."""
    return delivery_start.astimezone(PRAGUE).date()


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """The UTC instants at which a delivery day begins and the next one begins."""
    start = datetime(day.year, day.month, day.day, tzinfo=PRAGUE)
    end = start + timedelta(days=1)  # wall-clock arithmetic: local midnight
    end = datetime(end.year, end.month, end.day, tzinfo=PRAGUE)
    return start.astimezone(UTC), end.astimezone(UTC)


def true_periods(day: date) -> list[datetime]:
    """Every hourly delivery period of a day, as UTC instants: 23, 24 or 25."""
    start, end = day_bounds(day)
    count = (end - start) // HOUR
    return [start + i * HOUR for i in range(count)]


def repair_day(day: date, prices: Mapping[datetime, Decimal]) -> list[RepairedPrice]:
    """One delivery day on the regular 24-period grid.

    `prices` maps UTC period starts to prices and must hold every true period of
    the day. Anything missing raises: repair is a declared transformation of
    known-good data, never a way of filling a gap.
    """
    missing = [p for p in true_periods(day) if p not in prices]
    if missing:
        raise IncompleteDeliveryDay(
            f"{day}: missing {len(missing)} period(s),"
            f" first {missing[0]:%Y-%m-%dT%H:%MZ}"
        )
    repaired = []
    for hour in range(PERIODS_PER_DAY):
        label = datetime(day.year, day.month, day.day, hour)
        # For a label that occurs twice, fold=0 is the first (CEST) instant and
        # fold=1 the second (CET). For a label that does not occur at all,
        # fold=0 resolves forwards and fold=1 backwards, onto the two periods
        # either side of the gap. Either way the mean is the thesis's repair.
        early = label.replace(tzinfo=PRAGUE, fold=0).astimezone(UTC)
        late = label.replace(tzinfo=PRAGUE, fold=1).astimezone(UTC)
        price = prices[early] if early == late else (prices[early] + prices[late]) / 2
        repaired.append(RepairedPrice(day, hour + 1, price))
    return repaired


def repair_grid(prices: Mapping[datetime, Decimal]) -> list[RepairedPrice]:
    """Every delivery day the prices touch, repaired, in date order.

    Every day must be complete, including the first and the last.
    """
    by_day: dict[date, dict[datetime, Decimal]] = defaultdict(dict)
    for start, price in prices.items():
        by_day[delivery_day(start)][start] = price
    return [r for day in sorted(by_day) for r in repair_day(day, by_day[day])]
