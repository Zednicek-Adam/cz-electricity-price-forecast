"""Published metrics, the running metric and Diebold-Mariano, on small
in-memory records (seam 2).

Repaired observed prices and forecasts are made directly, with errors chosen
so every expected figure is arithmetic you can check by hand.
"""

import math
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import numpy as np
import pytest

from forecast.forecasts import RunType, StoredRun
from forecast.grid import RepairedPrice
from forecast.metrics import (
    ComparisonRow,
    DayFigure,
    MetricRow,
    model_comparisons,
    published_metrics,
    running,
    scored_forecasts,
    trailing,
)

DAY_1 = date(2024, 1, 31)
DAY_2 = date(2024, 2, 1)


class Record:
    """Repaired observed prices and forecast runs, and what they score to."""

    def __init__(self) -> None:
        self.observed: list[RepairedPrice] = []
        self.runs: list[StoredRun] = []
        self.metrics: list[MetricRow] = []
        self.comparisons: list[ComparisonRow] = []

    def observe(self, day: date, prices: list[float]) -> None:
        self.observed += [
            RepairedPrice(day, ordinal, Decimal(repr(float(price))))
            for ordinal, price in enumerate(prices, start=1)
        ]

    def forecast(
        self,
        model: str,
        day: date,
        prices: list[float],
        run_type: RunType = "backtest",
    ) -> None:
        self.runs.append(
            StoredRun(
                day,
                model,
                run_type,
                model,
                "test",
                datetime(2026, 1, 1, tzinfo=UTC),
                tuple(float(p) for p in prices),
            )
        )

    def rebuild(self) -> None:
        scored = scored_forecasts(self.runs, self.observed)
        self.metrics = published_metrics(scored)
        self.comparisons = model_comparisons(scored)


def metric(
    record: Record,
    model: str,
    name: str,
    scope_type: str = "delivery_day",
    scope_start: date = DAY_1,
) -> tuple[float, int] | None:
    for row in record.metrics:
        key = (row.model, row.scope_type, row.scope_start, row.metric)
        if key == (model, scope_type, scope_start, name):
            return row.value, row.n_forecasts
    return None


@pytest.fixture
def record() -> Record:
    return Record()


@pytest.fixture
def two_days(record: Record) -> Record:
    """Two days straddling a month end.

    Day 1: observed 10; `ar168` forecasts 12 (e = -2), the naïve 6 (e = 4).
    Day 2: observed 20; `ar168` forecasts 17 (e = 3), the naïve 28 (e = -8).
    """
    record.observe(DAY_1, [10.0] * 24)
    record.observe(DAY_2, [20.0] * 24)
    record.forecast("ar168", DAY_1, [12.0] * 24)
    record.forecast("daylag", DAY_1, [6.0] * 24)
    record.forecast("ar168", DAY_2, [17.0] * 24)
    record.forecast("daylag", DAY_2, [28.0] * 24)
    record.rebuild()
    return record


def test_each_metric_follows_its_formula_on_a_delivery_day(two_days: Record) -> None:
    assert metric(two_days, "ar168", "mae") == (2.0, 24)
    assert metric(two_days, "ar168", "rmse") == (2.0, 24)
    assert metric(two_days, "ar168", "smape") == pytest.approx((200 * 2 / 22, 24))
    assert metric(two_days, "ar168", "rmae") == (0.5, 24)


def test_a_wider_scope_pools_its_periods_rather_than_averaging_its_days(
    two_days: Record,
) -> None:
    # 24 periods at |e| = 2 and 24 at |e| = 3.
    assert metric(two_days, "ar168", "mae", "overall") == (2.5, 48)
    assert metric(two_days, "ar168", "rmse", "overall") == pytest.approx(
        (math.sqrt((4 + 9) / 2), 48)
    )
    assert metric(two_days, "ar168", "smape", "overall") == pytest.approx(
        (100 * (2 / 22 + 3 / 37), 48)
    )
    # rMAE over the whole record: sum of |e| over sum of the naïve's |e|, 5/12,
    # not the mean of the two daily ratios, (0.5 + 0.375) / 2.
    assert metric(two_days, "ar168", "rmae", "overall") == pytest.approx((5 / 12, 48))


def test_all_four_scopes_are_written_for_every_model(two_days: Record) -> None:
    scopes: dict[tuple, int] = {}
    for m in two_days.metrics:
        key = (m.model, m.scope_type, m.scope_start)
        scopes[key] = scopes.get(key, 0) + 1

    expected = {}
    for model in ("ar168", "daylag"):
        expected |= {
            (model, "delivery_day", DAY_1): 4,
            (model, "delivery_day", DAY_2): 4,
            (model, "month", date(2024, 1, 1)): 4,
            (model, "month", date(2024, 2, 1)): 4,
            (model, "overall", DAY_1): 4,
            (model, "year", date(2024, 1, 1)): 4,
        }
    assert scopes == expected


def test_the_overall_scope_starts_on_the_first_replayed_day_for_every_model(
    record: Record,
) -> None:
    record.observe(DAY_1, [10.0] * 24)
    record.observe(DAY_2, [20.0] * 24)
    record.forecast("daylag", DAY_1, [6.0] * 24)
    record.forecast("daylag", DAY_2, [28.0] * 24)
    record.forecast("ar168", DAY_2, [17.0] * 24)  # joins a day late
    record.rebuild()

    starts = {m.scope_start for m in record.metrics if m.scope_type == "overall"}
    assert starts == {DAY_1}
    # Its rMAE is still MAE over MAE on the whole scope: 3 / mean(4, 8).
    assert metric(record, "ar168", "rmae", "overall") == pytest.approx((3 / 6, 24))


def test_the_naive_rmae_is_exactly_one_everywhere(two_days: Record) -> None:
    values = {
        m.value for m in two_days.metrics if (m.model, m.metric) == ("daylag", "rmae")
    }

    assert values == {1.0}


def test_rmae_holds_on_a_flat_day_where_the_naive_nearly_vanishes(
    record: Record,
) -> None:
    record.observe(DAY_1, [50.0] * 24)
    record.forecast("daylag", DAY_1, [50.001] * 24)
    record.forecast("ar168", DAY_1, [50.5] * 24)
    record.rebuild()

    value, n = metric(record, "ar168", "rmae") or (None, None)
    assert value == pytest.approx(500.0, rel=1e-9)
    assert n == 24


def test_rmae_is_not_published_where_the_naive_was_exactly_right(
    record: Record,
) -> None:
    record.observe(DAY_1, [50.0] * 24)
    record.forecast("daylag", DAY_1, [50.0] * 24)
    record.forecast("ar168", DAY_1, [51.0] * 24)
    record.rebuild()

    assert metric(record, "ar168", "rmae") is None
    assert metric(record, "ar168", "mae") == (1.0, 24)


def test_smape_takes_zero_over_zero_as_zero(record: Record) -> None:
    # Half the day the price is exactly 0 and so is the forecast; the other
    # half is off by 10 against an observed 10.
    record.observe(DAY_1, [0.0] * 12 + [10.0] * 12)
    record.forecast("ar168", DAY_1, [0.0] * 12 + [20.0] * 12)
    record.rebuild()

    value, _ = metric(record, "ar168", "smape") or (None, None)
    assert value == pytest.approx(200 * (12 * 0 + 12 * (10 / 30)) / 24)


def test_backtest_and_live_are_pooled_into_one_record(record: Record) -> None:
    record.observe(DAY_1, [10.0] * 24)
    record.observe(DAY_2, [10.0] * 24)
    record.forecast("ar168", DAY_1, [12.0] * 24, run_type="backtest")
    record.forecast("ar168", DAY_2, [16.0] * 24, run_type="live")
    record.rebuild()

    assert metric(record, "ar168", "mae", "overall") == (4.0, 48)


def test_a_forecast_with_no_observed_price_yet_is_not_scored(
    record: Record,
) -> None:
    record.observe(DAY_1, [10.0] * 24)
    record.forecast("ar168", DAY_1, [12.0] * 24)
    record.forecast("ar168", DAY_2, [99.0] * 24)
    record.rebuild()

    assert metric(record, "ar168", "mae", "overall") == (2.0, 24)
    assert metric(record, "ar168", "mae", scope_start=DAY_2) is None


def test_the_rebuild_describes_exactly_the_models_in_the_record(
    two_days: Record,
) -> None:
    two_days.runs = [r for r in two_days.runs if r.model != "ar168"]

    two_days.rebuild()

    assert {m.model for m in two_days.metrics} == {"daylag"}
    assert two_days.comparisons == []


@pytest.fixture
def sixty_days(record: Record) -> Record:
    """Sixty days on which `ar168` is usually closer than the naïve."""
    rng = np.random.default_rng(7)
    for i in range(60):
        day = DAY_1 + timedelta(days=i)
        observed = 50 + 10 * rng.standard_normal(24)
        record.observe(day, list(observed))
        record.forecast("ar168", day, list(observed + 2 * rng.standard_normal(24)))
        record.forecast("daylag", day, list(observed + 8 * rng.standard_normal(24)))
    record.rebuild()
    return record


def dm(record: Record, a: str, b: str) -> dict[int, tuple[float, float]]:
    return {
        c.period_ordinal: (c.dm_statistic, c.p_value)
        for c in record.comparisons
        if (c.model_a, c.model_b) == (a, b)
    }


def test_the_dm_pair_is_antisymmetric_with_complementary_p_values(
    sixty_days: Record,
) -> None:
    forward = dm(sixty_days, "ar168", "daylag")
    backward = dm(sixty_days, "daylag", "ar168")

    assert sorted(forward) == list(range(1, 25))
    assert sorted(backward) == list(range(1, 25))
    for ordinal, (statistic, p_value) in forward.items():
        assert backward[ordinal][0] == pytest.approx(-statistic)
        assert backward[ordinal][1] == pytest.approx(1 - p_value)


def test_a_small_p_value_means_model_a_is_more_accurate(sixty_days: Record) -> None:
    forward = dm(sixty_days, "ar168", "daylag")

    assert all(statistic < 0 for statistic, _ in forward.values())
    assert all(p_value < 0.05 for _, p_value in forward.values())


def test_a_dm_test_that_cannot_be_computed_writes_no_row(record: Record) -> None:
    # Two models that are identical everywhere: the loss differential is zero,
    # its variance is zero, and the test has nothing to say.
    for i in range(10):
        day = DAY_1 + timedelta(days=i)
        record.observe(day, [float(i + o) for o in range(24)])
        record.forecast("ar168", day, [float(i)] * 24)
        record.forecast("daylag", day, [float(i)] * 24)
    record.rebuild()

    assert record.comparisons == []


# Forecast errors, and R's `forecast::dm.test(A, B, alternative = "less",
# h = h, power = 1)` on them, as printed by R 4.5.0. At h = 24 R's variance is
# negative and it falls back to h = 1, which the port must do too.
R_ERRORS_A = [
    -0.63, 0.18, -0.84, 1.6, 0.33, -0.82, 0.49, 0.74, 0.58, -0.31,
    1.51, 0.39, -0.62, -2.21, 1.12, -0.04, -0.02, 0.94, 0.82, 0.59,
    0.92, 0.78, 0.07, -1.99, 0.62, -0.06, -0.16, -1.47, -0.48, 0.42,
    1.36, -0.1, 0.39, -0.05, -1.38, -0.41, -0.39, -0.06, 1.1, 0.76,
]  # fmt: skip
R_ERRORS_B = [
    -0.25, -0.38, 1.05, 0.83, -1.03, -1.06, 0.55, 1.15, -0.17, 1.32,
    0.6, -0.92, 0.51, -1.69, 2.15, 2.97, -0.55, -1.57, 0.85, -0.2,
    3.6, -0.06, 1.03, 0.04, -1.11, 0.28, -2.71, 2.2, 0.23, 3.26,
    0.71, -1.06, 0.92, -1.4, -1.88, 0.44, -0.66, 0, 0.11, -0.88,
]  # fmt: skip
R_DM_TEST = {5: (-2.7823531618, 0.0041370431), 24: (-2.2319225999, 0.0157183102)}


def test_the_dm_test_reproduces_r(record: Record) -> None:
    # Observed 0 everywhere, so a forecast of -e has error e.
    for i, (a, b) in enumerate(zip(R_ERRORS_A, R_ERRORS_B, strict=True)):
        day = DAY_1 + timedelta(days=i)
        record.observe(day, [0.0] * 24)
        record.forecast("ar168", day, [-a] * 24)
        record.forecast("daylag", day, [-b] * 24)
    record.rebuild()

    forward = dm(record, "ar168", "daylag")
    for h, (statistic, p_value) in R_DM_TEST.items():
        assert forward[h] == pytest.approx((statistic, p_value), abs=1e-9)


DATES = [DAY_1 + timedelta(days=i) for i in range(3)]


def figures(values: list[tuple[float, int]]) -> list[DayFigure]:
    return [DayFigure(DATES[i], value, n) for i, (value, n) in enumerate(values)]


def test_the_running_metric_weights_each_day_by_its_periods() -> None:
    # A day of 23 scored periods and one of 24: the running MAE is the pooled
    # mean, not the mean of the two days.
    values = running("mae", DATES[:2], figures([(2.0, 23), (4.0, 24)]))

    assert values == [2.0, pytest.approx((2 * 23 + 4 * 24) / 47)]


def test_the_running_rmse_carries_squares() -> None:
    values = running("rmse", DATES[:2], figures([(3.0, 24), (4.0, 24)]))

    assert values == [3.0, pytest.approx(math.sqrt((9 + 16) / 2))]


def test_the_running_rmae_is_a_ratio_of_running_maes_not_a_mean_of_ratios() -> None:
    model = figures([(1.0, 24), (5.0, 24)])
    naive = figures([(0.01, 24), (10.0, 24)])  # a near-flat naïve day first

    values = running("rmae", DATES[:2], model, naive)

    assert values == [pytest.approx(100.0), pytest.approx(6 / 10.01)]


def test_the_running_metric_is_none_until_the_models_first_day() -> None:
    late = [DayFigure(DATES[1], 2.0, 24)]

    assert running("mae", DATES, late) == [None, 2.0, 2.0]


def window(values: list[float], n: int = 24) -> list[DayFigure]:
    first = DAY_1
    return [
        DayFigure(first + timedelta(days=i), value, n) for i, value in enumerate(values)
    ]


def test_the_trailing_metric_is_none_until_a_whole_window_fits() -> None:
    days = [DAY_1 + timedelta(days=i) for i in range(5)]

    values = trailing("mae", days, window([1, 2, 3, 4, 5]), days=3)

    assert values == [None, None, 2.0, 3.0, 4.0]


def test_the_trailing_rmse_pools_squares_inside_the_window() -> None:
    days = [DAY_1 + timedelta(days=i) for i in range(3)]

    values = trailing("rmse", days, window([9.0, 3.0, 4.0]), days=2)

    assert values == [
        None,
        pytest.approx(math.sqrt(45)),
        pytest.approx(math.sqrt(12.5)),
    ]


def test_the_trailing_rmae_is_a_ratio_of_windowed_maes() -> None:
    days = [DAY_1 + timedelta(days=i) for i in range(3)]
    model = window([1.0, 5.0, 3.0])
    naive = window([0.01, 10.0, 10.0])

    values = trailing("rmae", days, model, naive, days=2)

    assert values == [None, pytest.approx(6 / 10.01), pytest.approx(0.4)]


def test_the_trailing_window_counts_calendar_days_not_scored_days() -> None:
    # The third day is missing: the window ending on the fourth day holds the
    # fourth day alone, not the second as well.
    days = [DAY_1 + timedelta(days=i) for i in range(4)]
    holed = [f for f in window([1.0, 2.0, 99.0, 4.0]) if f.value != 99.0]

    values = trailing("mae", days, holed, days=2)

    assert values == [None, 1.5, 2.0, 4.0]
