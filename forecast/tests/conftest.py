"""Shared test helpers. Every test runs on files and DataFrames: there is no
database and no network anywhere in the suite.

The real records in `data/` are read where a test is about them; anything a
test writes goes to its own `tmp_path`.
"""

import csv
from collections.abc import Iterable
from datetime import date
from decimal import Decimal
from functools import cache
from pathlib import Path

import pytest

from forecast.grid import true_periods
from forecast.loader import COLUMNS, TIMESTAMP, ObservedPrice
from forecast.model import Model
from forecast.models import DOWNLOADED, ROSTER, build

FIXTURES = Path(__file__).parent / "fixtures"


def roster() -> list:
    """Every model on the roster as a test parameter. Chronos-2 carries the
    `chronos` marker, so the default run, the gate's, never builds it."""
    return [
        pytest.param(slug, marks=pytest.mark.chronos) if slug in DOWNLOADED else slug
        for slug in sorted(ROSTER)
    ]


@cache
def built(slug: str) -> Model:
    """A model built once per test session: Chronos-2 takes seconds to load."""
    return build(slug)


def hourly_day(day: date, price: Decimal = Decimal("50.00")) -> list[ObservedPrice]:
    """Every true market period of an hourly day, each at a distinct price."""
    return [
        ObservedPrice(start, 60, price + i) for i, start in enumerate(true_periods(day))
    ]


def write_prices(path: Path, prices: Iterable[ObservedPrice]) -> Path:
    """A price record in the format of `data/cz-day-ahead-prices.csv`."""
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(COLUMNS)
        for p in prices:
            writer.writerow(
                [p.delivery_start.strftime(TIMESTAMP), p.resolution_minutes, p.price]
            )
    return path
