"""The runner: everything a model is not allowed to touch (ADR-0002).

It owns the day loop, the cutoff slicing, the check that the history a model
needs is complete, and the writing. A forecast run is one model for one delivery day,
producing 24 forecasts.

**The cutoff** (`forecast.model.cutoff`) is derived from the target delivery
day and never passed in. The runner slices every provider's history at it,
whatever the provider returned.

**Failure is loud.** A run whose required history has a gap raises
`HistoryGap` and writes nothing: no forward-fill, no interpolation, no
nearest-neighbour substitution. A missing day on the scoreboard is honest; a
fabricated one is not.

**A re-run replaces.** Writing a run deletes the stored
`(model, run_type, delivery_date)` rows and inserts 24 new ones in one
transaction, all or nothing. Never an upsert: the writer role holds no `UPDATE`.
"""

import logging
import math
import os
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

import pandas as pd
import psycopg

from forecast.grid import HOUR, REPAIRED_PERIODS_PER_DAY, RESOLUTION_MINUTES
from forecast.history import HistoryProvider
from forecast.model import Model, cutoff

RunType = Literal["backtest", "live"]

log = logging.getLogger(__name__)


class HistoryGap(ValueError):
    """The history a forecast run needs is incomplete."""


class InvalidForecast(ValueError):
    """A model returned something other than 24 finite numbers."""


class ForecastRunFailed(RuntimeError):
    """A forecast run in the day loop failed; says which, and at which step."""

    def __init__(self, model: str, day: date, step: str) -> None:
        self.model, self.day, self.step = model, day, step
        super().__init__(f"{model} on {day}: {step} failed")

    def __str__(self) -> str:
        cause = f": {self.__cause__}" if self.__cause__ else ""
        return f"{self.model} on {self.day}: {self.step} failed{cause}"


@dataclass(frozen=True)
class Run:
    model: str
    model_version: str
    delivery_date: date
    prices: tuple[float, ...]


def run_forecast(model: Model, target_day: date, provider: HistoryProvider) -> Run:
    """One forecast run: slice history at the cutoff, check it, call the model.

    The model receives a copy of exactly the whole days it asked for, ending at
    the cutoff, so nothing it does can reach the provider, the store or data
    from the target day onward.
    """
    history = _required_history(provider(target_day), target_day, model.history_days)

    prices = model.forecast(history.copy(), target_day)
    if len(prices) != REPAIRED_PERIODS_PER_DAY or not all(
        isinstance(p, float) and math.isfinite(p) for p in prices
    ):
        raise InvalidForecast(
            f"{model.slug} for {target_day}:"
            f" expected {REPAIRED_PERIODS_PER_DAY} finite floats"
        )
    return Run(model.slug, model.version, target_day, tuple(prices))


def _required_history(history: pd.Series, target_day: date, days: int) -> pd.Series:
    """The whole `days` before the cutoff, or `HistoryGap` if any is missing."""
    end = cutoff(target_day)
    start = end - timedelta(days=days)
    history = history[(history.index >= start) & (history.index < end)]
    expected = pd.date_range(start, end - HOUR, freq="h")
    if not history.index.equals(expected) or history.isna().any():
        present = history.dropna().index
        missing = expected.difference(present)
        first = f", first {missing[0]:%Y-%m-%d %H:%M}" if len(missing) else ""
        raise HistoryGap(
            f"history for {target_day} is incomplete:"
            f" {len(missing)} of {len(expected)} periods missing{first}"
        )
    return history


def write_run(
    conn: psycopg.Connection,
    run: Run,
    *,
    run_type: RunType,
    code_version: str,
) -> None:
    """Replace the stored forecasts for the run's model, run type and day."""
    executed_at = datetime.now(UTC)
    with conn.transaction():
        conn.execute(
            "DELETE FROM forecast"
            " WHERE model = %s AND run_type = %s AND delivery_date = %s",
            (run.model, run_type, run.delivery_date),
        )
        with conn.cursor().copy(
            "COPY forecast (delivery_date, period_ordinal, resolution_minutes,"
            " model, run_type, price, model_version, code_version, executed_at)"
            " FROM STDIN"
        ) as copy:
            for ordinal, price in enumerate(run.prices, start=1):
                copy.write_row(
                    (
                        run.delivery_date,
                        ordinal,
                        RESOLUTION_MINUTES,
                        run.model,
                        run_type,
                        price,
                        run.model_version,
                        code_version,
                        executed_at,
                    )
                )


def run_days(
    conn: psycopg.Connection,
    model: Model,
    days: Iterable[date],
    provider: HistoryProvider,
    *,
    run_type: RunType,
    code_version: str,
) -> int:
    """The day loop: one forecast run per delivery day, each written as it
    finishes. The first run that cannot be made raises `ForecastRunFailed`,
    naming the model, the day and the step, and stops the loop."""
    runs = 0
    for day in days:
        try:
            run = run_forecast(model, day, provider)
        except Exception as error:
            raise ForecastRunFailed(model.slug, day, "forecast") from error
        try:
            write_run(conn, run, run_type=run_type, code_version=code_version)
        except Exception as error:
            raise ForecastRunFailed(model.slug, day, "write") from error
        runs += 1
        if (day.month, day.day) == (1, 1):
            log.info("%s: reached %s", model.slug, day)
    return runs


def current_code_version() -> str:
    """The git sha of the code producing a forecast (ADR-0005).

    `GITHUB_SHA` in Actions; otherwise the local checkout's `HEAD`, marked
    `-dirty` when the working tree has uncommitted changes, because a number
    produced by uncommitted code cannot be traced back to anything.
    """
    if sha := os.environ.get("GITHUB_SHA"):
        return sha
    git = ["git", "-C", os.path.dirname(__file__)]
    sha = subprocess.run(
        [*git, "rev-parse", "HEAD"], capture_output=True, text=True, check=True
    ).stdout.strip()
    dirty = subprocess.run(
        [*git, "status", "--porcelain"], capture_output=True, text=True, check=True
    ).stdout.strip()
    return f"{sha}-dirty" if dirty else sha
