"""Seam 1: the model interface, in memory, no I/O.

Deliberately thin. The naïve is a lookup, so it is asserted to the value; every
model on the roster is checked for interface conformance on real history,
including a spring-forward and a fall-back delivery day.
"""

from datetime import date
from functools import cache

import pandas as pd
import pytest

from forecast.grid import market_label, repair_grid
from forecast.loader import read_frozen_dataset
from forecast.model import history_series
from forecast.models import ROSTER, build
from forecast.models.daylag import DayLagNaive
from forecast.runner import run_forecast


@cache
def frozen_history() -> pd.Series:
    """The frozen dataset, grid-repaired in memory, as the runner would hand it."""
    prices = {p.delivery_start: p.price for p in read_frozen_dataset()}
    repaired = repair_grid(prices)
    return history_series(
        [market_label(r.delivery_date, r.period_ordinal) for r in repaired],
        [float(r.price) for r in repaired],
    )


def in_memory(target_day: date) -> pd.Series:
    return frozen_history()


def test_the_naive_is_yesterdays_prices_to_the_value() -> None:
    history = frozen_history()
    target = date(2022, 8, 30)

    forecast = DayLagNaive().forecast(history[:"2022-08-29 23:00"], target)

    assert forecast == list(history["2022-08-29 00:00":"2022-08-29 23:00"])
    assert forecast[19] == 871.0  # the record's highest, 17:00Z = 19:00 CEST


@pytest.mark.parametrize("slug", sorted(ROSTER))
@pytest.mark.parametrize(
    "target_day",
    [
        date(2020, 1, 1),  # the first replayed day
        date(2024, 3, 31),  # spring forward
        date(2024, 4, 1),  # the day after, fed a repaired 23-period day
        date(2024, 10, 27),  # fall back
        date(2024, 10, 28),  # the day after, fed a repaired 25-period day
        date(2024, 12, 31),  # the last replayed day
    ],
)
def test_every_model_returns_24_finite_floats(slug: str, target_day: date) -> None:
    run = run_forecast(build(slug), target_day, in_memory)

    assert len(run.prices) == 24
    assert all(isinstance(p, float) for p in run.prices)
    assert not pd.Series(run.prices).isna().any()


def test_the_naive_carries_a_daylight_saving_day_on_the_repaired_grid() -> None:
    # 2024-03-31 has no 02:00; grid repair interpolates one, and the next day's
    # naïve forecast for period ordinal 3 is that interpolated price.
    run = run_forecast(DayLagNaive(), date(2024, 4, 1), in_memory)

    assert run.prices[2] == 50.385
