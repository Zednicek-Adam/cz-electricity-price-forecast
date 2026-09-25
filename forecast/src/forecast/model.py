"""The model interface: ADR-0002's pure-function seam, as ADR-0003 shapes it.

A model is an object. Construction does its setup once; then

    model.forecast(history, target_day) -> 24 floats

is called per delivery day and holds no store handle, no provider and no clock.
Its only access to data is its argument, so a forecast run cannot read past its
cutoff: look-ahead is unreachable rather than forbidden.

**History** is the repaired observed prices as of the cutoff, as a float
`pandas.Series` on the regular 24-period grid. Its index is a gapless hourly
`DatetimeIndex` of market labels (`forecast.grid.market_label`). The runner
guarantees it ends at the last period before the cutoff and is complete over
the `history_days` the model asks for.

**The cutoff** is part of the contract, so it is defined here: every delivery
period starting strictly before the target delivery day begins in
`Europe/Prague`. On the repaired grid, every label before the target day's
midnight. Whole days in, whole days out.
"""

from collections.abc import Sequence
from datetime import date, datetime
from typing import Protocol

import pandas as pd

from forecast.grid import REPAIRED_PERIODS_PER_DAY, market_label


class Model(Protocol):
    slug: str
    """How a stored row names the model. The roster is fixed in CONTEXT.md."""

    version: str
    """`model_version` on every forecast row: a specification string, or a
    pinned revision for a downloaded artifact (ADR-0005)."""

    history_days: int
    """Whole delivery days of history the model needs before its target day."""

    def forecast(self, history: pd.Series, target_day: date) -> list[float]: ...


def cutoff(target_day: date) -> datetime:
    """The first market label a forecast run for `target_day` may not see."""
    return market_label(target_day, 1)


def day_labels(day: date) -> pd.DatetimeIndex:
    """The 24 market labels of a delivery day on the repaired grid."""
    return pd.date_range(
        market_label(day, 1), periods=REPAIRED_PERIODS_PER_DAY, freq="h"
    )


def history_series(labels: Sequence[datetime], prices: Sequence[float]) -> pd.Series:
    """Repaired observed prices in the shape a model is handed."""
    return pd.Series(
        prices, index=pd.DatetimeIndex(labels), dtype="float64", name="price"
    )
