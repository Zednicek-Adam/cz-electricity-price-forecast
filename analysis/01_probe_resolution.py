"""Ticket #14, question 4: after the 2025-10-01 changeover, does ENTSO-E publish
a PT60M day-ahead price for CZ, or only PT15M?

If PT60M is absent the hourly target must be derived via the Average Rule, which
changes the schema (ADR-0005 left a `derivation` column deferred for exactly this).

Also records the resolution codes and Reason codes actually returned either side
of the changeover -- facts the ticket asks to be written into the resolution.

Raw responses land in analysis/raw/ (gitignored): this repo is public and the
republication licence question (#20) is unresolved.
"""
import pathlib
import urllib.parse
import xml.etree.ElementTree as ET

from tp_http import get

ROOT = pathlib.Path(__file__).resolve().parents[1]
CZ = "10YCZ-CEPS-----N"
BASE = "https://web-api.tp.entsoe.eu/api"

TOKEN = next(l.split("=", 1)[1].strip()
             for l in (ROOT / ".env").read_text(encoding="utf-8").splitlines()
             if l.startswith("API_TOKEN="))


def summarise(body):
    """(root tag, [dict per Period]) -- or a Reason row when the query returns none."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        return f"unparseable: {e}", []
    ns = root.tag.split("}")[0] + "}" if "}" in root.tag else ""
    rows = []
    for ts in root.iter(ns + "TimeSeries"):
        biz = ts.findtext(ns + "businessType")
        ctr = ts.findtext(ns + "contract_MarketAgreement.type")
        for per in ts.iter(ns + "Period"):
            ti = per.find(ns + "timeInterval")
            pos = [int(p.findtext(ns + "position")) for p in per.findall(ns + "Point")]
            rows.append(dict(
                businessType=biz, contract=ctr,
                resolution=per.findtext(ns + "resolution"),
                n_points=len(pos),
                last_position=max(pos) if pos else None,
                missing_positions=sorted(set(range(1, max(pos) + 1)) - set(pos)) if pos else [],
                start=ti.findtext(ns + "start") if ti is not None else None,
                end=ti.findtext(ns + "end") if ti is not None else None,
            ))
    for reason in root.iter(ns + "Reason"):
        rows.append(dict(reason_code=reason.findtext(ns + "code"),
                         reason_text=reason.findtext(ns + "text")))
    return root.tag.split("}")[-1], rows


CASES = [
    # label, window, extra query params
    ("price_pre_break",             ("202406120000", "202406130000"), {}),
    ("price_day_before_changeover", ("202509300000", "202510010000"), {}),
    ("price_changeover_day",        ("202510010000", "202510020000"), {}),
    ("price_post_break",            ("202606120000", "202606130000"), {}),
    # Is the Average-Rule hourly price reachable behind a different market agreement?
    ("price_post_break_a01", ("202606120000", "202606130000"),
     {"contract_MarketAgreement.Type": "A01"}),
    # Does the DST evidence still hold on the 15-minute side? (100 periods, not 96)
    ("price_dst_autumn_post_break", ("202510250000", "202510260000"), {}),
]

for label, (start, end), extra in CASES:
    params = dict(documentType="A44", in_Domain=CZ, out_Domain=CZ,
                  periodStart=start, periodEnd=end, securityToken=TOKEN, **extra)
    status, body = get(BASE + "?" + urllib.parse.urlencode(params), label + ".xml")
    tag, rows = summarise(body)
    print(f"\n=== {label}  [{start} -> {end}]  extra={extra or '-'}")
    print(f"    HTTP {status}  root=<{tag}>  bytes={len(body)}")
    for r in rows:
        print("   ", r)
