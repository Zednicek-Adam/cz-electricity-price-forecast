"""The ENTSO-E Transparency Platform: the single source of record (ADR-0011).

One document type is read: A44, the day-ahead price, for the Czech bidding
zone. A request covers at most a year: a longer range is HTTP 400.

Parsing is where the hazards are, and each is defended by an XML fixture in the
tests:

* **`curveType` A03.** A missing position means the previous value continues,
  not a hole. The positions a period should have come from its time interval
  and resolution, never from the points present.
* **Duplicate `TimeSeries`.** The same delivery period can arrive more than
  once. Copies that agree are kept once; copies that disagree raise.
* **No data** is an acknowledgement document rather than an error, and parses
  to no prices.

The security token is sent as a query parameter, so nothing here ever logs or
raises with a request URL in it.
"""

import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from forecast.loader import ObservedPrice

API = "https://web-api.tp.entsoe.eu/api"
CZ = "10YCZ-CEPS-----N"
MAX_RANGE = timedelta(days=365)
RESOLUTIONS = {"PT60M": 60, "PT15M": 15}
ATTEMPTS = 3

Fetch = Callable[[datetime, datetime], bytes]


class EntsoeError(RuntimeError):
    """The platform answered with something that is not a usable price document."""


def fetcher(token: str, *, timeout: float = 120) -> Fetch:
    """A function that fetches the A44 document for `[start, end)`, UTC."""

    def fetch(start: datetime, end: datetime) -> bytes:
        if end - start > MAX_RANGE:
            raise ValueError(f"{start} to {end} is more than a year")
        query = urllib.parse.urlencode(
            {
                "documentType": "A44",
                "in_Domain": CZ,
                "out_Domain": CZ,
                "periodStart": f"{start.astimezone(UTC):%Y%m%d%H%M}",
                "periodEnd": f"{end.astimezone(UTC):%Y%m%d%H%M}",
                "securityToken": token,
            }
        )
        for attempt in range(1, ATTEMPTS + 1):
            try:
                with urllib.request.urlopen(f"{API}?{query}", timeout=timeout) as r:
                    return r.read()
            except urllib.error.HTTPError as error:
                body = error.read()
                # "No matching data" comes back as a 400 with an acknowledgement.
                if b"Acknowledgement_MarketDocument" in body:
                    return body
                if error.code < 500 or attempt == ATTEMPTS:
                    raise EntsoeError(
                        f"HTTP {error.code} for {start:%Y-%m-%d} to {end:%Y-%m-%d}"
                    ) from None
            except (urllib.error.URLError, TimeoutError) as error:
                if attempt == ATTEMPTS:
                    raise EntsoeError(
                        f"no response for {start:%Y-%m-%d} to {end:%Y-%m-%d}:"
                        f" {getattr(error, 'reason', error)}"
                    ) from None
            time.sleep(10 * attempt)
        raise AssertionError("unreachable")

    return fetch


def _timestamp(text: str | None) -> datetime:
    if text is None:
        raise EntsoeError("a time interval without a start or an end")
    return datetime.strptime(text, "%Y-%m-%dT%H:%MZ").replace(tzinfo=UTC)


def parse_prices(document: bytes) -> list[ObservedPrice]:
    """Every delivery period's price in an A44 document, each period once."""
    try:
        root = ET.fromstring(document)
    except ET.ParseError as error:
        raise EntsoeError(f"not XML: {error}") from None
    ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
    kind = root.tag.removeprefix(ns)
    if kind == "Acknowledgement_MarketDocument":
        code = root.findtext(f"{ns}Reason/{ns}code")
        text = root.findtext(f"{ns}Reason/{ns}text")
        if code == "999":  # no matching data
            return []
        raise EntsoeError(f"acknowledgement {code}: {text}")
    if kind != "Publication_MarketDocument":
        raise EntsoeError(f"unexpected document {kind}")

    prices: dict[datetime, ObservedPrice] = {}
    for series in root.iter(f"{ns}TimeSeries"):
        currency = series.findtext(f"{ns}currency_Unit.name")
        unit = series.findtext(f"{ns}price_Measure_Unit.name")
        if (currency, unit) != ("EUR", "MWH"):
            raise EntsoeError(f"prices in {currency}/{unit}, not EUR/MWH")
        curve = series.findtext(f"{ns}curveType") or "A01"
        for period in series.iter(f"{ns}Period"):
            for price in _period_prices(period, ns, curve):
                held = prices.get(price.delivery_start)
                if held is not None and held != price:
                    raise EntsoeError(
                        f"{price.delivery_start:%Y-%m-%dT%H:%MZ} published twice,"
                        f" as {held.price} and {price.price}"
                    )
                prices[price.delivery_start] = price
    return sorted(prices.values(), key=lambda p: p.delivery_start)


def _period_prices(period: ET.Element, ns: str, curve: str) -> list[ObservedPrice]:
    start = _timestamp(period.findtext(f"{ns}timeInterval/{ns}start"))
    end = _timestamp(period.findtext(f"{ns}timeInterval/{ns}end"))
    code = period.findtext(f"{ns}resolution")
    if code not in RESOLUTIONS:
        raise EntsoeError(f"unknown resolution {code}")
    minutes = RESOLUTIONS[code]
    step = timedelta(minutes=minutes)
    count = (end - start) // step

    points: dict[int, Decimal] = {}
    for point in period.iter(f"{ns}Point"):
        position = int(point.findtext(f"{ns}position") or 0)
        amount = point.findtext(f"{ns}price.amount")
        if not 1 <= position <= count or amount is None:
            raise EntsoeError(f"{start:%Y-%m-%dT%H:%MZ}: bad point {position}")
        points[position] = Decimal(amount)
    if 1 not in points:
        raise EntsoeError(f"{start:%Y-%m-%dT%H:%MZ}: no first position")

    prices = []
    current = points[1]
    for position in range(1, count + 1):
        if position in points:
            current = points[position]
        elif curve != "A03":
            raise EntsoeError(f"{start:%Y-%m-%dT%H:%MZ}: position {position} missing")
        prices.append(ObservedPrice(start + (position - 1) * step, minutes, current))
    return prices
