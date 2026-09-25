"""The loader: the frozen dataset into the store, repaired once, in one go.

`load_observed_prices` writes `observed_price` and `repaired_observed_price` in
**one transaction** (ADR-0005), so the stored repaired series can never lag the
record it is derived from. Grid repair runs here, on the way in, and nowhere
else.

The historical record is append-only. A period that is already stored with the
same price is left alone, so loading the same file twice is a no-op. A period
stored with a *different* price raises `ConflictingObservedPrice` and nothing
is written: the loader never overwrites. (The operator's `repair`, which may,
belongs to the live branch.)
"""

import csv
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import psycopg

from forecast.grid import RepairedPrice, day_bounds, delivery_day, repair_grid

REPO_ROOT = Path(__file__).resolve().parents[3]
FROZEN_DATASET = REPO_ROOT / "data" / "cz-day-ahead-prices.csv"

# Provenance of the frozen dataset, which the file does not carry per row
# because both values are constant across it (data/README.md): the ENTSO-E
# Transparency Platform GUI export, retrieved on 2026-09-02. Only the date of
# retrieval is recorded, so the instant is that day's UTC midnight.
FROZEN_SOURCE = "entsoe-tp-gui-export"
FROZEN_RETRIEVED_AT = datetime(2026, 9, 2, tzinfo=UTC)

RESOLUTION_MINUTES = 60


class ConflictingObservedPrice(ValueError):
    """A stored observed price disagrees with the one being loaded."""


@dataclass(frozen=True)
class ObservedPrice:
    delivery_start: datetime
    resolution_minutes: int
    price: Decimal


@dataclass(frozen=True)
class LoadResult:
    observed_inserted: int
    repaired_inserted: int


def read_frozen_dataset(path: Path = FROZEN_DATASET) -> list[ObservedPrice]:
    with path.open(newline="", encoding="utf-8") as fh:
        return [
            ObservedPrice(
                delivery_start=datetime.strptime(
                    row["delivery_start"], "%Y-%m-%dT%H:%M:%SZ"
                ).replace(tzinfo=UTC),
                resolution_minutes=int(row["resolution_minutes"]),
                price=Decimal(row["price"]),
            )
            for row in csv.DictReader(fh)
        ]


def load_frozen_dataset(
    conn: psycopg.Connection, path: Path = FROZEN_DATASET
) -> LoadResult:
    return load_observed_prices(
        conn,
        read_frozen_dataset(path),
        source=FROZEN_SOURCE,
        retrieved_at=FROZEN_RETRIEVED_AT,
    )


def load_observed_prices(
    conn: psycopg.Connection,
    prices: Iterable[ObservedPrice],
    *,
    source: str,
    retrieved_at: datetime,
) -> LoadResult:
    """Store observed prices and their repaired series, all or nothing.

    Every delivery day the prices touch must be complete, because grid repair
    needs whole days. Only hourly prices exist in v1.
    """
    by_start: dict[datetime, Decimal] = {}
    for p in prices:
        if p.resolution_minutes != RESOLUTION_MINUTES:
            raise ValueError(f"unsupported resolution: {p.resolution_minutes}")
        if p.delivery_start in by_start:
            raise ValueError(f"duplicate delivery period: {p.delivery_start}")
        by_start[p.delivery_start] = p.price
    if not by_start:
        return LoadResult(0, 0)

    repaired = repair_grid(by_start)
    first_day = delivery_day(min(by_start))
    last_day = delivery_day(max(by_start))

    with conn.transaction():
        new_observed = _new_observed(conn, by_start, first_day, last_day)
        new_repaired = _new_repaired(conn, repaired, first_day, last_day)
        with conn.cursor().copy(
            "COPY observed_price (delivery_start, resolution_minutes, price,"
            " source, retrieved_at) FROM STDIN"
        ) as copy:
            for start in new_observed:
                copy.write_row(
                    (start, RESOLUTION_MINUTES, by_start[start], source, retrieved_at)
                )
        with conn.cursor().copy(
            "COPY repaired_observed_price (delivery_date, period_ordinal,"
            " resolution_minutes, price) FROM STDIN"
        ) as copy:
            for r in new_repaired:
                copy.write_row(
                    (r.delivery_date, r.period_ordinal, RESOLUTION_MINUTES, r.price)
                )
    return LoadResult(len(new_observed), len(new_repaired))


def _new_observed(
    conn: psycopg.Connection,
    by_start: Mapping[datetime, Decimal],
    first_day: date,
    last_day: date,
) -> list[datetime]:
    """The periods not stored yet. Raises if a stored one disagrees."""
    stored = dict(
        conn.execute(
            "SELECT delivery_start, price FROM observed_price"
            " WHERE resolution_minutes = %s"
            " AND delivery_start >= %s AND delivery_start < %s",
            (RESOLUTION_MINUTES, day_bounds(first_day)[0], day_bounds(last_day)[1]),
        ).fetchall()
    )
    conflicts = [
        (start, stored[start], price)
        for start, price in by_start.items()
        if start in stored and stored[start] != price
    ]
    if conflicts:
        start, was, now = conflicts[0]
        raise ConflictingObservedPrice(
            f"{len(conflicts)} stored observed price(s) differ, first at"
            f" {start:%Y-%m-%dT%H:%MZ}: stored {was}, loading {now}"
        )
    return sorted(start for start in by_start if start not in stored)


def _new_repaired(
    conn: psycopg.Connection,
    repaired: list[RepairedPrice],
    first_day: date,
    last_day: date,
) -> list[RepairedPrice]:
    """The repaired periods not stored yet. Raises if a stored one disagrees.

    A disagreement here means the stored repaired series was not derived from
    the stored record by this repair, which is the invariant ADR-0005's single
    transaction exists to keep.
    """
    stored = {
        (d, o): price
        for d, o, price in conn.execute(
            "SELECT delivery_date, period_ordinal, price"
            " FROM repaired_observed_price WHERE resolution_minutes = %s"
            " AND delivery_date BETWEEN %s AND %s",
            (RESOLUTION_MINUTES, first_day, last_day),
        ).fetchall()
    }
    conflicts = [
        r
        for r in repaired
        if (r.delivery_date, r.period_ordinal) in stored
        and stored[(r.delivery_date, r.period_ordinal)] != r.price
    ]
    if conflicts:
        r = conflicts[0]
        raise ConflictingObservedPrice(
            f"{len(conflicts)} stored repaired price(s) differ, first at"
            f" {r.delivery_date} ordinal {r.period_ordinal}"
        )
    return [r for r in repaired if (r.delivery_date, r.period_ordinal) not in stored]
