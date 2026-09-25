"""Seam 2: forecast runs against a real Postgres, asserted on stored rows.

The store holds a short synthetic record written by the real loader, spanning
the 2024 spring-forward day; every price is distinct, so a forecast shows
exactly which stored price it came from. Runs are written as `app_writer`.
"""

import re
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pandas as pd
import psycopg
import pytest

from forecast.grid import true_periods
from forecast.history import StoredHistory
from forecast.loader import ObservedPrice, Provenance, load_observed_prices
from forecast.models.daylag import DayLagNaive
from forecast.runner import (
    HistoryGap,
    Run,
    current_code_version,
    run_forecast,
    write_run,
)

FIRST_DAY = date(2024, 3, 25)
LAST_DAY = date(2024, 4, 5)
TARGET = date(2024, 4, 2)


def synthetic_price(day: date, index: int) -> Decimal:
    """Distinct per period: the day of month, then the period's position."""
    return Decimal(f"{day.day}.{index:02d}")


@pytest.fixture
def writer(db: psycopg.Connection) -> psycopg.Connection:
    days = [FIRST_DAY + timedelta(days=i) for i in range((LAST_DAY - FIRST_DAY).days)]
    prices = [
        ObservedPrice(start, 60, synthetic_price(day, i))
        for day in days
        for i, start in enumerate(true_periods(day))
    ]
    db.execute("SET LOCAL ROLE app_writer")
    load_observed_prices(db, prices, Provenance("test", datetime.now(UTC)))
    return db


def stored_forecast(conn: psycopg.Connection, day: date = TARGET) -> list[tuple]:
    return conn.execute(
        "SELECT period_ordinal, price, model, run_type, model_version, code_version"
        " FROM forecast WHERE delivery_date = %s ORDER BY period_ordinal",
        (day,),
    ).fetchall()


class Recorder:
    """A model that remembers the history it was handed."""

    slug = "recorder"
    version = "recorder"
    history_days = 3

    def __init__(self) -> None:
        self.seen: pd.Series | None = None

    def forecast(self, history: pd.Series, target_day: date) -> list[float]:
        self.seen = history
        return [0.0] * 24


def test_a_run_is_written_as_24_rows_carrying_its_versions(
    writer: psycopg.Connection,
) -> None:
    run = run_forecast(DayLagNaive(), TARGET, StoredHistory(writer))
    write_run(writer, run, run_type="backtest", code_version="abc123")

    rows = stored_forecast(writer)
    assert [r[0] for r in rows] == list(range(1, 25))
    assert [r[1] for r in rows] == [
        synthetic_price(date(2024, 4, 1), i) for i in range(24)
    ]
    assert {r[2:] for r in rows} == {("daylag", "backtest", "daylag-d1", "abc123")}


def test_the_cutoff_excludes_every_period_from_the_target_day_onward(
    writer: psycopg.Connection,
) -> None:
    model = Recorder()
    run_forecast(model, TARGET, StoredHistory(writer))

    assert model.seen is not None
    assert model.seen.index[0] == datetime(2024, 3, 30, 0)
    assert model.seen.index[-1] == datetime(2024, 4, 1, 23)
    assert len(model.seen) == 3 * 24


def test_a_gap_in_the_required_history_raises_and_writes_nothing(
    writer: psycopg.Connection,
) -> None:
    writer.execute("RESET ROLE")
    writer.execute(
        "DELETE FROM repaired_observed_price"
        " WHERE delivery_date = %s AND period_ordinal = 7",
        (TARGET - timedelta(days=1),),
    )

    with pytest.raises(HistoryGap):
        run = run_forecast(DayLagNaive(), TARGET, StoredHistory(writer))
        write_run(writer, run, run_type="backtest", code_version="abc123")

    assert stored_forecast(writer) == []


def test_history_before_the_record_begins_is_a_gap(writer: psycopg.Connection) -> None:
    with pytest.raises(HistoryGap):
        run_forecast(DayLagNaive(), FIRST_DAY, StoredHistory(writer))


def test_a_rerun_deletes_and_reinserts_rather_than_upserting(
    writer: psycopg.Connection,
) -> None:
    run = run_forecast(DayLagNaive(), TARGET, StoredHistory(writer))
    write_run(writer, run, run_type="backtest", code_version="first")
    writer.execute("RESET ROLE")
    writer.execute(
        "INSERT INTO forecast VALUES (%s, 25, 60, 'daylag', 'backtest', 1,"
        " 'daylag-d1', 'first', now())",
        (TARGET,),
    )
    writer.execute("SET LOCAL ROLE app_writer")  # which holds no UPDATE at all

    write_run(writer, run, run_type="backtest", code_version="second")

    rows = stored_forecast(writer)
    assert [r[0] for r in rows] == list(range(1, 25))
    assert {r[5] for r in rows} == {"second"}


def test_a_rerun_leaves_other_models_run_types_and_days_alone(
    writer: psycopg.Connection,
) -> None:
    run = run_forecast(DayLagNaive(), TARGET, StoredHistory(writer))
    other_day = run_forecast(
        DayLagNaive(), TARGET + timedelta(days=1), StoredHistory(writer)
    )
    other_model = Run("ar168", "x", TARGET, run.prices)
    for r in (run, other_day, other_model):
        write_run(writer, r, run_type="backtest", code_version="first")
    write_run(writer, run, run_type="live", code_version="first")

    write_run(writer, run, run_type="backtest", code_version="second")

    counts = writer.execute(
        "SELECT model, run_type, delivery_date, code_version, count(*) FROM forecast"
        " GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3"
    ).fetchall()
    assert counts == [
        ("ar168", "backtest", TARGET, "first", 24),
        ("daylag", "backtest", TARGET, "second", 24),
        ("daylag", "backtest", TARGET + timedelta(days=1), "first", 24),
        ("daylag", "live", TARGET, "first", 24),
    ]


def test_a_crash_mid_write_leaves_the_previous_run_whole(
    writer: psycopg.Connection,
) -> None:
    run = run_forecast(DayLagNaive(), TARGET, StoredHistory(writer))
    write_run(writer, run, run_type="backtest", code_version="first")
    writer.execute("RESET ROLE")
    writer.execute(
        "CREATE FUNCTION pg_temp.crash() RETURNS trigger LANGUAGE plpgsql AS"
        " $$ BEGIN IF NEW.period_ordinal = 13 THEN RAISE EXCEPTION 'crash';"
        " END IF; RETURN NEW; END $$"
    )
    writer.execute(
        "CREATE TRIGGER crash BEFORE INSERT ON forecast"
        " FOR EACH ROW EXECUTE FUNCTION pg_temp.crash()"
    )
    writer.execute("SET LOCAL ROLE app_writer")

    with pytest.raises(psycopg.errors.RaiseException):
        write_run(writer, run, run_type="backtest", code_version="second")

    rows = stored_forecast(writer)
    assert len(rows) == 24
    assert {r[5] for r in rows} == {"first"}


def test_the_code_version_is_a_git_sha() -> None:
    assert re.fullmatch(r"[0-9a-f]{40}(-dirty)?", current_code_version())
