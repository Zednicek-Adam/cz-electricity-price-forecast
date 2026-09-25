"""The day-lag naïve: the benchmark every accuracy claim is measured against.

Each period ordinal gets the observed price of the same period ordinal on the
previous delivery day. It is a lookup, and it is also the v1 placeholder, so the
system is built end to end with nothing outstanding in the model layer
(ADR-0003). Its rMAE is exactly 1 by construction.

Deliberately not the seasonal naïve of the forecasting literature; see the
day-lag naïve entry in CONTEXT.md for what that costs.
"""

from datetime import date, timedelta

import pandas as pd

from forecast.model import day_labels


class DayLagNaive:
    slug = "daylag"
    version = "daylag-d1"
    history_days = 1

    def forecast(self, history: pd.Series, target_day: date) -> list[float]:
        yesterday = history.reindex(day_labels(target_day - timedelta(days=1)))
        if yesterday.isna().any():
            raise ValueError(f"no complete day before {target_day} in history")
        return [float(price) for price in yesterday]
