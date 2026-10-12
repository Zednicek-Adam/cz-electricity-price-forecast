"""The export, on the real price record and a forecast record of the naïve over
the frozen backtest, written into temporary directories."""

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


def exported(tmp_path: Path, runs: list[StoredRun]) -> Path:
    forecasts = tmp_path / "forecasts.csv"
    write_forecasts(runs, forecasts)
    out = tmp_path / "data"
    export(out, forecasts_path=forecasts)
    return out


def read(out: Path, name: str) -> Any:
    return json.loads((out / name).read_text(encoding="utf-8"))


def test_every_view_gets_its_file(tmp_path: Path, runs: list[StoredRun]) -> None:
    out = exported(tmp_path, runs)

    assert read(out, "record.json") == {
        "first": "2020-01-01",
        "last": "2024-12-31",
        "pending": None,
    }
    assert len(list((out / "days").iterdir())) == 1827
    for metric in ("mae", "rmse", "smape", "rmae"):
        running = read(out, f"running/{metric}.json")
        assert len(running["series"][0]["values"]) == len(running["deliveryDates"])
        assert (out / "daily" / f"{metric}.json").exists()
    for model in ("chronos2", "ar168", "daylag"):
        assert read(out, f"comparisons/{model}.json")["model"] == model


def test_a_day_file_carries_the_observed_price_forecasts_and_metrics(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    out = exported(tmp_path, runs)

    day = read(out, "days/2024-03-31.json")  # spring forward, repaired to 24

    assert day["deliveryDate"] == "2024-03-31"
    assert len(day["observed"]) == 24
    assert [f["model"] for f in day["forecasts"]] == ["daylag"]
    assert day["metrics"][0]["model"] == "daylag"
    assert day["metrics"][0]["rmae"] == 1.0


def test_the_accuracy_table_reads_the_naive_at_exactly_one(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    out = exported(tmp_path, runs)

    (row,) = read(out, "accuracy.json")["rows"]
    assert row["model"] == "daylag"
    assert row["rmae"] == 1.0


def test_the_pending_day_has_no_observed_price_and_no_metrics(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    last = runs[-1]
    pending = date(2099, 1, 1)
    out = exported(
        tmp_path, [*runs, replace(last, delivery_date=pending, run_type="live")]
    )

    record = read(out, "record.json")
    assert (record["last"], record["pending"]) == ("2099-01-01", "2099-01-01")
    day = read(out, "days/2099-01-01.json")
    assert day["observed"] is None
    assert day["metrics"] == []
    assert len(day["forecasts"]) == 1
    # A day between, with a price and no forecast, still has its file.
    between = read(out, "days/2026-06-01.json")
    assert (len(between["observed"]), between["forecasts"]) == (24, [])


def test_a_hole_in_the_backtest_stops_the_export(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    holed = [r for r in runs if r.delivery_date != date(2022, 2, 22)]

    with pytest.raises(RecordInvalid, match="every delivery day"):
        exported(tmp_path, holed)
    assert not (tmp_path / "data").exists()


def test_two_pending_days_stop_the_export(
    tmp_path: Path, runs: list[StoredRun]
) -> None:
    last = runs[-1]
    days = [date(2099, 1, 1), date(2099, 1, 1) + timedelta(days=1)]
    pending = [replace(last, delivery_date=d, run_type="live") for d in days]

    with pytest.raises(RecordInvalid, match="2 pending"):
        exported(tmp_path, [*runs, *pending])
