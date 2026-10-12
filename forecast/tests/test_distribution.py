"""The observed price's distributions, on small in-memory records."""

from datetime import date, timedelta

import pandas as pd

from forecast.distribution import STATISTICS, daily, distribution, profile, trailing

MONDAY = date(2024, 1, 1)


def days(n: int) -> list[date]:
    return [MONDAY + timedelta(days=i) for i in range(n)]


def test_a_distribution_is_its_mean_and_seven_quantiles_to_the_cent() -> None:
    summary = distribution([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [1 / 3]])

    assert list(summary) == list(STATISTICS)
    assert {s: v[0] for s, v in summary.items()} == {
        "mean": 6.0,
        "min": 1.0,
        "p10": 2.0,
        "q1": 3.5,
        "median": 6.0,
        "q3": 8.5,
        "p90": 10.0,
        "max": 11.0,
    }
    assert {v[1] for v in summary.values()} == {0.33}


def test_an_empty_group_has_no_figures() -> None:
    summary = distribution([[], [-5.0]])

    assert all(v == [None, -5.0] for v in summary.values())


def test_daily_takes_each_days_own_periods() -> None:
    record = {d: [10.0 * i + h for h in range(24)] for i, d in enumerate(days(3))}

    summary = daily(record, days(3))

    assert summary["min"] == [0.0, 10.0, 20.0]
    assert summary["max"] == [23.0, 33.0, 43.0]


def test_trailing_waits_for_a_whole_span_and_skips_unscored_days() -> None:
    record = {d: [float(i)] * 24 for i, d in enumerate(days(5))}
    scored = [d for d in days(5) if d != days(5)[2]]

    summary = trailing(record, scored, days=3)

    # Day i's prices are all i, and day 2 was not scored.
    assert summary["min"] == [None, None, 1.0, 3.0]
    # The span ending on day 4 holds days 3 and 4 only.
    assert summary["mean"][-1] == 3.5


def test_a_profile_counts_each_period_once_across_models() -> None:
    rows = [
        (model, pd.Timestamp(d), ordinal, float(i * 100 + ordinal))
        for model in ("daylag", "chronos2")
        for i, d in enumerate(days(14))
        for ordinal in range(1, 25)
    ]
    scored = pd.DataFrame(
        rows, columns=["model", "delivery_date", "period_ordinal", "observed"]
    )

    by_weekday = profile(scored, "weekday")
    by_period = profile(scored, "period")

    # Mondays are days 0 and 7: means 12.5 and 712.5.
    assert by_weekday["mean"][0] == 362.5
    assert len(by_weekday["mean"]) == 7
    assert by_period["min"][0] == 1.0
    assert by_period["max"][23] == 1324.0
    assert len(by_period["mean"]) == 24
