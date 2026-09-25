"""The runner: everything a model is not allowed to touch (ADR-0002).

It owns the cutoff slicing, the check that the history a model needs is
complete, and the writing. A forecast run is one model for one delivery day,
producing 24 forecasts.

**The cutoff** is derived from the target delivery day and never passed in:
every delivery period starting strictly before the target delivery day begins
in `Europe/Prague`. On the repaired grid that is every label before the target
day's midnight. Whole days in, whole days out.

**Failure is loud.** A run whose required history has a gap raises
`HistoryGap` and writes nothing: no forward-fill, no interpolation, no
nearest-neighbour substitution. A missing day on the scoreboard is honest; a
fabricated one is not.

**A re-run replaces.** Writing a run deletes the stored
`(model, run_type, delivery_date)` rows and inserts 24 new ones in one
transaction, all or nothing. Never an upsert: the writer role holds no `UPDATE`.
"""

import math
import os
import subprocess
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Literal

import pandas as pd
import psycopg

from forecast.history import RESOLUTION_MINUTES, HistoryProvider
from forecast.model import HOUR, PERIODS, Model

RunType = Literal["backtest", "live"]


class HistoryGap(ValueError):
    """The history a forecast run needs is incomplete."""


class InvalidForecast(ValueError):
    """A model returned something other than 24 finite numbers."""


@dataclass(frozen=True)
class Run:
    model: str
    model_version: str
    delivery_date: date
    prices: tuple[float, ...]


def cutoff(target_day: date) -> datetime:
    """The first market label a run for `target_day` may not see."""
    return datetime(target_day.year, target_day.month, target_day.day)


def run_forecast(model: Model, target_day: date, provider: HistoryProvider) -> Run:
    """One forecast run: slice history at the cutoff, check it, call the model.

    The model receives a copy of exactly the whole days it asked for, ending at
    the cutoff, so nothing it does can reach the provider, the store or data
    from the target day onward.
    """
    end = cutoff(target_day)
    start = end - timedelta(days=model.history_days)
    history = provider(target_day)
    history = history[(history.index >= start) & (history.index < end)]
    _check_complete(history, start, end, target_day)

    prices = model.forecast(history.copy(), target_day)
    if len(prices) != PERIODS or not all(
        isinstance(p, float) and math.isfinite(p) for p in prices
    ):
        raise InvalidForecast(
            f"{model.slug} for {target_day}: expected {PERIODS} finite floats"
        )
    return Run(model.slug, model.version, target_day, tuple(prices))


def _check_complete(
    history: pd.Series, start: datetime, end: datetime, target_day: date
) -> None:
    expected = pd.date_range(start, end - HOUR, freq="h")
    if not history.index.equals(expected) or history.isna().any():
        present = history.dropna().index
        missing = expected.difference(present)
        first = f", first {missing[0]:%Y-%m-%d %H:%M}" if len(missing) else ""
        raise HistoryGap(
            f"history for {target_day} is incomplete:"
            f" {len(missing)} of {len(expected)} periods missing{first}"
        )


def write_run(
    conn: psycopg.Connection,
    run: Run,
    *,
    run_type: RunType,
    code_version: str,
    executed_at: datetime | None = None,
) -> None:
    """Replace the stored forecasts for the run's model, run type and day."""
    executed_at = executed_at or datetime.now(UTC)
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


def code_version() -> str:
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
