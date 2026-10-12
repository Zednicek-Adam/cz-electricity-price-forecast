"""The replay: backtest forecast runs over a date range, into the record.

    read the repaired observed prices -> run the runner over a date range for a
    model set -> merge the runs into `data/forecasts.csv`

From the command line:

    uv run python -m forecast.replay --models daylag,ar168 \\
        --start 2020-01-01 --end 2024-12-31

The full replay starts 2020-01-01, forced by AR-168's 730-day window against a
record opening 2018-01-01, and by default ends on the last delivery day with a
published price. Every forecast it writes is a backtest, and it replaces the
backtest run held for the same model and day. A live run is never replaced
(ADR-0011): a day that has one is skipped for that model.

The record is written once, at the end, **whether or not the day loop
finished**, so every run made before a failure is kept; then the failure is
raised. Nothing is skipped quietly: a gap in the history a run needs stops the
replay. Nothing here touches the dashboard: the replay workflow turns a changed
record into a branch, and the deploy that follows its merge exports it.

A failure names where it happened. The replay runs in stages — `load`,
`build <model>`, `forecast <model>`, `write` — each logged as it starts and
ends, and a failed stage raises `ReplayFailed` naming it, with the model and
the delivery day when a forecast run was the cause.
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
from pathlib import Path

from forecast.forecasts import (
    FORECASTS,
    StoredRun,
    merge,
    read_forecasts,
    write_forecasts,
)
from forecast.loader import PRICES, repaired_history
from forecast.models import ROSTER, build
from forecast.runner import current_code_version, run_days

log = logging.getLogger("forecast.replay")

FIRST_REPLAYED_DAY = date(2020, 1, 1)


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
    skipped_live: int


def delivery_days(start: date, end: date) -> list[date]:
    if end < start:
        raise ValueError(f"the range ends ({end}) before it starts ({start})")
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def replay(
    models: Sequence[str],
    start: date,
    end: date | None = None,
    *,
    prices_path: Path = PRICES,
    forecasts_path: Path = FORECASTS,
    code_version: str | None = None,
) -> ReplayResult:
    """Forecast every model over `start`..`end` inclusive, as backtests, and
    merge the runs into the record. `end` defaults to the last delivery day
    with a published price."""
    # Checked here as well as in `build`, so a typo fails before the load.
    unknown = sorted(set(models) - set(ROSTER))
    if unknown:
        raise ValueError(f"unknown model(s) {unknown}; the roster is {sorted(ROSTER)}")
    code_version = code_version or current_code_version()

    with stage("load"):
        history = repaired_history(prices_path)
        held = read_forecasts(forecasts_path)
    last_published = history.index[-1].date()
    end = end or last_published
    if end > last_published:
        raise ValueError(f"{end} has no published price; the last is {last_published}")
    days = delivery_days(start, end)
    live = {r.key for r in held if r.run_type == "live"}

    runs: list[StoredRun] = []
    skipped = 0
    try:
        for slug in models:
            with stage(f"build {slug}"):
                model = build(slug)
            todo = [d for d in days if (d, slug) not in live]
            skipped += len(days) - len(todo)
            with stage(f"forecast {slug}"):
                log.info("%s: %d delivery days from %s", slug, len(todo), start)
                runs.extend(
                    run_days(
                        model,
                        todo,
                        history,
                        run_type="backtest",
                        code_version=code_version,
                    )
                )
    finally:
        with stage("write"):
            write_forecasts(merge(held, runs), forecasts_path)
        log.info("wrote %d forecast runs to %s", len(runs), forecasts_path)
    return ReplayResult(len(runs), skipped)


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
    parser.add_argument(
        "--end",
        type=date.fromisoformat,
        default=None,
        help="the last delivery day (default: the last with a published price)",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    try:
        result = replay(models, args.start, args.end)
    except ReplayFailed as failure:
        if os.environ.get("GITHUB_ACTIONS"):
            print(f"::error title=Replay failed::{failure}")
        raise
    log.info(
        "done: %d forecast runs, %d live days left as they were",
        result.forecast_runs,
        result.skipped_live,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
