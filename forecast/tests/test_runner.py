"""Seam 2: forecast runs on a short synthetic record.

The record spans the 2024 spring-forward day, and every price is distinct, so
a forecast shows exactly which price it came from.
"""

import re
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pandas as pd
import pytest

from forecast.grid import repair_grid, true_periods
from forecast.loader import as_history
from forecast.models.daylag import DayLagNaive
from forecast.runner import (
    ForecastRunFailed,
    HistoryGap,
    current_code_version,
    run_days,
    run_forecast,
)

FIRST_DAY = date(2024, 3, 25)
LAST_DAY = date(2024, 4, 5)
TARGET = date(2024, 4, 2)


def synthetic_price(day: date, index: int) -> Decimal:
    """Distinct per period: the day of month, then the period's position."""
    return Decimal(f"{day.day}.{index:02d}")


@pytest.fixture
def history() -> pd.Series:
    days = [FIRST_DAY + timedelta(days=i) for i in range((LAST_DAY - FIRST_DAY).days)]
    prices = {
        start: synthetic_price(day, i)
        for day in days
        for i, start in enumerate(true_periods(day))
    }
    return as_history(repair_grid(prices))


class Recorder:
    """A model that remembers the history it was handed."""

    slug = "recorder"
    version = "recorder"
    history_days = 3

    def __init__(self) -> None:
        self.seen: pd.Series | None = None

    def forecast(self, history: pd.Series, target_day: date) -> list[float]:
        self.seen = history
        return [0.0] * 24


def test_a_run_is_24_forecasts_carrying_its_model_version(
    history: pd.Series,
) -> None:
    run = run_forecast(DayLagNaive(), TARGET, history)

    assert (run.model, run.model_version, run.delivery_date) == (
        "daylag",
        "daylag-d1",
        TARGET,
    )
    assert run.prices == tuple(
        float(synthetic_price(date(2024, 4, 1), i)) for i in range(24)
    )


def test_the_cutoff_excludes_every_period_from_the_target_day_onward(
    history: pd.Series,
) -> None:
    model = Recorder()
    run_forecast(model, TARGET, history)

    assert model.seen is not None
    assert model.seen.index[0] == datetime(2024, 3, 30, 0)
    assert model.seen.index[-1] == datetime(2024, 4, 1, 23)
    assert len(model.seen) == 3 * 24


def test_a_gap_in_the_required_history_raises(history: pd.Series) -> None:
    gapped = history.drop(datetime(2024, 4, 1, 6))

    with pytest.raises(HistoryGap, match="1 of 24 periods missing"):
        run_forecast(DayLagNaive(), TARGET, gapped)


def test_history_before_the_record_begins_is_a_gap(history: pd.Series) -> None:
    with pytest.raises(HistoryGap):
        run_forecast(DayLagNaive(), FIRST_DAY, history)


def test_the_day_loop_yields_rows_of_the_record(history: pd.Series) -> None:
    days = [TARGET, TARGET + timedelta(days=1)]

    runs = list(
        run_days(DayLagNaive(), days, history, run_type="backtest", code_version="c")
    )

    assert [(r.delivery_date, r.model, r.run_type, r.code_version) for r in runs] == [
        (day, "daylag", "backtest", "c") for day in days
    ]
    assert all(r.executed_at.tzinfo == UTC for r in runs)


def test_the_day_loop_names_the_run_that_failed_and_keeps_the_ones_before(
    history: pd.Series,
) -> None:
    runs = []
    days = [LAST_DAY - timedelta(days=1), LAST_DAY, LAST_DAY + timedelta(days=1)]

    with pytest.raises(ForecastRunFailed, match="daylag on 2024-04-06"):
        for run in run_days(
            DayLagNaive(), days, history, run_type="backtest", code_version="c"
        ):
            runs.append(run)

    assert [r.delivery_date for r in runs] == days[:2]


def test_the_code_version_is_a_git_sha() -> None:
    assert re.fullmatch(r"[0-9a-f]{40}(-dirty)?", current_code_version())
