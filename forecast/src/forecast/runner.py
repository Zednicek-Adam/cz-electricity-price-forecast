"""The runner: everything a model is not allowed to touch (ADR-0002).

It owns the day loop, the cutoff slicing and the check that the history a model
needs is complete. A forecast run is one model for one delivery day, producing
24 forecasts.

**The cutoff** (`forecast.model.cutoff`) is derived from the target delivery
day and never passed in. The runner slices the history at it, whatever it was
handed: the whole repaired record, read once.

**Failure is loud.** A run whose required history has a gap raises
`HistoryGap` and writes nothing: no forward-fill, no interpolation, no
nearest-neighbour substitution. A missing day on the scoreboard is honest; a
fabricated one is not.

Writing is the caller's: the replay and the daily run turn runs into rows of
`data/forecasts.csv` (`forecast.forecasts`).
"""

import logging
import math
import os
import subprocess
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

import pandas as pd

from forecast.forecasts import RunType, StoredRun
from forecast.grid import HOUR, REPAIRED_PERIODS_PER_DAY
from forecast.model import Model, cutoff

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

    def stored(
        self, *, run_type: RunType, code_version: str, executed_at: datetime
    ) -> StoredRun:
        """The run as a row of the forecast record."""
        return StoredRun(
            delivery_date=self.delivery_date,
            model=self.model,
            run_type=run_type,
            model_version=self.model_version,
            code_version=code_version,
            executed_at=executed_at,
            prices=self.prices,
        )


def run_forecast(model: Model, target_day: date, history: pd.Series) -> Run:
    """One forecast run: slice history at the cutoff, check it, call the model.

    The model receives a copy of exactly the whole days it asked for, ending at
    the cutoff, so nothing it does can reach the record or data from the target
    day onward.
    """
    history = _required_history(history, target_day, model.history_days)

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


def run_days(
    model: Model,
    days: Iterable[date],
    history: pd.Series,
    *,
    run_type: RunType,
    code_version: str,
) -> Iterable[StoredRun]:
    """The day loop: one forecast run per delivery day, yielded as each one
    finishes. The first run that cannot be made raises `ForecastRunFailed`,
    naming the model and the day, and stops the loop."""
    for day in days:
        try:
            run = run_forecast(model, day, history)
        except Exception as error:
            raise ForecastRunFailed(model.slug, day, "forecast") from error
        yield run.stored(
            run_type=run_type,
            code_version=code_version,
            executed_at=datetime.now(UTC).replace(microsecond=0),
        )
        if (day.month, day.day) == (1, 1):
            log.info("%s: reached %s", model.slug, day)


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
