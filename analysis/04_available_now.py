"""Ticket #14, cross-check: what is actually reachable for tomorrow, right now?

The File Library shows one UpdateTime per period, and for the two forecast series
it keeps no duplicate rows -- so a rewrite and a first publication look the same.
That ambiguity matters for exactly one conclusion: whether the CZ day-ahead
generation forecast is available before its delivery day at all.

This settles it from the other side. If a series can be fetched for delivery day
D+1 now, it is available a day ahead regardless of what UpdateTime says. If it
cannot, it is not.
"""
import datetime as dt
import pathlib
import urllib.parse
import xml.etree.ElementTree as ET
import zoneinfo

from tp_http import get

ROOT = pathlib.Path(__file__).resolve().parents[1]
CZ = "10YCZ-CEPS-----N"
BASE = "https://web-api.tp.entsoe.eu/api"
PRAGUE = zoneinfo.ZoneInfo("Europe/Prague")

TOKEN = next(l.split("=", 1)[1].strip()
             for l in (ROOT / ".env").read_text(encoding="utf-8").splitlines()
             if l.startswith("API_TOKEN="))

now = dt.datetime.now(PRAGUE)
print(f"asked at {now:%Y-%m-%d %H:%M %Z}")

QUERIES = {
    "Day-ahead price (12.1.D)":
        {"documentType": "A44", "in_Domain": CZ, "out_Domain": CZ},
    "Day-ahead load forecast (6.1.B)":
        {"documentType": "A65", "processType": "A01", "outBiddingZone_Domain": CZ},
    "Day-ahead generation forecast (14.1.C)":
        {"documentType": "A71", "processType": "A01", "in_Domain": CZ},
}

for offset in (0, 1):
    day = (now + dt.timedelta(days=offset)).date()
    start = dt.datetime.combine(day, dt.time(0), tzinfo=PRAGUE)
    end = start + dt.timedelta(days=1)
    label = {0: "today (D)", 1: "tomorrow (D+1)"}[offset]
    print(f"\n=== delivery day {day} -- {label}")
    for name, params in QUERIES.items():
        q = dict(params,
                 periodStart=start.astimezone(dt.timezone.utc).strftime("%Y%m%d%H%M"),
                 periodEnd=end.astimezone(dt.timezone.utc).strftime("%Y%m%d%H%M"),
                 securityToken=TOKEN)
        slug = name.split("(")[1].rstrip(")").replace(".", "_")
        status, body = get(BASE + "?" + urllib.parse.urlencode(q),
                           f"avail_{slug}_{day}.xml")
        try:
            root = ET.fromstring(body)
        except ET.ParseError:
            print(f"    {name:42s} HTTP {status}  unparseable")
            continue
        ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
        points = sum(1 for _ in root.iter(ns + "Point"))
        reason = next((r.findtext(ns + "text") for r in root.iter(ns + "Reason")), None)
        verdict = f"{points} points" if points else f"NOT AVAILABLE ({reason})"
        print(f"    {name:42s} HTTP {status}  {verdict}")
