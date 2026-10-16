"""The observed price's distribution over the same cuts the metrics take.

The price chart above the hero chart draws it (ADR-0019): per delivery day,
over each trailing span ending on a day, and in each bucket of a profile. A
distribution is summarised by its mean and seven quantiles, from the minimum
through the 10th, 25th, 50th, 75th and 90th percentiles to the maximum, linearly
interpolated as numpy's default. Like every figure on the dashboard it is
computed here, once per export, and the browser only draws it.

The prices are the repaired observed prices on scored delivery days, the
series the forecasts are scored against, so each cut holds exactly the
delivery periods its metrics pool.
"""

from collections.abc import Iterable, Mapping, Sequence
from datetime import date, timedelta

import numpy as np
import pandas as pd

from forecast.metrics import PERIOD, PROFILES

# statistic -> the quantile it is; `mean` is the one that is not.
QUANTILES = {
    "min": 0.0,
    "p10": 0.1,
    "q1": 0.25,
    "median": 0.5,
    "q3": 0.75,
    "p90": 0.9,
    "max": 1.0,
}
STATISTICS = ("mean", *QUANTILES)

Distribution = dict[str, list[float | None]]


def distribution(groups: Iterable[Sequence[float]]) -> Distribution:
    """Per statistic, one figure per group of prices, rounded to the cent;
    `None` where a group is empty."""
    summary: Distribution = {s: [] for s in STATISTICS}
    for group in groups:
        prices = np.asarray(group, dtype="float64")
        if prices.size == 0:
            for s in STATISTICS:
                summary[s].append(None)
            continue
        summary["mean"].append(round(float(prices.mean()), 2))
        quantiles = np.quantile(prices, list(QUANTILES.values()))
        for s, value in zip(QUANTILES, quantiles, strict=True):
            summary[s].append(round(float(value), 2))
    return summary


def daily(
    observed: Mapping[date, Sequence[float]], dates: Sequence[date]
) -> Distribution:
    """Each of `dates`' own delivery periods."""
    return distribution(observed[day] for day in dates)


def trailing(
    observed: Mapping[date, Sequence[float]], dates: Sequence[date], days: int
) -> Distribution:
    """On each of `dates`, the delivery periods of the scored days among the
    `days` calendar delivery days ending on it: the span a trailing metric
    covers. Empty, so `None`, until the span fits inside the record, as the
    trailing metric is."""
    scored = set(dates)

    def span(day: date) -> list[float]:
        start = day - timedelta(days=days - 1)
        if start < dates[0]:
            return []
        return [
            price
            for k in range(days)
            if (d := start + timedelta(days=k)) in scored
            for price in observed[d]
        ]

    return distribution(span(day) for day in dates)


def profile(scored: pd.DataFrame, by: str) -> Distribution:
    """In each bucket of a profile (ADR-0018), the delivery periods in
    `scored`: one figure per weekday from Monday, or per period ordinal from
    1. A period scored for several models counts once."""
    bucket, size = PROFILES[by]
    periods = scored.drop_duplicates(PERIOD)
    keys = bucket(periods).to_numpy()
    prices = periods["observed"].to_numpy()
    return distribution(prices[keys == i] for i in range(size))
