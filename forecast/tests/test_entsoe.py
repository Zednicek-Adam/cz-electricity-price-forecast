"""Parsing the A44 document, on responses the platform actually sent
(`fixtures/`, ADR-0011): a 23-hour spring-forward day, a 100-quarter-hour
fall-back day, a day published as two identical `TimeSeries`, and a range with
no data. The hazards the fixtures do not happen to show are made from them."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from conftest import FIXTURES
from forecast.entsoe import EntsoeError, parse_prices


def fixture(name: str) -> bytes:
    return (FIXTURES / f"{name}.xml").read_bytes()


def test_a_spring_forward_day_is_23_hourly_periods() -> None:
    prices = parse_prices(fixture("spring-forward-2025-03-30"))

    assert len(prices) == 23
    assert {p.resolution_minutes for p in prices} == {60}
    assert prices[0].delivery_start == datetime(2025, 3, 29, 23, tzinfo=UTC)
    assert prices[-1].delivery_start == datetime(2025, 3, 30, 21, tzinfo=UTC)


def test_a_fall_back_day_is_100_quarter_hours() -> None:
    prices = parse_prices(fixture("fall-back-2025-10-26"))

    assert len(prices) == 100
    assert {p.resolution_minutes for p in prices} == {15}
    steps = {
        b.delivery_start - a.delivery_start
        for a, b in zip(prices, prices[1:], strict=False)
    }
    assert steps == {timedelta(minutes=15)}


def test_a_day_published_twice_is_kept_once() -> None:
    document = fixture("duplicated-2026-08-08")
    assert document.count(b"<TimeSeries>") == 2

    assert len(parse_prices(document)) == 96


def test_no_matching_data_is_no_prices() -> None:
    assert parse_prices(fixture("not-published")) == []


def drop_point(document: bytes, position: int) -> bytes:
    """The document with one point removed, as A03 publishes a repeated value."""
    text = document.decode()
    start = text.index(f"<position>{position}</position>")
    start = text.rindex("<Point>", 0, start)
    end = text.index("</Point>", start) + len("</Point>")
    return (text[:start] + text[end:]).encode()


def test_a03_carries_the_previous_value_into_a_missing_position() -> None:
    full = parse_prices(fixture("spring-forward-2025-03-30"))

    gapped = parse_prices(drop_point(fixture("spring-forward-2025-03-30"), 7))

    assert len(gapped) == 23
    assert gapped[6].delivery_start == full[6].delivery_start
    assert gapped[6].price == full[5].price
    assert gapped[:6] == full[:6] and gapped[7:] == full[7:]


def test_a_missing_first_position_raises() -> None:
    with pytest.raises(EntsoeError, match="no first position"):
        parse_prices(drop_point(fixture("spring-forward-2025-03-30"), 1))


def test_a_missing_position_outside_a03_raises() -> None:
    document = fixture("spring-forward-2025-03-30").replace(
        b"<curveType>A03</curveType>", b"<curveType>A01</curveType>"
    )

    with pytest.raises(EntsoeError, match="position 7 missing"):
        parse_prices(drop_point(document, 7))


def test_copies_of_a_period_that_disagree_raise() -> None:
    text = fixture("duplicated-2026-08-08").decode()
    second = text.index("<TimeSeries>", text.index("<TimeSeries>") + 1)
    amount = text.index("<price.amount>", second) + len("<price.amount>")
    changed = text[:amount] + "9" + text[amount:]

    with pytest.raises(EntsoeError, match="published twice"):
        parse_prices(changed.encode())


def test_a_price_not_in_eur_per_mwh_raises() -> None:
    document = fixture("spring-forward-2025-03-30").replace(b">EUR<", b">CZK<")

    with pytest.raises(EntsoeError, match="CZK"):
        parse_prices(document)


def test_prices_are_exact_decimals_as_published() -> None:
    prices = parse_prices(fixture("fall-back-2025-10-26"))

    assert all(isinstance(p.price, Decimal) for p in prices)
    assert all(p.price == p.price.quantize(Decimal("0.01")) for p in prices)
