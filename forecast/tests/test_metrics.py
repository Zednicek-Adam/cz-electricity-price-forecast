"""Published metrics and Diebold-Mariano, asserted on stored rows (seam 2).

Repaired observed prices and forecasts are seeded directly, with errors chosen
so every expected figure is arithmetic you can check by hand; the rebuild runs
as `app_writer`, and every assertion reads what it stored.
"""

import math
from datetime import date, timedelta

import numpy as np
import psycopg
import pytest

from forecast.metrics import rebuild_derived_rows

DAY_1 = date(2024, 1, 31)
DAY_2 = date(2024, 2, 1)


def seed_observed(conn: psycopg.Connection, day: date, prices: list[float]) -> None:
    with conn.cursor().copy(
        "COPY repaired_observed_price (delivery_date, period_ordinal,"
        " resolution_minutes, price) FROM STDIN"
    ) as copy:
        for ordinal, price in enumerate(prices, start=1):
            copy.write_row((day, ordinal, 60, price))


def seed_forecast(
    conn: psycopg.Connection,
    model: str,
    day: date,
    prices: list[float],
    run_type: str = "backtest",
) -> None:
    with conn.cursor().copy(
        "COPY forecast (delivery_date, period_ordinal, resolution_minutes, model,"
        " run_type, price, model_version, code_version, executed_at) FROM STDIN"
    ) as copy:
        for ordinal, price in enumerate(prices, start=1):
            copy.write_row(
                (day, ordinal, 60, model, run_type, price, model, "test", "now")
            )


def rebuild(conn: psycopg.Connection) -> None:
    conn.execute("SET LOCAL ROLE app_writer")
    rebuild_derived_rows(conn)
    conn.execute("RESET ROLE")


def metric(
    conn: psycopg.Connection,
    model: str,
    name: str,
    scope_type: str = "delivery_day",
    scope_start: date = DAY_1,
    run_type: str = "backtest",
) -> tuple[float, int] | None:
    row = conn.execute(
        "SELECT value, n_forecasts FROM published_metric WHERE model = %s"
        " AND run_type = %s AND scope_type = %s AND scope_start = %s"
        " AND metric = %s",
        (model, run_type, scope_type, scope_start, name),
    ).fetchone()
    return None if row is None else (float(row[0]), row[1])


@pytest.fixture
def two_days(db: psycopg.Connection) -> psycopg.Connection:
    """Two days straddling a month end.

    Day 1: observed 10; `ar168` forecasts 12 (e = -2), the naïve 6 (e = 4).
    Day 2: observed 20; `ar168` forecasts 17 (e = 3), the naïve 28 (e = -8).
    """
    seed_observed(db, DAY_1, [10.0] * 24)
    seed_observed(db, DAY_2, [20.0] * 24)
    seed_forecast(db, "ar168", DAY_1, [12.0] * 24)
    seed_forecast(db, "daylag", DAY_1, [6.0] * 24)
    seed_forecast(db, "ar168", DAY_2, [17.0] * 24)
    seed_forecast(db, "daylag", DAY_2, [28.0] * 24)
    rebuild(db)
    return db


def test_each_metric_follows_its_formula_on_a_delivery_day(
    two_days: psycopg.Connection,
) -> None:
    assert metric(two_days, "ar168", "mae") == (2.0, 24)
    assert metric(two_days, "ar168", "rmse") == (2.0, 24)
    assert metric(two_days, "ar168", "smape") == pytest.approx((200 * 2 / 22, 24))
    assert metric(two_days, "ar168", "rmae") == (0.5, 24)


def test_a_wider_scope_pools_its_periods_rather_than_averaging_its_days(
    two_days: psycopg.Connection,
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


def test_all_four_scopes_are_written_for_every_model(
    two_days: psycopg.Connection,
) -> None:
    rows = two_days.execute(
        "SELECT model, scope_type, scope_start, count(*) FROM published_metric"
        " GROUP BY 1, 2, 3 ORDER BY 1, 2, 3"
    ).fetchall()

    expected = []
    for model in ("ar168", "daylag"):
        expected += [
            (model, "delivery_day", DAY_1, 4),
            (model, "delivery_day", DAY_2, 4),
            (model, "month", date(2024, 1, 1), 4),
            (model, "month", date(2024, 2, 1), 4),
            (model, "overall", DAY_1, 4),
            (model, "year", date(2024, 1, 1), 4),
        ]
    assert rows == expected


def test_the_naive_rmae_is_exactly_one_everywhere(
    two_days: psycopg.Connection,
) -> None:
    values = two_days.execute(
        "SELECT DISTINCT value FROM published_metric"
        " WHERE model = 'daylag' AND metric = 'rmae'"
    ).fetchall()

    assert values == [(1,)]


def test_rmae_holds_on_a_flat_day_where_the_naive_nearly_vanishes(
    db: psycopg.Connection,
) -> None:
    seed_observed(db, DAY_1, [50.0] * 24)
    seed_forecast(db, "daylag", DAY_1, [50.001] * 24)
    seed_forecast(db, "ar168", DAY_1, [50.5] * 24)
    rebuild(db)

    value, n = metric(db, "ar168", "rmae")
    assert value == pytest.approx(500.0, rel=1e-9)
    assert n == 24


def test_rmae_is_not_written_where_the_naive_was_exactly_right(
    db: psycopg.Connection,
) -> None:
    seed_observed(db, DAY_1, [50.0] * 24)
    seed_forecast(db, "daylag", DAY_1, [50.0] * 24)
    seed_forecast(db, "ar168", DAY_1, [51.0] * 24)
    rebuild(db)

    assert metric(db, "ar168", "rmae") is None
    assert metric(db, "ar168", "mae") == (1.0, 24)


def test_smape_takes_zero_over_zero_as_zero(db: psycopg.Connection) -> None:
    # Half the day the price is exactly 0 and so is the forecast; the other
    # half is off by 10 against an observed 10.
    seed_observed(db, DAY_1, [0.0] * 12 + [10.0] * 12)
    seed_forecast(db, "ar168", DAY_1, [0.0] * 12 + [20.0] * 12)
    rebuild(db)

    value, _ = metric(db, "ar168", "smape")
    assert value == pytest.approx(200 * (12 * 0 + 12 * (10 / 30)) / 24)


def test_backtest_and_live_are_never_pooled(db: psycopg.Connection) -> None:
    seed_observed(db, DAY_1, [10.0] * 24)
    seed_forecast(db, "ar168", DAY_1, [12.0] * 24, run_type="backtest")
    seed_forecast(db, "ar168", DAY_1, [16.0] * 24, run_type="live")
    rebuild(db)

    assert metric(db, "ar168", "mae", run_type="backtest") == (2.0, 24)
    assert metric(db, "ar168", "mae", run_type="live") == (6.0, 24)


def test_a_forecast_with_no_observed_price_yet_is_not_scored(
    db: psycopg.Connection,
) -> None:
    seed_observed(db, DAY_1, [10.0] * 24)
    seed_forecast(db, "ar168", DAY_1, [12.0] * 24)
    seed_forecast(db, "ar168", DAY_2, [99.0] * 24)
    rebuild(db)

    assert metric(db, "ar168", "mae", "overall") == (2.0, 24)
    assert metric(db, "ar168", "mae", scope_start=DAY_2) is None


def test_the_rebuild_leaves_no_row_describing_a_forecast_that_no_longer_exists(
    two_days: psycopg.Connection,
) -> None:
    two_days.execute(
        "INSERT INTO published_metric VALUES"
        " ('ghost', 'backtest', 'overall', '2020-01-01', 'mae', 1, 1, now())"
    )
    two_days.execute("DELETE FROM forecast WHERE model = 'ar168'")

    rebuild(two_days)

    models = two_days.execute(
        "SELECT DISTINCT model FROM published_metric"
        " UNION SELECT model_a FROM model_comparison"
        " UNION SELECT model_b FROM model_comparison"
    ).fetchall()
    assert models == [("daylag",)]


def test_the_rebuild_is_one_transaction(two_days: psycopg.Connection) -> None:
    before = two_days.execute(
        "SELECT * FROM published_metric ORDER BY 1, 2, 3, 4, 5"
    ).fetchall()
    two_days.execute("UPDATE forecast SET price = price + 1")
    two_days.execute(
        "CREATE FUNCTION pg_temp.refuse() RETURNS trigger LANGUAGE plpgsql AS"
        " $$ BEGIN RAISE EXCEPTION 'refused'; END $$"
    )
    two_days.execute(
        "CREATE TRIGGER refuse BEFORE INSERT ON model_comparison"
        " FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse()"
    )

    with pytest.raises(psycopg.errors.RaiseException):
        rebuild(two_days)

    two_days.execute("RESET ROLE")
    after = two_days.execute(
        "SELECT * FROM published_metric ORDER BY 1, 2, 3, 4, 5"
    ).fetchall()
    assert after == before


@pytest.fixture
def sixty_days(db: psycopg.Connection) -> psycopg.Connection:
    """Sixty days on which `ar168` is usually closer than the naïve."""
    rng = np.random.default_rng(7)
    for i in range(60):
        day = DAY_1 + timedelta(days=i)
        observed = 50 + 10 * rng.standard_normal(24)
        seed_observed(db, day, list(observed))
        seed_forecast(db, "ar168", day, list(observed + 2 * rng.standard_normal(24)))
        seed_forecast(db, "daylag", day, list(observed + 8 * rng.standard_normal(24)))
    rebuild(db)
    return db


def dm(conn: psycopg.Connection, a: str, b: str) -> dict[int, tuple[float, float]]:
    rows = conn.execute(
        "SELECT period_ordinal, dm_statistic, p_value FROM model_comparison"
        " WHERE model_a = %s AND model_b = %s AND run_type = 'backtest'"
        " AND resolution_minutes = 60",
        (a, b),
    ).fetchall()
    return {o: (float(s), float(p)) for o, s, p in rows}


def test_the_dm_pair_is_antisymmetric_with_complementary_p_values(
    sixty_days: psycopg.Connection,
) -> None:
    forward = dm(sixty_days, "ar168", "daylag")
    backward = dm(sixty_days, "daylag", "ar168")

    assert sorted(forward) == list(range(1, 25))
    assert sorted(backward) == list(range(1, 25))
    for ordinal, (statistic, p_value) in forward.items():
        assert backward[ordinal][0] == pytest.approx(-statistic)
        assert backward[ordinal][1] == pytest.approx(1 - p_value)
        assert backward[ordinal][1] != pytest.approx(-p_value)


def test_a_small_p_value_means_model_a_is_more_accurate(
    sixty_days: psycopg.Connection,
) -> None:
    forward = dm(sixty_days, "ar168", "daylag")

    assert all(statistic < 0 for statistic, _ in forward.values())
    assert all(p_value < 0.05 for _, p_value in forward.values())


def test_a_dm_test_that_cannot_be_computed_writes_no_row(
    db: psycopg.Connection,
) -> None:
    # Two models that are identical everywhere: the loss differential is zero,
    # its variance is zero, and the test has nothing to say.
    for i in range(10):
        day = DAY_1 + timedelta(days=i)
        seed_observed(db, day, [float(i + o) for o in range(24)])
        seed_forecast(db, "ar168", day, [float(i)] * 24)
        seed_forecast(db, "daylag", day, [float(i)] * 24)
    rebuild(db)

    assert db.execute("SELECT count(*) FROM model_comparison").fetchone() == (0,)


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


def test_the_dm_test_reproduces_r(db: psycopg.Connection) -> None:
    # Observed 0 everywhere, so a forecast of -e has error e.
    for i, (a, b) in enumerate(zip(R_ERRORS_A, R_ERRORS_B, strict=True)):
        day = DAY_1 + timedelta(days=i)
        seed_observed(db, day, [0.0] * 24)
        seed_forecast(db, "ar168", day, [-a] * 24)
        seed_forecast(db, "daylag", day, [-b] * 24)
    rebuild(db)

    forward = dm(db, "ar168", "daylag")
    for h, (statistic, p_value) in R_DM_TEST.items():
        assert forward[h] == pytest.approx((statistic, p_value), abs=1e-9)
