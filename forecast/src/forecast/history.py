"""History providers: the adapter half of ADR-0002's seam.

    provider : target_day -> history-as-of-cutoff

A provider is the only thing the live cutover changes: v1 reads the stored
repaired observed prices; the live branch swaps in a feed. The model never sees
a provider — the runner calls it and hands the model a value.
"""

from datetime import date, datetime, timedelta
from typing import Protocol

import pandas as pd
import psycopg

RESOLUTION_MINUTES = 60


class HistoryProvider(Protocol):
    def __call__(self, target_day: date) -> pd.Series: ...


def label(day: date, period_ordinal: int) -> datetime:
    """The market label of a period on the repaired grid (see forecast.model)."""
    return datetime(day.year, day.month, day.day) + timedelta(hours=period_ordinal - 1)


class StoredHistory:
    """The repaired observed prices, read from the store once.

    The whole series is ~61k rows, so reading it at construction and slicing it
    per target day costs one query per replay rather than one per forecast run.
    It returns everything before the cutoff; the runner trims and checks it.
    """

    def __init__(self, conn: psycopg.Connection) -> None:
        rows = conn.execute(
            "SELECT delivery_date, period_ordinal, price"
            " FROM repaired_observed_price WHERE resolution_minutes = %s"
            " ORDER BY delivery_date, period_ordinal",
            (RESOLUTION_MINUTES,),
        ).fetchall()
        self._series = pd.Series(
            [float(price) for _, _, price in rows],
            index=pd.DatetimeIndex([label(d, o) for d, o, _ in rows]),
            dtype="float64",
            name="price",
        )

    def __call__(self, target_day: date) -> pd.Series:
        cutoff = datetime(target_day.year, target_day.month, target_day.day)
        return self._series[self._series.index < cutoff].copy()
