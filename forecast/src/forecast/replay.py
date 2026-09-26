"""The replay: the one top-level call that fills the store (ADR-0010).

    load the frozen dataset -> run the runner over a date range for a model set
    -> rebuild every derived row

It is also seam 2's entry point: the persistence tests call `replay` and assert
on what it stored.

From the command line, against the database in `DATABASE_URL`:

    uv run python -m forecast.replay --models daylag,ar168 \\
        --start 2020-01-01 --end 2024-12-31

v1's full replay is 2020-01-01 to 2024-12-31, 1,827 delivery days, every model
on the roster, no exclusions. The start is forced by AR-168's 730-day window
against a record opening 2018-01-01.

Each forecast run commits on its own, so a failure part-way keeps every run
before it. The derived rows are rebuilt whole at the end **whether or not the
day loop finished**, so the scoreboard always describes exactly the forecasts
that are stored; then the failure is raised. Nothing is skipped quietly: a gap
in the history a run needs stops the replay.

A failure names where it happened. The replay runs in stages — `load`,
`build <model>`, `forecast <model>`, `rebuild` — each logged as it starts and
ends, and a failed stage raises `ReplayFailed` naming it, with the model and
the delivery day when a forecast run was the cause. That is what makes the
smoke replay (a wiring rehearsal on a GitHub runner) legible when it fails.
"""

import argparse
import logging
import os
import sys
import time
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg

from forecast.history import StoredHistory
from forecast.loader import load_frozen_dataset
from forecast.metrics import RebuildResult, rebuild_derived_rows
from forecast.models import ROSTER, build
from forecast.runner import current_code_version, run_days

log = logging.getLogger("forecast.replay")

FIRST_REPLAYED_DAY = date(2020, 1, 1)
LAST_REPLAYED_DAY = date(2024, 12, 31)


class ReplayFailed(RuntimeError):
    """A stage of the replay failed. Its message names the stage and the cause."""

    def __init__(self, stage: str) -> None:
        self.stage = stage
        super().__init__(stage)

    def __str__(self) -> str:
        return f"stage {self.stage!r} failed: {self.__cause__}"


@contextmanager
def stage(name: str) -> Iterator[None]:
    log.info("stage %s: started", name)
    started = time.monotonic()
    try:
        yield
    except Exception as error:
        log.error("stage %s: failed: %s", name, error)
        raise ReplayFailed(name) from error
    log.info("stage %s: done in %.1f s", name, time.monotonic() - started)


@dataclass(frozen=True)
class ReplayResult:
    forecast_runs: int
    derived: RebuildResult


def delivery_days(start: date, end: date) -> list[date]:
    if end < start:
        raise ValueError(f"the range ends ({end}) before it starts ({start})")
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def replay(
    conn: psycopg.Connection,
    models: Sequence[str],
    start: date,
    end: date,
    *,
    code_version: str | None = None,
) -> ReplayResult:
    """Load, forecast every model over `start`..`end` inclusive, rebuild.

    Every forecast it writes is a backtest: the replay only ever runs over
    delivery days whose observed prices are already in the frozen dataset.
    """
    # Checked here as well as in `build`, so a typo fails before the load.

    unknown = sorted(set(models) - set(ROSTER))
    if unknown:
        raise ValueError(f"unknown model(s) {unknown}; the roster is {sorted(ROSTER)}")
    days = delivery_days(start, end)
    code_version = code_version or current_code_version()

    with stage("load"):
        loaded = load_frozen_dataset(conn)
        history = StoredHistory(conn)
    log.info(
        "the frozen dataset: %d observed, %d repaired prices new",
        loaded.observed_inserted,
        loaded.repaired_inserted,
    )
    runs = 0
    try:
        for slug in models:
            with stage(f"build {slug}"):
                model = build(slug)
            with stage(f"forecast {slug}"):
                log.info("%s: %d delivery days from %s", slug, len(days), start)
                runs += run_days(
                    conn,
                    model,
                    days,
                    history,
                    run_type="backtest",
                    code_version=code_version,
                )
    finally:
        with stage("rebuild"):
            derived = rebuild_derived_rows(conn)
        log.info(
            "rebuilt %d published metrics and %d model comparisons",
            derived.published_metrics,
            derived.model_comparisons,
        )
    return ReplayResult(runs, derived)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m forecast.replay", description=__doc__.split("\n\n")[0]
    )
    parser.add_argument(
        "--models",
        default=",".join(ROSTER),
        help=f"comma-separated slugs (default: {','.join(ROSTER)})",
    )
    parser.add_argument("--start", type=date.fromisoformat, default=FIRST_REPLAYED_DAY)
    parser.add_argument("--end", type=date.fromisoformat, default=LAST_REPLAYED_DAY)
    args = parser.parse_args(argv)

    url = os.environ.get("DATABASE_URL")
    if not url:
        parser.error("DATABASE_URL is not set")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    # Autocommit, so each forecast run's transaction is a real one and commits
    # as it finishes, rather than a savepoint inside one replay-long transaction.
    with psycopg.connect(url, autocommit=True) as conn:
        try:
            result = replay(conn, models, args.start, args.end)
        except ReplayFailed as failure:
            if os.environ.get("GITHUB_ACTIONS"):
                print(f"::error title=Replay failed::{failure}")
            raise
    log.info("done: %d forecast runs", result.forecast_runs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
