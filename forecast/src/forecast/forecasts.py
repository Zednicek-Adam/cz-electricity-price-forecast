"""The forecast record: `data/forecasts.csv`, one row per forecast run.

A forecast run is one model for one delivery day (ADR-0002), so a row carries
its 24 forecasts on the repaired grid as `p1` to `p24`, beside its provenance:

* `run_type` — `backtest` for a replayed day, `live` for one the daily run
  forecast before its price was published;
* `model_version` and `code_version` (ADR-0005), and `executed_at`.

Rows are sorted by delivery day, then model. A price is written as the
shortest text that reads back as the same float, so a run read and written
again is unchanged.
"""

import csv
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Literal

from forecast.grid import REPAIRED_PERIODS_PER_DAY
from forecast.loader import REPO_ROOT

FORECASTS = REPO_ROOT / "data" / "forecasts.csv"
ORDINALS = [f"p{i}" for i in range(1, REPAIRED_PERIODS_PER_DAY + 1)]
COLUMNS = [
    "delivery_date",
    "model",
    "run_type",
    "model_version",
    "code_version",
    "executed_at",
    *ORDINALS,
]
EXECUTED_AT = "%Y-%m-%dT%H:%M:%SZ"

RunType = Literal["backtest", "live"]


@dataclass(frozen=True)
class StoredRun:
    delivery_date: date
    model: str
    run_type: RunType
    model_version: str
    code_version: str
    executed_at: datetime
    prices: tuple[float, ...]

    @property
    def key(self) -> tuple[date, str]:
        return self.delivery_date, self.model


def read_forecasts(path: Path = FORECASTS) -> list[StoredRun]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as fh:
        return [_parse(row) for row in csv.DictReader(fh)]


def _parse(row: dict[str, str]) -> StoredRun:
    run_type = row["run_type"]
    if run_type not in ("backtest", "live"):
        raise ValueError(f"unknown run type {run_type!r}")
    return StoredRun(
        delivery_date=date.fromisoformat(row["delivery_date"]),
        model=row["model"],
        run_type=run_type,
        model_version=row["model_version"],
        code_version=row["code_version"],
        executed_at=datetime.strptime(row["executed_at"], EXECUTED_AT).replace(
            tzinfo=UTC
        ),
        prices=tuple(float(row[c]) for c in ORDINALS),
    )


def write_forecasts(runs: Iterable[StoredRun], path: Path = FORECASTS) -> None:
    """Write the whole record, sorted. One run per delivery day and model."""
    ordered = sorted(runs, key=lambda r: r.key)
    keys = [r.key for r in ordered]
    if len(set(keys)) != len(keys):
        raise ValueError("more than one forecast run for a delivery day and model")
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh, lineterminator="\n")
        writer.writerow(COLUMNS)
        for r in ordered:
            if len(r.prices) != REPAIRED_PERIODS_PER_DAY:
                raise ValueError(f"{r.model} on {r.delivery_date}: not 24 prices")
            writer.writerow(
                [
                    r.delivery_date.isoformat(),
                    r.model,
                    r.run_type,
                    r.model_version,
                    r.code_version,
                    r.executed_at.astimezone(UTC).strftime(EXECUTED_AT),
                    *(repr(p) for p in r.prices),
                ]
            )


def merge(held: Iterable[StoredRun], new: Iterable[StoredRun]) -> list[StoredRun]:
    """The record with `new` runs added, each replacing a held run for the same
    delivery day and model. A `live` run is never replaced (ADR-0011)."""
    record = {r.key: r for r in held}
    for run in new:
        if (kept := record.get(run.key)) is not None and kept.run_type == "live":
            raise ValueError(
                f"{run.model} on {run.delivery_date}: a live forecast is never replaced"
            )
        record[run.key] = run
    return sorted(record.values(), key=lambda r: r.key)
