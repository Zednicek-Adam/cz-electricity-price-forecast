"""The model interface: ADR-0002's pure-function seam, as ADR-0003 shapes it.

A model is an object. Construction does its setup once; then

    model.forecast(history, target_day) -> 24 floats

is called per delivery day and holds no store handle, no provider and no clock.
Its only access to data is its argument, so a forecast run cannot read past its
cutoff: look-ahead is unreachable rather than forbidden.

**History** is the repaired observed price series as of the cutoff, as a float
`pandas.Series` on the regular 24-period grid. Its index is a naive, gapless
hourly `DatetimeIndex` of *market labels*: a delivery day plus its period
ordinal minus one hour. A label is a coordinate on the repaired grid, never an
instant — on a spring-forward day the label 02:00 names a period that exists
only after grid repair (ADR-0001, ADR-0002). The runner guarantees the series
ends at the last period of the day before `target_day` and is complete over
the `history_days` the model asks for.
"""

from datetime import date, datetime, timedelta
from typing import Protocol

import pandas as pd

PERIODS = 24
HOUR = timedelta(hours=1)


class Model(Protocol):
    slug: str
    """How a stored row names the model. The roster is fixed in CONTEXT.md."""

    version: str
    """`model_version` on every forecast row: a specification string, or a
    pinned revision for a downloaded artifact (ADR-0005)."""

    history_days: int
    """Whole delivery days of history the model needs before its target day."""

    def forecast(self, history: pd.Series, target_day: date) -> list[float]: ...


def day_labels(day: date) -> pd.DatetimeIndex:
    """The 24 market labels of a delivery day on the repaired grid."""
    start = datetime(day.year, day.month, day.day)
    return pd.date_range(start, periods=PERIODS, freq="h")
