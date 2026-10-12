"""The export, on the real price record and a forecast record of the naïve over
the 2020–2024 backtest, written into temporary directories."""

import json
from dataclasses import replace
from datetime import date, timedelta
from functools import cache
from pathlib import Path
from typing import Any

import pytest

from forecast.export import RecordInvalid, export
from forecast.forecasts import StoredRun, read_forecasts, write_forecasts
from forecast.replay import replay

LAST_BACKTEST_DAY = date(2024, 12, 31)


@cache
def naive_backtest(directory: Path) -> tuple[StoredRun, ...]:
    path = directory / "forecasts.csv"
    replay(
        ["daylag"],
        date(2020, 1, 1),
        LAST_BACKTEST_DAY,
        forecasts_path=path,
        code_version="test",
    )
    return tuple(read_forecasts(path))


@pytest.fixture
def runs(tmp_path_factory: pytest.TempPathFactory) -> list[StoredRun]:
    return list(naive_backtest(tmp_path_factory.getbasetemp()))


def exported(tmp_path: Path, runs: list[StoredRun]) -> dict[str, Any]:
    forecasts = tmp_path / "forecasts.csv"
    write_forecasts(runs, forecasts)
    out = tmp_path / "dashboard.json"
    export(out, forecasts_path=forecasts)
    return json.loads(out.read_text(encoding="utf-8"))


def test_one_file_carries_every_view(tmp_path: Path, runs: list[StoredRun]) -> None:
    dashboard = exported(tmp_path, runs)

    assert dashboard["record"] == {
        "first": "2020-01-01",
        "last": "2024-12-31",
        "pending": None,
    }
    assert dashboard["models"] == ["daylag"]
    assert len(dashboard["days"]) == 1827
    running, trailing = dashboard["running"], dashboard["trailing"]
    for metric in ("mae", "rmse", "smape", "rmae"):
        assert len(running[metric]["daylag"]) == len(running["dates"]) == 1827
        assert len(trailing[metric]["daylag"]) == 1827
    assert dashboard["accuracy"]["whole"]["daylag"]["rmae"] == 1.0
    assert dashboard["comparisons"] == {
        "whole": {"daylag": {}},
        "window": {"daylag": {}},
    }


def test_the_window_is_the_last_thirty_scored_days(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    dashboard = exported(tmp_path, runs)

    assert dashboard["window"] == {
        "days": 30,
        "first": "2024-12-02",
        "last": "2024-12-31",
    }
    trailing = dashboard["trailing"]["mae"]["daylag"]
    # No figure until a whole window fits, then one on every day.
    assert trailing[:29] == [None] * 29
    assert None not in trailing[29:]
    # The trailing figure on the last day is the window scope's figure.
    window = dashboard["accuracy"]["window"]["daylag"]
    assert trailing[-1] == pytest.approx(window["mae"], rel=1e-5)
    assert window["rmae"] == 1.0


def test_a_day_carries_the_observed_price_forecasts_and_metrics(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    day = exported(tmp_path, runs)["days"]["2024-03-31"]  # spring forward

    assert len(day["observed"]) == 24
    assert list(day["forecasts"]) == ["daylag"]
    assert len(day["forecasts"]["daylag"]) == 24
    assert day["metrics"]["daylag"]["rmae"] == 1.0


def test_forecasts_are_rounded_to_the_cent_and_figures_to_six_digits(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    noisy = [replace(r, prices=tuple(p + 1 / 3 for p in r.prices)) for r in runs]

    dashboard = exported(tmp_path, noisy)

    prices = dashboard["days"]["2024-06-01"]["forecasts"]["daylag"]
    assert all(p == round(p, 2) for p in prices)
    mae = dashboard["accuracy"]["whole"]["daylag"]["mae"]
    assert mae == float(f"{mae:.6g}")


def test_the_pending_day_has_no_observed_price_and_no_metrics(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    last = runs[-1]
    pending = date(2099, 1, 1)

    dashboard = exported(
        tmp_path, [*runs, replace(last, delivery_date=pending, run_type="live")]
    )

    record = dashboard["record"]
    assert (record["last"], record["pending"]) == ("2099-01-01", "2099-01-01")
    day = dashboard["days"]["2099-01-01"]
    assert day["observed"] is None
    assert day["metrics"] == {}
    assert list(day["forecasts"]) == ["daylag"]
    # A day between, with a price and no forecast, is still in the record.
    between = dashboard["days"]["2026-06-01"]
    assert (len(between["observed"]), between["forecasts"]) == (24, {})


def test_a_hole_in_the_backtest_stops_the_export(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    holed = [r for r in runs if r.delivery_date != date(2022, 2, 22)]

    with pytest.raises(RecordInvalid, match="every delivery day"):
        exported(tmp_path, holed)
    assert not (tmp_path / "dashboard.json").exists()


def test_two_pending_days_stop_the_export(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    last = runs[-1]
    days = [date(2099, 1, 1), date(2099, 1, 1) + timedelta(days=1)]
    pending = [replace(last, delivery_date=d, run_type="live") for d in days]

    with pytest.raises(RecordInvalid, match="2 pending"):
        exported(tmp_path, [*runs, *pending])
