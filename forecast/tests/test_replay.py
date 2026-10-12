"""The replay's own top level, on the real price record and a temporary
forecast record (seam 2).

The replays are short: the first days of 2020, the earliest AR-168 can
forecast.
"""

from collections import Counter
from dataclasses import replace
from datetime import date
from pathlib import Path

import pytest

from forecast.forecasts import read_forecasts, write_forecasts
from forecast.replay import ReplayFailed, replay
from forecast.runner import ForecastRunFailed, HistoryGap

START = date(2020, 1, 1)
END = date(2020, 1, 3)


def counts(path: Path) -> Counter:
    return Counter((r.model, r.run_type, r.code_version) for r in read_forecasts(path))


def test_a_replay_writes_a_backtest_run_per_model_and_day(tmp_path: Path) -> None:
    path = tmp_path / "forecasts.csv"

    result = replay(
        ["daylag", "ar168"], START, END, forecasts_path=path, code_version="abc"
    )

    assert result.forecast_runs == 6
    assert counts(path) == {
        ("ar168", "backtest", "abc"): 3,
        ("daylag", "backtest", "abc"): 3,
    }
    assert [r.delivery_date for r in read_forecasts(path)][::2] == [
        date(2020, 1, 1),
        date(2020, 1, 2),
        date(2020, 1, 3),
    ]


def test_replaying_the_same_range_again_replaces_rather_than_adds(
    tmp_path: Path,
) -> None:
    path = tmp_path / "forecasts.csv"
    replay(["daylag"], START, END, forecasts_path=path, code_version="first")
    replay(["daylag"], START, END, forecasts_path=path, code_version="second")

    assert counts(path) == {("daylag", "backtest", "second"): 3}


def test_a_live_run_is_left_as_it_was(tmp_path: Path) -> None:
    path = tmp_path / "forecasts.csv"
    replay(["daylag"], START, START, forecasts_path=path, code_version="first")
    (run,) = read_forecasts(path)
    write_forecasts([replace(run, run_type="live")], path)

    result = replay(["daylag"], START, END, forecasts_path=path, code_version="next")

    assert (result.forecast_runs, result.skipped_live) == (2, 1)
    assert counts(path) == {
        ("daylag", "live", "first"): 1,
        ("daylag", "backtest", "next"): 2,
    }


def test_a_run_that_cannot_be_made_stops_the_replay_and_keeps_the_runs_before(
    tmp_path: Path,
) -> None:
    path = tmp_path / "forecasts.csv"

    # AR-168 needs 730 days; the record opens 2018-01-01, so 2019-12-31 has one
    # day too few and AR-168 stops there. The naïve, which ran first, is kept.
    with pytest.raises(ReplayFailed) as failure:
        replay(
            ["daylag", "ar168"],
            date(2019, 12, 31),
            END,
            forecasts_path=path,
            code_version="abc",
        )

    # The failure says where: which stage, which model, which day, and why.
    assert str(failure.value).startswith(
        "stage 'forecast ar168' failed: ar168 on 2019-12-31: forecast failed:"
    )
    run = failure.value.__cause__
    assert isinstance(run, ForecastRunFailed)
    assert isinstance(run.__cause__, HistoryGap)
    assert counts(path) == {("daylag", "backtest", "abc"): 4}


def test_an_unknown_model_is_refused_before_anything_is_written(
    tmp_path: Path,
) -> None:
    path = tmp_path / "forecasts.csv"

    with pytest.raises(ValueError, match="unknown model"):
        replay(["daylag", "lear"], START, END, forecasts_path=path)

    assert not path.exists()


def test_a_day_without_a_published_price_is_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="no published price"):
        replay(["daylag"], START, date(2099, 1, 1), forecasts_path=tmp_path / "f.csv")
