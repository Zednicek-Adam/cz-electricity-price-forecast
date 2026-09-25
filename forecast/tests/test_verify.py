"""The full-backtest check refuses a store that holds less than the record."""

from datetime import date

import psycopg
import pytest

from forecast.replay import replay
from forecast.verify import Failed, verify


def test_a_short_replay_is_not_the_full_backtest(db: psycopg.Connection) -> None:
    replay(db, ["daylag"], date(2020, 1, 1), date(2020, 1, 3), code_version="abc")

    with pytest.raises(Failed, match="72 forecasts over 3 delivery days"):
        verify(db, ["daylag"])


def test_an_empty_store_is_not_the_full_backtest(db: psycopg.Connection) -> None:
    with pytest.raises(Failed):
        verify(db, ["daylag"])
