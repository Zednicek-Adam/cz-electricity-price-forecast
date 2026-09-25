"""What the five tables and their grants refuse, asserted against Postgres.

ADR-0005's write semantics are database facts rather than conventions: the
historical record cannot be rewritten by the role that loads it, and the role
the public API holds cannot write at all. These tests exercise the roles the
grant migration configures, through `SET ROLE`.
"""

import psycopg
import pytest
from psycopg import errors

TABLES = [
    "observed_price",
    "repaired_observed_price",
    "forecast",
    "published_metric",
    "model_comparison",
]

ROWS = {
    "observed_price": (
        "(delivery_start, resolution_minutes, price, source, retrieved_at)",
        "('2024-05-12T11:00:00Z', 60, -138.75, 'test', now())",
    ),
    "repaired_observed_price": (
        "(delivery_date, period_ordinal, resolution_minutes, price)",
        "('2024-05-12', 14, 60, -138.75)",
    ),
    "forecast": (
        "(delivery_date, period_ordinal, resolution_minutes, model, run_type,"
        " price, model_version, code_version, executed_at)",
        "('2024-05-12', 14, 60, 'daylag', 'backtest', -20.5, 'daylag', 'test', now())",
    ),
    "published_metric": (
        "(model, run_type, scope_type, scope_start, metric, value, n_forecasts,"
        " computed_at)",
        "('daylag', 'backtest', 'overall', '2020-01-01', 'mae', 1.5, 24, now())",
    ),
    "model_comparison": (
        "(model_a, model_b, run_type, period_ordinal, resolution_minutes,"
        " dm_statistic, p_value, computed_at)",
        "('ar168', 'daylag', 'backtest', 1, 60, -2.1, 0.02, now())",
    ),
}


# One column per table that a rewrite would touch.
UPDATES = {
    "observed_price": "UPDATE observed_price SET price = 0",
    "repaired_observed_price": "UPDATE repaired_observed_price SET price = 0",
    "forecast": "UPDATE forecast SET price = 0",
    "published_metric": "UPDATE published_metric SET value = 0",
    "model_comparison": "UPDATE model_comparison SET p_value = 0.5",
}


def insert(conn: psycopg.Connection, table: str) -> None:
    columns, values = ROWS[table]
    conn.execute(f"INSERT INTO {table} {columns} VALUES {values}")


def refused(conn: psycopg.Connection, statement: str) -> bool:
    try:
        with conn.transaction():
            conn.execute(statement)
    except errors.InsufficientPrivilege:
        return True
    return False


@pytest.mark.parametrize(
    "table", ["observed_price", "repaired_observed_price", "forecast"]
)
def test_a_negative_price_is_stored_as_it_was_given(
    db: psycopg.Connection, table: str
) -> None:
    insert(db, table)
    (price,) = db.execute(f"SELECT price FROM {table}").fetchone()
    assert price < 0


@pytest.mark.parametrize("table", ["forecast", "published_metric", "model_comparison"])
def test_run_type_is_backtest_or_live_and_nothing_else(
    db: psycopg.Connection, table: str
) -> None:
    columns, values = ROWS[table]
    values = values.replace("'backtest'", "'replay'")
    with pytest.raises(errors.CheckViolation):
        db.execute(f"INSERT INTO {table} {columns} VALUES {values}")


@pytest.mark.parametrize("scope_type", ["overall", "year", "month", "delivery_day"])
def test_published_metric_admits_all_four_scopes(
    db: psycopg.Connection, scope_type: str
) -> None:
    db.execute(
        "INSERT INTO published_metric (model, run_type, scope_type, scope_start,"
        " metric, value, n_forecasts, computed_at)"
        " VALUES ('daylag', 'backtest', %s, '2020-01-01', 'mae', 1.5, 24, now())",
        (scope_type,),
    )


@pytest.mark.parametrize("table", TABLES)
def test_the_reader_can_select_and_cannot_write(
    db: psycopg.Connection, table: str
) -> None:
    insert(db, table)
    db.execute("SET LOCAL ROLE app_reader")
    assert db.execute(f"SELECT count(*) FROM {table}").fetchone() == (1,)
    columns, values = ROWS[table]
    assert refused(db, f"INSERT INTO {table} {columns} VALUES {values}")
    assert refused(
        db,
        f"UPDATE {table} SET computed_at = now()"
        if "computed_at" in columns
        else f"UPDATE {table} SET price = 0",
    )
    assert refused(db, f"DELETE FROM {table}")


@pytest.mark.parametrize("table", ["observed_price", "repaired_observed_price"])
def test_the_writer_can_append_to_the_record_and_cannot_rewrite_it(
    db: psycopg.Connection, table: str
) -> None:
    db.execute("SET LOCAL ROLE app_writer")
    insert(db, table)
    assert refused(db, UPDATES[table])
    assert refused(db, f"DELETE FROM {table}")


@pytest.mark.parametrize("table", ["forecast", "published_metric", "model_comparison"])
def test_the_writer_replaces_derived_rows_by_delete_and_insert_only(
    db: psycopg.Connection, table: str
) -> None:
    db.execute("SET LOCAL ROLE app_writer")
    insert(db, table)
    db.execute(f"DELETE FROM {table}")
    insert(db, table)
    assert refused(
        db,
        f"UPDATE {table} SET computed_at = now()"
        if table != "forecast"
        else f"UPDATE {table} SET price = 0",
    )
