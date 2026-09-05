"""Ticket #14: when do the three series *actually* publish?

Every File Library extract carries `UpdateTime(UTC)` per row, so the publication
lag falls straight out of the data -- no polling, no waiting for a real day.

Per series this reports, over one month of CZ rows:
  * first publication time per delivery day, as a local Europe/Prague clock time
    and as an offset from the delivery day's start -- median, p90, worst;
  * delivery days that never arrived at all;
  * revisions: whether some periods of a day carry a materially later
    UpdateTime than the day's bulk publication. That is the signal that decides
    whether live ingest needs correction handling or merely idempotency.

Run 02_filelibrary_inventory.py first if the folder or file names have moved.
"""
import argparse
import csv
import datetime as dt
import pathlib
import statistics
import zoneinfo

from tp_fms import download, list_folder, token

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = ROOT / "analysis" / "raw" / "cache"
PRAGUE = zoneinfo.ZoneInfo("Europe/Prague")

# /TP_export folder -> the ticket's name for the series. Named exactly, not
# matched loosely: EnergyPrices ships as both _r3 and _r3.1 and only r3.1 is current.
SERIES = {
    "EnergyPrices_12.1.D_r3.1":
        ("Day-ahead price (12.1.D)", "Price[Currency/MWh]"),
    "DayAheadTotalLoadForecast_6.1.B_r3":
        ("Day-ahead load forecast (6.1.B)", "TotalLoad[MW]"),
    "DayAheadAggregatedGeneration_14.1.C_r3":
        ("Day-ahead generation forecast (14.1.C)", "GenerationForecast[MW]"),
}


def parse_utc(s):
    s = s.strip().replace("Z", "")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
                "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
        try:
            return dt.datetime.strptime(s, fmt).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    return None


def pick(fieldnames, *fragments):
    for frag in fragments:
        for f in fieldnames:
            if frag.lower() in f.lower().replace(" ", ""):
                return f
    return None


def read_cz_rows(path, value_col):
    """[(delivery_day, period_start_utc, update_time_utc, value)] for CZ rows only.

    The extract keeps every published document, not just the latest: a revised
    delivery day appears twice over, once per publication. That is what makes
    first-vs-last publication, and value drift between them, measurable at all.
    """
    with path.open(encoding="utf-8-sig", newline="") as fh:
        sample = fh.readline()
        fh.seek(0)
        delim = "\t" if "\t" in sample else ","
        rdr = csv.DictReader(fh, delimiter=delim)
        cols = rdr.fieldnames or []
        dt_col = pick(cols, "datetime(utc)", "datetime")
        up_col = pick(cols, "updatetime(utc)", "updatetime")
        map_col = pick(cols, "mapcode")
        val_col = value_col if value_col in cols else None
        if not dt_col or not up_col:
            raise SystemExit(f"{path.name}: no DateTime/UpdateTime column in {cols}")
        out = []
        for row in rdr:
            if map_col and (row.get(map_col) or "").strip() != "CZ":
                continue
            start, upd = parse_utc(row[dt_col] or ""), parse_utc(row[up_col] or "")
            if start is None or upd is None:
                continue
            try:
                value = float(row[val_col]) if val_col else None
            except (TypeError, ValueError):
                value = None
            out.append((start.astimezone(PRAGUE).date(), start, upd, value))
    return out, cols


def report(label, rows):
    print()
    print(f"### {label}")
    if not rows:
        print("    no CZ rows found")
        return
    by_day = {}
    for day, start, upd, value in rows:
        by_day.setdefault(day, []).append((upd, start, value))

    days = sorted(by_day)
    print(f"    delivery days covered: {days[0]} .. {days[-1]}  ({len(days)} days)")
    missing = [(days[0] + dt.timedelta(days=i)).isoformat()
               for i in range((days[-1] - days[0]).days + 1)
               if days[0] + dt.timedelta(days=i) not in by_day]
    print(f"    delivery days with no data at all: {missing or 'none'}")

    def fmt(h):
        sign = "-" if h < 0 else "+"
        h = abs(h)
        return f"{sign}{int(h):02d}:{int(round((h % 1) * 60)):02d}"

    firsts, lasts, revised = [], [], []
    for day in days:
        entries = sorted(by_day[day])
        day_start = dt.datetime.combine(day, dt.time(0), tzinfo=PRAGUE)
        first_t, last_t = entries[0][0], entries[-1][0]
        firsts.append(((first_t - day_start).total_seconds() / 3600.0, day, first_t))
        lasts.append(((last_t - day_start).total_seconds() / 3600.0, day, last_t))
        if (last_t - first_t).total_seconds() <= 900:
            continue
        # Did the republication actually change anything, or just restate it?
        v_first = {s: v for u, s, v in entries if u == first_t}
        v_last = {s: v for u, s, v in entries if u == last_t}
        shared = set(v_first) & set(v_last)
        changed = [abs(v_last[s] - v_first[s]) for s in shared
                   if v_first[s] is not None and v_last[s] is not None
                   and v_last[s] != v_first[s]]
        revised.append((day, first_t, last_t, len(shared), len(changed),
                        max(changed) if changed else 0.0))

    def summarise(name, series):
        vals = sorted(x[0] for x in series)
        p90 = vals[min(len(vals) - 1, int(0.9 * len(vals)))]
        print(f"    {name}: median {fmt(statistics.median(vals))}   p90 {fmt(p90)}   "
              f"earliest {fmt(vals[0])}   latest {fmt(vals[-1])}")
        worst = max(series)
        print(f"        latest such day: {worst[1]} at {worst[2].astimezone(PRAGUE):%Y-%m-%d %H:%M %Z}")
        typ = sorted(series)[len(series) // 2]
        print(f"        median day: {typ[1]} at {typ[2].astimezone(PRAGUE):%Y-%m-%d %H:%M %Z}")

    print("    publication time, as an offset from 00:00 of the delivery day "
          "(negative = before the day begins):")
    summarise("first publication", firsts)
    summarise("last  publication", lasts)

    print(f"    days republished (>15 min after first publication): "
          f"{len(revised)} / {len(days)}")
    for day, lo, hi, shared, changed, worst in revised[:10]:
        if not shared:
            # No period appears in both writes: the day was published in two
            # disjoint chunks, which is a split publication, not a revision.
            verdict = "disjoint periods -- day published in two chunks, not revised"
        elif changed:
            verdict = f"{changed}/{shared} periods changed, max delta {worst:.2f}"
        else:
            verdict = f"all {shared} periods identical -- restated, not corrected"
        print(f"        {day}: {lo.astimezone(PRAGUE):%m-%d %H:%M} -> "
              f"{hi.astimezone(PRAGUE):%m-%d %H:%M %Z}  ({verdict})")
    if len(revised) > 10:
        print(f"        ... and {len(revised) - 10} more")
    if revised:
        n_real = sum(1 for r in revised if r[4])
        n_split = sum(1 for r in revised if not r[3])
        print(f"    of those, {n_real} carried a changed value, "
              f"{len(revised) - n_real - n_split} were identical restatements, "
              f"{n_split} were split publications")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default="2026_08",
                    help="delivery month to report on, as YYYY_MM")
    args = ap.parse_args()
    year, month = (int(x) for x in args.month.split("_"))
    # A Prague delivery day starts at 22:00/23:00 UTC the day before, so the 1st
    # of the month is split across two extracts. Read the previous month too,
    # then keep only delivery days that fall wholly inside the reported month.
    prev = dt.date(year, month, 1) - dt.timedelta(days=1)
    months = (f"{prev.year}_{prev.month:02d}", args.month)

    tok = token()
    root = list_folder(tok)
    for folder, (label, value_col) in SERIES.items():
        if folder not in root:
            print()
            print(f"### {label}")
            print(f"    /TP_export/{folder} is gone; "
                  f"rerun 02_filelibrary_inventory.py")
            continue
        files = list_folder(tok, folder)
        want = [f for f in files if any(m in f for m in months)]
        if not want:
            print()
            print(f"### {label}")
            print(f"    no extract for {months} in {folder!r}; "
                  f"available: {sorted(files)[-6:]}")
            continue
        rows, cols = [], []
        for fname in sorted(want):
            path = download(tok, folder, fname, CACHE)
            r, cols = read_cz_rows(path, value_col)
            kept = [x for x in r if x[0].year == year and x[0].month == month]
            rows += kept
            print(f"    read {fname}: {len(r)} CZ rows, {len(kept)} in {args.month}")
        print(f"    columns: {cols}")
        report(label, rows)


if __name__ == "__main__":
    main()
