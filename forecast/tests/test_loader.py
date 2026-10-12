"""The price record, the Average Rule and grid repair, on the real file and on
small synthetic ones."""

import hashlib
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from conftest import hourly_day, write_prices
from forecast.grid import IncompleteDeliveryDay, delivery_day, repair_grid
from forecast.loader import (
    QUARTER_HOURLY_FROM,
    ObservedPrice,
    append_prices,
    complete_days,
    day_periods,
    hourly_prices,
    read_prices,
    repaired_prices,
    resolution_on,
)

# SHA-256 of the thesis's grid-repaired prices, `epf-diploma/sources/CZ.csv`, which
# is private: one line per row, `<date>,<el_price>`, joined by newlines, with
# each price quantized to three decimals. The thesis averaged in floating
# point, so a repaired value such as 19.37 is stored there as
# 19.369999999999997; the mean of two prices published to two decimals has at
# most three, so quantizing to 0.001 removes that noise and nothing else.
THESIS_CZ_CSV_SHA256 = (
    "608edbcf12b4b61e6a7005625073c7de0774e76ec0027f056845e599b5412cc3"
)
FROZEN_TO = date(2024, 12, 31)


def local_label(day: date, period_ordinal: int) -> datetime:
    """The thesis's naive wall-clock label for a repaired period."""
    return datetime.combine(day, datetime.min.time()) + timedelta(
        hours=period_ordinal - 1
    )


def test_the_frozen_years_are_the_gui_export_unchanged() -> None:
    frozen = [p for p in read_prices() if delivery_day(p.delivery_start) <= FROZEN_TO]

    assert len(frozen) == 61_368
    assert {p.resolution_minutes for p in frozen} == {60}
    assert (frozen[0].delivery_start, frozen[-1].delivery_start) == (
        datetime(2017, 12, 31, 23, tzinfo=UTC),
        datetime(2024, 12, 31, 22, tzinfo=UTC),
    )


def test_the_repaired_frozen_years_reproduce_the_thesis_exactly() -> None:
    rows = [r for r in repaired_prices() if r.delivery_date <= FROZEN_TO]
    lines = [
        f"{local_label(r.delivery_date, r.period_ordinal):%Y-%m-%d %H:%M:%S},"
        f"{r.price.quantize(Decimal('0.001'))}"
        for r in rows
    ]

    assert len(lines) == 61_368
    assert hashlib.sha256("\n".join(lines).encode()).hexdigest() == (
        THESIS_CZ_CSV_SHA256
    )


def test_every_day_of_the_record_is_complete_at_the_resolution_it_cleared_at() -> None:
    prices = read_prices()
    days = complete_days({p.delivery_start: p.price for p in prices})
    first, last = date(2018, 1, 1), delivery_day(prices[-1].delivery_start)

    assert list(days) == [
        first + timedelta(days=i) for i in range((last - first).days + 1)
    ]
    assert {p.resolution_minutes for p in prices if p.delivery_start.year < 2025} == {
        60
    }
    assert all(
        p.resolution_minutes == resolution_on(delivery_day(p.delivery_start))
        for p in prices
    )


def test_the_hourly_years_carry_seven_short_and_seven_long_days() -> None:
    per_day = Counter(
        delivery_day(p.delivery_start)
        for p in read_prices()
        if delivery_day(p.delivery_start) <= FROZEN_TO
    )

    assert Counter(per_day.values()) == {23: 7, 24: 2543, 25: 7}


@pytest.mark.parametrize(
    ("day", "periods", "repaired_0200"),
    [
        # ADR-0001's worked examples: an interpolated 02:00 and an averaged one.
        (date(2024, 3, 31), 23, Decimal("50.385")),  # (56.09 + 44.68) / 2
        (date(2024, 10, 27), 25, Decimal("81.33")),  # (82.23 + 80.43) / 2
    ],
)
def test_a_daylight_saving_day_keeps_its_true_periods_and_repairs_to_24(
    day: date, periods: int, repaired_0200: Decimal
) -> None:
    prices = read_prices()
    repaired = [r for r in repaired_prices() if r.delivery_date == day]

    assert sum(delivery_day(p.delivery_start) == day for p in prices) == periods
    assert [r.period_ordinal for r in repaired] == list(range(1, 25))
    assert repaired[2].price == repaired_0200


@pytest.mark.parametrize(
    ("day", "quarter_hours"),
    [(date(2025, 10, 26), 100), (date(2026, 3, 29), 92), (date(2026, 6, 1), 96)],
)
def test_a_quarter_hourly_day_holds_its_true_periods(
    day: date, quarter_hours: int
) -> None:
    held = [p for p in read_prices() if delivery_day(p.delivery_start) == day]

    assert len(held) == quarter_hours == len(day_periods(day, 15))
    assert [r.period_ordinal for r in repaired_prices() if r.delivery_date == day] == (
        list(range(1, 25))
    )


def quarter_hours(day: date, prices: list[str]) -> list[ObservedPrice]:
    """A quarter-hourly day whose four quarter-hours of each hour repeat
    `prices`."""
    return [
        ObservedPrice(start, 15, Decimal(prices[i % 4]))
        for i, start in enumerate(day_periods(day, 15))
    ]


def test_the_average_rule_averages_the_four_quarter_hours_exactly() -> None:
    day = date(2026, 6, 1)
    hourly = hourly_prices(quarter_hours(day, ["10.01", "20.02", "30.03", "40.05"]))

    assert len(hourly) == 24
    assert set(hourly.values()) == {Decimal("25.0275")}


def test_the_average_rule_needs_all_four_quarter_hours() -> None:
    day = date(2026, 6, 1)
    prices = quarter_hours(day, ["1", "2", "3", "4"])

    with pytest.raises(ValueError, match="3 quarter-hours"):
        hourly_prices(prices[:5] + prices[6:])


def test_a_day_at_another_resolution_than_the_market_cleared_at_raises() -> None:
    hourly_after_the_change = hourly_day(QUARTER_HOURLY_FROM)

    with pytest.raises(ValueError, match="resolution 60, expected 15"):
        hourly_prices(hourly_after_the_change)


def test_a_period_held_twice_raises() -> None:
    day = hourly_day(date(2024, 6, 1))

    with pytest.raises(ValueError, match="duplicate"):
        hourly_prices([*day, day[3]])


def test_a_delivery_day_with_a_missing_period_raises() -> None:
    day = hourly_day(date(2024, 6, 1))
    del day[5]

    with pytest.raises(IncompleteDeliveryDay):
        repair_grid(hourly_prices(day))


def test_appending_writes_rows_that_read_back_as_they_were(tmp_path: Path) -> None:
    path = write_prices(tmp_path / "prices.csv", hourly_day(date(2025, 9, 30)))
    new = quarter_hours(date(2025, 10, 1), ["1.50", "-2.00", "3.25", "4.00"])

    append_prices(new, path)

    assert read_prices(path)[24:] == new
    assert path.read_text(encoding="utf-8").splitlines()[25] == (
        "2025-09-30T22:00:00Z,15,1.50"
    )


def test_appending_anything_not_after_the_last_period_held_raises(
    tmp_path: Path,
) -> None:
    path = write_prices(tmp_path / "prices.csv", hourly_day(date(2025, 9, 30)))

    with pytest.raises(ValueError, match="not after"):
        append_prices(hourly_day(date(2025, 9, 30)), path)
    assert len(read_prices(path)) == 24
