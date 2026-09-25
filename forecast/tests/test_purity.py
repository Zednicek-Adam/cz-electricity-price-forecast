"""The purity test: a model's `forecast` call reaches no store handle, no
provider and no clock (ADR-0002, ADR-0010).

This is the highest-value test in the repository. Look-ahead is unreachable
only because the model's single source of data is the history it is handed;
nothing else defends that property as the code grows. It is checked four ways,
for every model on the roster:

1. the call takes exactly `(history, target_day)`;
2. the constructed model holds no connection, cursor, provider or clock;
3. the call succeeds with the network and the clocks sealed shut;
4. the model's module neither imports a way out nor reads the time.

Seam 2 adds the behavioural half: rewriting the store from the target day
onward does not change a forecast (tests/test_runner.py).
"""

import ast
import inspect
import socket
import sys
import time
import types
from collections.abc import Iterator
from datetime import date

import pandas as pd
import psycopg
import pytest

from forecast import history as history_module
from forecast.models import ROSTER, build

SLUGS = sorted(ROSTER)

FORBIDDEN_IMPORTS = {
    "psycopg",
    "socket",
    "time",
    "forecast.history",
    "forecast.loader",
    "forecast.runner",
}
FORBIDDEN_CALLS = {"now", "today", "utcnow"}


def some_history() -> pd.Series:
    index = pd.date_range("2023-01-01", "2024-12-31 23:00", freq="h")
    return pd.Series(
        [50.0 + (i % 24) + (i % 168) / 10 for i in range(len(index))], index=index
    )


def reachable(obj: object, seen: set[int] | None = None) -> Iterator[object]:
    """Every object reachable from a model's attributes."""
    seen = set() if seen is None else seen
    if id(obj) in seen or isinstance(obj, str | bytes | int | float | bool):
        return
    seen.add(id(obj))
    yield obj
    if isinstance(obj, dict):
        children = [*obj.keys(), *obj.values()]
    elif isinstance(obj, list | tuple | set | frozenset):
        children = list(obj)
    else:
        children = list(getattr(obj, "__dict__", {}).values())
        children += [getattr(obj, s) for s in getattr(obj, "__slots__", ())]
    for child in children:
        yield from reachable(child, seen)


def is_clock(obj: object) -> bool:
    """A bound clock: `time.time`, `datetime.now`, `date.today` and the like."""
    owner = getattr(obj, "__self__", None)
    return owner is time or (isinstance(owner, type) and issubclass(owner, date))


@pytest.mark.parametrize("slug", SLUGS)
def test_forecast_takes_history_and_a_target_day_and_nothing_else(slug: str) -> None:
    parameters = inspect.signature(build(slug).forecast).parameters

    assert list(parameters) == ["history", "target_day"]


@pytest.mark.parametrize("slug", SLUGS)
def test_a_model_holds_no_store_handle_provider_or_clock(slug: str) -> None:
    for obj in reachable(vars(build(slug))):
        assert not isinstance(obj, psycopg.Connection | psycopg.Cursor)
        assert not isinstance(obj, types.ModuleType)
        assert type(obj).__module__ != history_module.__name__
        assert not is_clock(obj)


@pytest.mark.parametrize("slug", SLUGS)
def test_forecast_runs_with_the_network_and_the_clocks_sealed(
    slug: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = build(slug)

    def sealed(*args: object, **kwargs: object) -> None:
        raise AssertionError("a model reached outside its argument")

    monkeypatch.setattr(psycopg, "connect", sealed)
    monkeypatch.setattr(socket.socket, "connect", sealed)
    for clock in ("time", "time_ns", "monotonic", "perf_counter"):
        monkeypatch.setattr(time, clock, sealed)

    assert len(model.forecast(some_history(), date(2025, 1, 1))) == 24


@pytest.mark.parametrize("slug", SLUGS)
def test_a_model_module_imports_no_way_out_and_reads_no_time(slug: str) -> None:
    module = sys.modules[ROSTER[slug].__module__]
    tree = ast.parse(inspect.getsource(module))

    imported = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
    called = {
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }

    assert not imported & FORBIDDEN_IMPORTS
    assert not called & FORBIDDEN_CALLS
