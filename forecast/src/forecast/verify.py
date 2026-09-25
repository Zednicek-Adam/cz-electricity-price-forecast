"""Checks that a store holds the full backtest, and says what it found.

    DATABASE_URL=... uv run python -m forecast.verify --models daylag,ar168

Run after a full replay (issue #48; phase 4 re-runs it with Chronos-2). It reads
only, so the reader role is enough. It checks that:

* every model has 24 forecasts on each of the 1,827 delivery days from
  2020-01-01 to 2024-12-31, as backtests, with no year missing;
* the daylight-saving delivery days carry 24 period ordinals like any other;
* the day-lag naïve's own `overall` rMAE reads exactly 1.000;
* published metrics and model comparisons exist for every model, and describe
  no model that has no forecasts.

It exits non-zero on the first failed check.
"""

import argparse
import os
import sys
from collections.abc import Sequence
from datetime import date

import psycopg

from forecast.models import ROSTER
from forecast.replay import FIRST_REPLAYED_DAY, LAST_REPLAYED_DAY, delivery_days

DAYLIGHT_SAVING_DAYS = [
    date(2020, 3, 29),
    date(2020, 10, 25),
    date(2021, 3, 28),
    date(2021, 10, 31),
    date(2022, 3, 27),
    date(2022, 10, 30),
    date(2023, 3, 26),
    date(2023, 10, 29),
    date(2024, 3, 31),
    date(2024, 10, 27),
]


class Failed(AssertionError):
    pass


def check(condition: bool, message: str) -> None:
    if not condition:
        raise Failed(message)
    print(f"ok  {message}")


def verify(conn: psycopg.Connection, models: Sequence[str]) -> None:
    n_days = len(delivery_days(FIRST_REPLAYED_DAY, LAST_REPLAYED_DAY))
    for model in models:
        days, rows, first, last, run_types = conn.execute(
            "SELECT count(DISTINCT delivery_date), count(*), min(delivery_date),"
            " max(delivery_date), array_agg(DISTINCT run_type)"
            " FROM forecast WHERE model = %s",
            (model,),
        ).fetchone()
        check(
            (days, rows, first, last)
            == (n_days, n_days * 24, FIRST_REPLAYED_DAY, LAST_REPLAYED_DAY),
            f"{model}: {rows} forecasts over {days} delivery days, {first} to {last}",
        )
        check(run_types == ["backtest"], f"{model}: every forecast is a backtest")
        years = conn.execute(
            "SELECT array_agg(DISTINCT extract(year FROM delivery_date)::int"
            " ORDER BY extract(year FROM delivery_date)::int)"
            " FROM forecast WHERE model = %s",
            (model,),
        ).fetchone()[0]
        check(years == [2020, 2021, 2022, 2023, 2024], f"{model}: no year excluded")
        ordinals = conn.execute(
            "SELECT DISTINCT count(*) FROM forecast"
            " WHERE model = %s AND delivery_date = ANY(%s) GROUP BY delivery_date",
            (model, DAYLIGHT_SAVING_DAYS),
        ).fetchall()
        check(
            ordinals == [(24,)],
            f"{model}: the {len(DAYLIGHT_SAVING_DAYS)} daylight-saving days"
            " carry 24 period ordinals",
        )
        n_metrics = conn.execute(
            "SELECT count(*) FROM published_metric WHERE model = %s", (model,)
        ).fetchone()[0]
        check(n_metrics > 0, f"{model}: {n_metrics} published metrics")

    naive_rmae = conn.execute(
        "SELECT value FROM published_metric WHERE model = 'daylag'"
        " AND run_type = 'backtest' AND scope_type = 'overall' AND metric = 'rmae'"
        " AND scope_start = %s",
        (FIRST_REPLAYED_DAY,),
    ).fetchone()
    reads = "nothing" if naive_rmae is None else f"{naive_rmae[0]:.3f}"
    check(reads == "1.000", f"daylag: overall rMAE reads {reads}")
    described = {
        m
        for (m,) in conn.execute(
            "SELECT model FROM published_metric UNION SELECT model_a"
            " FROM model_comparison UNION SELECT model_b FROM model_comparison"
        ).fetchall()
    }
    check(
        described == set(models),
        f"the derived rows describe exactly {sorted(models)}",
    )
    pairs = conn.execute("SELECT count(*) FROM model_comparison").fetchone()[0]
    check(pairs > 0, f"{pairs} model comparisons")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m forecast.verify")
    parser.add_argument("--models", default=",".join(ROSTER))
    args = parser.parse_args(argv)
    url = os.environ.get("DATABASE_URL")
    if not url:
        parser.error("DATABASE_URL is not set")
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    with psycopg.connect(url, autocommit=True) as conn:
        try:
            verify(conn, models)
        except Failed as failure:
            print(f"FAILED  {failure}")
            return 1
    print("verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
