"""The replay's own top level, against a real Postgres (seam 2).

Every assertion is on stored rows. The replays are short — the first days of
2020, the earliest AR-168 can forecast — and run as `app_writer`.
"""

from datetime import date

import psycopg
import pytest

from forecast.replay import replay
from forecast.runner import HistoryGap

START = date(2020, 1, 1)
END = date(2020, 1, 3)


@pytest.fixture
def writer(db: psycopg.Connection) -> psycopg.Connection:
    db.execute("SET LOCAL ROLE app_writer")
    return db


def forecast_counts(conn: psycopg.Connection) -> list[tuple]:
    return conn.execute(
        "SELECT model, run_type, min(delivery_date), max(delivery_date), count(*)"
        " FROM forecast GROUP BY 1, 2 ORDER BY 1, 2"
    ).fetchall()


def test_a_replay_loads_forecasts_and_rebuilds_everything(
    writer: psycopg.Connection,
) -> None:
    result = replay(writer, ["daylag", "ar168"], START, END, code_version="abc")

    assert result.forecast_runs == 6
    assert forecast_counts(writer) == [
        ("ar168", "backtest", START, END, 72),
        ("daylag", "backtest", START, END, 72),
    ]
    assert writer.execute("SELECT count(*) FROM observed_price").fetchone() == (61_368,)
    assert writer.execute(
        "SELECT model, value FROM published_metric WHERE scope_type = 'overall'"
        " AND scope_start = %s AND metric = 'rmae' ORDER BY model",
        (START,),
    ).fetchall()[1] == ("daylag", 1)
    pairs = writer.execute(
        "SELECT DISTINCT model_a, model_b FROM model_comparison ORDER BY 1, 2"
    ).fetchall()
    assert pairs == [("ar168", "daylag"), ("daylag", "ar168")]


def test_replaying_the_same_range_again_replaces_rather_than_adds(
    writer: psycopg.Connection,
) -> None:
    replay(writer, ["daylag"], START, END, code_version="first")
    replay(writer, ["daylag"], START, END, code_version="second")

    assert forecast_counts(writer) == [("daylag", "backtest", START, END, 72)]
    assert writer.execute("SELECT DISTINCT code_version FROM forecast").fetchall() == [
        ("second",)
    ]


def test_a_run_that_cannot_be_made_stops_the_replay_and_the_scoreboard_follows(
    db: psycopg.Connection,
) -> None:
    db.execute(
        "INSERT INTO published_metric VALUES"
        " ('ghost', 'backtest', 'overall', '2020-01-01', 'mae', 1, 1, now())"
    )
    db.execute("SET LOCAL ROLE app_writer")

    # AR-168 needs 730 days; the record opens 2018-01-01, so 2019-12-31 has one
    # day too few and the replay stops there, before writing anything.
    with pytest.raises(HistoryGap):
        replay(db, ["ar168"], date(2019, 12, 31), END, code_version="abc")

    assert forecast_counts(db) == []
    assert db.execute("SELECT count(*) FROM published_metric").fetchone() == (0,)


def test_an_unknown_model_is_refused_before_anything_is_written(
    writer: psycopg.Connection,
) -> None:
    with pytest.raises(ValueError, match="unknown model"):
        replay(writer, ["daylag", "lear"], START, END, code_version="abc")

    assert writer.execute("SELECT count(*) FROM observed_price").fetchone() == (0,)
