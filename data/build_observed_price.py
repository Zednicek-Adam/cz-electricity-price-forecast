"""Build the frozen observed-price artifact from the raw ENTSO-E GUI exports.

One-off. The seven `GUI_ENERGY_PRICES_*.csv` exports live in the private
`epf-diploma` repo (`sources/`); this script is the record of how they became
`data/cz-day-ahead-prices.csv`, not part of the running system. The loader that
takes the artifact into Postgres, applies grid repair and writes both price
tables in one transaction (ADR-0005) is separate work and lives in `forecast/`.

    python data/build_observed_price.py <raw-export-dir> [--czcsv <path>]

`--czcsv` points at `epf-diploma/sources/CZ.csv` and turns on the parity check:
grid repair applied to the parsed prices must reproduce that file exactly.

    python data/build_observed_price.py --verify-only

re-checks the committed artifact alone — row count, range, an unbroken hourly
grid, no duplicate periods, and the 23- and 25-period days. That mode needs
nothing private, so anyone with the repo can run it.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

PRAGUE = ZoneInfo("Europe/Prague")
RESOLUTION_MINUTES = 60
AREA = "BZN|CZ"

# "31/03/2024 01:00:00 (CET) - 31/03/2024 03:00:00 (CEST)" — the marker appears
# only where the local label alone is ambiguous, but it is not always omitted
# where it is redundant, so parse it wherever it shows up.
MTU = re.compile(
    r"^(?P<start>\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2})(?: \((?P<tz>CES?T)\))? - "
)


def parse_start(mtu: str) -> datetime:
    m = MTU.match(mtu)
    if not m:
        raise ValueError(f"unparseable MTU: {mtu!r}")
    naive = datetime.strptime(m.group("start"), "%d/%m/%Y %H:%M:%S")
    # In Europe/Prague, fold=0 is the CEST reading of an ambiguous local label
    # and fold=1 the CET one. An unmarked label is unambiguous, so fold=0.
    fold = 1 if m.group("tz") == "CET" else 0
    return naive.replace(tzinfo=PRAGUE, fold=fold).astimezone(timezone.utc)


def read_export(path: Path) -> list[tuple[datetime, str]]:
    rows = []
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            if row["Area"] != AREA:
                raise ValueError(f"{path.name}: unexpected area {row['Area']!r}")
            price = row["Day-ahead Price (EUR/MWh)"].strip()
            if not price:
                raise ValueError(f"{path.name}: empty price at {row['MTU (CET/CEST)']}")
            rows.append((parse_start(row["MTU (CET/CEST)"]), price))
    return rows


def check_grid(starts: list[datetime]) -> None:
    """Every consecutive pair is exactly one hour apart, with no duplicates."""
    hour = timedelta(hours=1)
    for a, b in zip(starts, starts[1:]):
        if b - a != hour:
            raise ValueError(f"grid break: {a.isoformat()} -> {b.isoformat()}")
    if len(set(starts)) != len(starts):
        raise ValueError("duplicate delivery periods")


def repair_grid(prices: dict[datetime, float]) -> list[tuple[str, float]]:
    """The thesis's lossy DST repair: flatten true market periods onto a regular
    24-period local grid. Spring-forward's missing 02:00 becomes the mean of the
    periods either side of the gap; fall-back's two 02:00 periods are averaged
    into one.

    A verification-only reimplementation. ADR-0001 puts the shipping repair in
    the model layer, and ADR-0005 has the loader store its output.
    """
    days = sorted({start.astimezone(PRAGUE).date() for start in prices})
    out: list[tuple[str, float]] = []
    interpolated = averaged = 0
    for day in days:
        for hour in range(24):
            label = datetime(day.year, day.month, day.day, hour)
            early = label.replace(tzinfo=PRAGUE, fold=0).astimezone(timezone.utc)
            late = label.replace(tzinfo=PRAGUE, fold=1).astimezone(timezone.utc)
            if early == late:
                value = prices[early]                       # an ordinary hour
            elif early < late:
                value = (prices[early] + prices[late]) / 2  # fall-back: two periods
                averaged += 1
            else:
                # Spring forward: the label has no instant. `early` and `late`
                # land on the periods bracketing the gap, so their mean is the
                # linear interpolation the thesis performs.
                value = (prices[late] + prices[early]) / 2
                interpolated += 1
            out.append((label.strftime("%Y-%m-%d %H:%M:%S"), value))
    print(f"  grid repair: {interpolated} interpolated, {averaged} averaged")
    return out


EXPECTED = {
    "rows": 61368,
    "first": "2017-12-31T23:00:00Z",
    "last": "2024-12-31T22:00:00Z",
    "days": 2557,
    "short_days": 7,   # spring forward: 23 periods
    "long_days": 7,    # fall back: 25 periods
}


def verify(path: Path) -> None:
    """Check the committed artifact against the facts recorded in data/README.md."""
    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    starts = [
        datetime.strptime(r["delivery_start"], "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
        for r in rows
    ]
    check_grid(starts)

    resolutions = {r["resolution_minutes"] for r in rows}
    if resolutions != {str(RESOLUTION_MINUTES)}:
        raise SystemExit(f"unexpected resolutions: {resolutions}")

    periods_per_day: dict[object, int] = {}
    for start in starts:
        day = start.astimezone(PRAGUE).date()
        periods_per_day[day] = periods_per_day.get(day, 0) + 1
    counts = list(periods_per_day.values())

    got = {
        "rows": len(rows),
        "first": rows[0]["delivery_start"],
        "last": rows[-1]["delivery_start"],
        "days": len(periods_per_day),
        "short_days": counts.count(23),
        "long_days": counts.count(25),
    }
    odd = [n for n in counts if n not in (23, 24, 25)]
    if odd:
        raise SystemExit(f"delivery days with impossible period counts: {sorted(set(odd))}")
    if got != EXPECTED:
        raise SystemExit(f"artifact changed: expected {EXPECTED}, got {got}")
    for key, value in got.items():
        print(f"  {key}: {value}")
    print(f"{path}: verified")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("raw_dir", type=Path, nargs="?")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--czcsv", type=Path)
    ap.add_argument("--out", type=Path, default=Path("data/cz-day-ahead-prices.csv"))
    args = ap.parse_args()

    if args.verify_only:
        verify(args.out)
        return 0
    if args.raw_dir is None:
        ap.error("raw_dir is required unless --verify-only is given")

    exports = sorted(args.raw_dir.glob("GUI_ENERGY_PRICES_*.csv"))
    if len(exports) != 7:
        raise SystemExit(f"expected 7 price exports, found {len(exports)}")

    rows: list[tuple[datetime, str]] = []
    for path in exports:
        got = read_export(path)
        print(f"{path.name}: {len(got)} periods")
        rows.extend(got)

    rows.sort(key=lambda r: r[0])
    check_grid([r[0] for r in rows])

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, lineterminator="\n")
        w.writerow(["delivery_start", "resolution_minutes", "price"])
        for start, price in rows:
            w.writerow([start.strftime("%Y-%m-%dT%H:%M:%SZ"), RESOLUTION_MINUTES, price])

    print(f"\nwrote {args.out}: {len(rows)} rows")
    print(f"  first {rows[0][0].isoformat()}  last {rows[-1][0].isoformat()}")
    print(f"  bytes {args.out.stat().st_size}")

    if args.czcsv:
        prices = {start: float(price) for start, price in rows}
        repaired = repair_grid(prices)
        with args.czcsv.open(newline="", encoding="utf-8-sig") as fh:
            thesis = [(r["date"], float(r["el_price"])) for r in csv.DictReader(fh)]
        if len(repaired) != len(thesis):
            raise SystemExit(f"parity: {len(repaired)} repaired vs {len(thesis)} thesis rows")
        bad = [
            (a, b)
            for a, b in zip(repaired, thesis)
            if a[0] != b[0] or abs(a[1] - b[1]) > 1e-9
        ]
        if bad:
            for a, b in bad[:10]:
                print(f"  parity mismatch: repaired {a} vs thesis {b}")
            raise SystemExit(f"parity: {len(bad)} rows differ")
        print(f"  parity: grid repair reproduces {len(thesis)} CZ.csv rows exactly")
    return 0


if __name__ == "__main__":
    sys.exit(main())
