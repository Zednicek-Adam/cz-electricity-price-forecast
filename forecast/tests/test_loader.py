"""The loader and grid repair, asserted on stored rows in a real Postgres.

The loader runs as `app_writer` here, so these tests also prove the writer's
grants are enough to load the record, and no more than that is needed.
"""

import hashlib
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import psycopg
import pytest

from forecast.grid import IncompleteDeliveryDay
from forecast.loader import (
    FROZEN_RETRIEVED_AT,
    FROZEN_SOURCE,
    ConflictingObservedPrice,
    ObservedPrice,
    load_frozen_dataset,
    load_observed_prices,
)

# SHA-256 of the thesis's repaired series, `epf-diploma/sources/CZ.csv`, which
# is private: one line per row, `<date>,<el_price>`, joined by newlines, with
# each price quantized to three decimals. The thesis averaged in floating
# point, so a repaired value such as 19.37 is stored there as
# 19.369999999999997; the mean of two prices published to two decimals has at
# most three, so quantizing to 0.001 removes that noise and nothing else.
THESIS_CZ_CSV_SHA256 = (
    "608edbcf12b4b61e6a7005625073c7de0774e76ec0027f056845e599b5412cc3"
)


@pytest.fixture
def writer(db: psycopg.Connection) -> psycopg.Connection:
    db.execute("SET LOCAL ROLE app_writer")
    return db


def local_label(day: date, period_ordinal: int) -> datetime:
    """The thesis's naive wall-clock label for a repaired period."""
    return datetime.combine(day, datetime.min.time()) + timedelta(
        hours=period_ordinal - 1
    )


def count(conn: psycopg.Connection, table: str) -> int:
    (n,) = conn.execute(f"SELECT count(*) FROM {table}").fetchone()
    return n


def test_every_period_of_the_frozen_dataset_is_stored_with_its_provenance(
    writer: psycopg.Connection,
) -> None:
    load_frozen_dataset(writer)

    assert count(writer, "observed_price") == 61_368
    assert writer.execute(
        "SELECT DISTINCT source, retrieved_at, resolution_minutes FROM observed_price"
    ).fetchall() == [(FROZEN_SOURCE, FROZEN_RETRIEVED_AT, 60)]
    assert writer.execute(
        "SELECT min(delivery_start), max(delivery_start) FROM observed_price"
    ).fetchone() == (
        datetime(2017, 12, 31, 23, tzinfo=UTC),
        datetime(2024, 12, 31, 22, tzinfo=UTC),
    )


def test_the_repaired_series_reproduces_the_thesis_exactly(
    writer: psycopg.Connection,
) -> None:
    load_frozen_dataset(writer)

    rows = writer.execute(
        "SELECT delivery_date, period_ordinal, price FROM repaired_observed_price"
        " ORDER BY delivery_date, period_ordinal"
    ).fetchall()
    lines = [
        f"{local_label(d, o):%Y-%m-%d %H:%M:%S},{price.quantize(Decimal('0.001'))}"
        for d, o, price in rows
    ]
    assert len(lines) == 61_368
    assert hashlib.sha256("\n".join(lines).encode()).hexdigest() == (
        THESIS_CZ_CSV_SHA256
    )


@pytest.mark.parametrize(
    ("day", "observed", "repaired_0200"),
    [
        # ADR-0001's worked examples: an interpolated 02:00 and an averaged one.
        (date(2024, 3, 31), 23, Decimal("50.385")),  # (56.09 + 44.68) / 2
        (date(2024, 10, 27), 25, Decimal("81.33")),  # (82.23 + 80.43) / 2
    ],
)
def test_a_daylight_saving_day_keeps_its_true_periods_and_repairs_to_24(
    writer: psycopg.Connection, day: date, observed: int, repaired_0200: Decimal
) -> None:
    load_frozen_dataset(writer)

    (n_observed,) = writer.execute(
        "SELECT count(*) FROM observed_price"
        " WHERE (delivery_start AT TIME ZONE 'Europe/Prague')::date = %s",
        (day,),
    ).fetchone()
    repaired = writer.execute(
        "SELECT period_ordinal, price FROM repaired_observed_price"
        " WHERE delivery_date = %s ORDER BY period_ordinal",
        (day,),
    ).fetchall()
    assert n_observed == observed
    assert [o for o, _ in repaired] == list(range(1, 25))
    assert repaired[2][1] == repaired_0200


def test_every_delivery_day_repairs_to_exactly_24_periods(
    writer: psycopg.Connection,
) -> None:
    load_frozen_dataset(writer)

    assert writer.execute(
        "SELECT count(*), min(delivery_date), max(delivery_date)"
        " FROM (SELECT delivery_date FROM repaired_observed_price"
        "       GROUP BY delivery_date HAVING count(*) = 24) AS days"
    ).fetchone() == (2557, date(2018, 1, 1), date(2024, 12, 31))


def test_loading_the_same_dataset_twice_changes_nothing(
    writer: psycopg.Connection,
) -> None:
    load_frozen_dataset(writer)
    again = load_frozen_dataset(writer)

    assert (again.observed_inserted, again.repaired_inserted) == (0, 0)
    assert count(writer, "observed_price") == 61_368
    assert count(writer, "repaired_observed_price") == 61_368


def test_a_conflicting_observed_price_raises_and_writes_nothing(
    db: psycopg.Connection,
) -> None:
    db.execute(
        "INSERT INTO observed_price VALUES"
        " ('2020-06-01T10:00:00Z', 60, 999.99, 'elsewhere', now())"
    )
    db.execute("SET LOCAL ROLE app_writer")

    with pytest.raises(ConflictingObservedPrice):
        load_frozen_dataset(db)

    assert count(db, "observed_price") == 1
    assert count(db, "repaired_observed_price") == 0
    assert db.execute("SELECT price FROM observed_price").fetchone() == (
        Decimal("999.99"),
    )


def test_both_tables_are_written_in_one_transaction(db: psycopg.Connection) -> None:
    # Make the second of the two writes fail inside Postgres, after the first
    # has gone through, and check that the first did not survive it.
    db.execute(
        "CREATE FUNCTION refuse() RETURNS trigger LANGUAGE plpgsql AS"
        " $$ BEGIN RAISE EXCEPTION 'refused'; END $$"
    )
    db.execute(
        "CREATE TRIGGER refuse BEFORE INSERT ON repaired_observed_price"
        " FOR EACH ROW EXECUTE FUNCTION refuse()"
    )
    db.execute("SET LOCAL ROLE app_writer")

    with pytest.raises(psycopg.errors.RaiseException):
        load_frozen_dataset(db)

    assert count(db, "observed_price") == 0


def test_a_delivery_day_with_a_missing_period_raises_and_writes_nothing(
    writer: psycopg.Connection,
) -> None:
    day = [
        ObservedPrice(datetime(2024, 6, 1, h, tzinfo=UTC) - timedelta(hours=2), 60, p)
        for h, p in enumerate(Decimal(n) for n in range(24))
    ]
    del day[5]

    with pytest.raises(IncompleteDeliveryDay):
        load_observed_prices(
            writer, day, source="test", retrieved_at=FROZEN_RETRIEVED_AT
        )

    assert count(writer, "observed_price") == 0
