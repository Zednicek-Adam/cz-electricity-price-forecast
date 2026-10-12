"""The daily run's two steps, on temporary records: ingest against a platform
that answers from fixtures and synthetic documents, then the pending forecast.
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from conftest import FIXTURES, hourly_day, write_prices
from forecast.daily import IngestFailed, forecast_pending, ingest
from forecast.forecasts import merge, read_forecasts, write_forecasts
from forecast.grid import day_bounds
from forecast.loader import day_periods, read_prices, resolution_on

NS = "urn:iec62325.351:tc57wg16:451-3:publicationdocument:7:3"


def document(days: list[date], short: bool = False) -> bytes:
    """An A44 document publishing `days`, each in full at the resolution the
    market cleared it at, or with the last day one period `short`."""
    series = []
    for n, day in enumerate(days):
        minutes = resolution_on(day)
        start, end = day_bounds(day)
        periods = day_periods(day, minutes)
        if short and n == len(days) - 1:
            end = periods.pop()
        points = "".join(
            f"<Point><position>{i + 1}</position>"
            f"<price.amount>{Decimal(i) + Decimal('0.25')}</price.amount></Point>"
            for i in range(len(periods))
        )
        series.append(
            "<TimeSeries><currency_Unit.name>EUR</currency_Unit.name>"
            "<price_Measure_Unit.name>MWH</price_Measure_Unit.name>"
            "<curveType>A01</curveType><Period><timeInterval>"
            f"<start>{start:%Y-%m-%dT%H:%MZ}</start><end>{end:%Y-%m-%dT%H:%MZ}</end>"
            f"</timeInterval><resolution>PT{minutes}M</resolution>{points}"
            "</Period></TimeSeries>"
        )
    return (
        f'<Publication_MarketDocument xmlns="{NS}">{"".join(series)}'
        "</Publication_MarketDocument>"
    ).encode()


class Platform:
    """Answers every request with the same document, and remembers the ranges
    it was asked for."""

    def __init__(self, response: bytes) -> None:
        self.response = response
        self.asked: list[tuple[datetime, datetime]] = []

    def __call__(self, start: datetime, end: datetime) -> bytes:
        self.asked.append((start, end))
        return self.response


@pytest.fixture
def record(tmp_path: Path) -> Path:
    """A price record whose last day is 2025-09-29."""
    return write_prices(tmp_path / "prices.csv", hourly_day(date(2025, 9, 29)))


def test_ingest_appends_every_published_day_after_the_last_one_held(
    record: Path,
) -> None:
    # Across the change to quarter-hours: 2025-10-01 is the first such day.
    days = [date(2025, 9, 30), date(2025, 10, 1)]
    platform = Platform(document(days))

    assert ingest(platform, through=date(2025, 10, 1), path=record) == days
    assert platform.asked == [
        (day_bounds(date(2025, 9, 30))[0], day_bounds(date(2025, 10, 1))[1])
    ]
    held = read_prices(record)
    assert len(held) == 24 + 24 + 96
    assert {p.resolution_minutes for p in held[48:]} == {15}


def test_a_day_not_published_yet_ends_the_range_quietly(record: Path) -> None:
    platform = Platform(document([date(2025, 9, 30)]))

    assert ingest(platform, through=date(2025, 10, 2), path=record) == [
        date(2025, 9, 30)
    ]


def test_nothing_held_after_through_is_asked_for(record: Path) -> None:
    platform = Platform(document([]))

    assert ingest(platform, through=date(2025, 9, 29), path=record) == []
    assert platform.asked == []


def test_a_day_published_in_part_fails_and_appends_nothing(record: Path) -> None:
    platform = Platform(document([date(2025, 9, 30), date(2025, 10, 1)], short=True))

    with pytest.raises(IngestFailed, match="2025-10-01 is published only in part"):
        ingest(platform, through=date(2025, 10, 1), path=record)
    assert len(read_prices(record)) == 24


def test_a_published_day_after_a_missing_one_fails(record: Path) -> None:
    platform = Platform(document([date(2025, 10, 1)]))

    with pytest.raises(IngestFailed, match="2025-09-30 is missing"):
        ingest(platform, through=date(2025, 10, 1), path=record)


def test_a_range_longer_than_a_year_is_asked_for_in_pieces(tmp_path: Path) -> None:
    path = write_prices(tmp_path / "prices.csv", hourly_day(date(2023, 12, 31)))
    platform = Platform((FIXTURES / "not-published.xml").read_bytes())

    assert ingest(platform, through=date(2025, 6, 30), path=path) == []
    assert len(platform.asked) == 2
    assert platform.asked[0][1] == platform.asked[1][0]
    assert platform.asked[0][1] - platform.asked[0][0] == timedelta(days=365)


def first_ten_days(tmp_path: Path) -> Path:
    days = [date(2024, 6, 1) + timedelta(days=i) for i in range(10)]
    return write_prices(
        tmp_path / "prices.csv",
        [p for i, day in enumerate(days) for p in hourly_day(day, Decimal(i))],
    )


def test_the_pending_day_is_forecast_live_once(tmp_path: Path) -> None:
    prices = first_ten_days(tmp_path)
    forecasts = tmp_path / "forecasts.csv"

    target, models = forecast_pending(
        prices, forecasts, models=["daylag"], code_version="abc"
    )

    assert (target, models) == (date(2024, 6, 11), ["daylag"])
    (run,) = read_forecasts(forecasts)
    assert (run.delivery_date, run.model, run.run_type, run.code_version) == (
        date(2024, 6, 11),
        "daylag",
        "live",
        "abc",
    )
    assert run.prices == tuple(9.0 + i for i in range(24))
    assert forecast_pending(prices, forecasts, models=["daylag"]) == (
        date(2024, 6, 11),
        [],
    )


def test_a_live_forecast_is_never_replaced(tmp_path: Path) -> None:
    prices = first_ten_days(tmp_path)
    forecasts = tmp_path / "forecasts.csv"
    forecast_pending(prices, forecasts, models=["daylag"], code_version="abc")
    (live,) = read_forecasts(forecasts)

    with pytest.raises(ValueError, match="never replaced"):
        write_forecasts(merge([live], [live]), forecasts)
