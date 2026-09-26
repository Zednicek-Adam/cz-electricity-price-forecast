"""The purity test: a model's `forecast` call reaches no store handle, no
provider and no clock (ADR-0002, ADR-0010).

This is the highest-value test in the repository. Look-ahead is unreachable
only because the model's single source of data is the history it is handed;
nothing else defends that property as the code grows. It is checked five ways,
for every model on the roster:

1. the call takes exactly `(history, target_day)`;
2. the constructed model holds nothing that reaches the store, a provider or a
   clock, looking through closures, partials and bound methods;
3. the call succeeds with the network, the database driver and the clocks
   sealed shut;
4. no module in `forecast.models` imports a way out, opens a file, reads a
   dataset, or asks for the time;
5. behaviourally: rewriting every stored price from the target day onward does
   not change the forecast. This is the check the other four exist to explain.

Check 3 replaces functions with ones that raise. That is not the mocking the
testing rules forbid — nothing stands in for a database or returns a canned
answer; it proves a model never calls out at all.
"""

import ast
import functools
import importlib
import inspect
import pkgutil
import socket
import time
import types
from collections.abc import Iterator
from datetime import date

import pandas as pd
import psycopg
import pytest

import forecast.models
from conftest import built, roster
from forecast.history import StoredHistory
from forecast.loader import load_frozen_dataset
from forecast.runner import run_forecast

SLUGS = roster()

# Modules that are, or that lead to, a store, a provider, a clock or the network.
FORBIDDEN_MODULES = (
    "psycopg",
    "socket",
    "time",
    "urllib",
    "http",
    "httpx",
    "requests",
    "sqlalchemy",
    "sqlite3",
    "forecast.history",
    "forecast.loader",
    "forecast.runner",
)
# Where the store's modules reach data or state, whatever they are imported as.
STORE_MODULES = ("psycopg", "forecast.history", "forecast.loader", "forecast.runner")
FORBIDDEN_CALLS = {"now", "today", "utcnow", "open"}
FORBIDDEN_STRINGS = {"now", "today"}  # pd.Timestamp("now"), np.datetime64("today")


def some_history() -> pd.Series:
    index = pd.date_range("2023-01-01", "2024-12-31 23:00", freq="h")
    return pd.Series(
        [50.0 + (i % 24) + (i % 168) / 10 for i in range(len(index))], index=index
    )


def children(obj: object) -> list[object]:
    if isinstance(obj, dict):
        return [*obj.keys(), *obj.values()]
    if isinstance(obj, list | tuple | set | frozenset):
        return list(obj)
    found = list(getattr(obj, "__dict__", {}).values())
    found += [getattr(obj, s) for s in getattr(obj, "__slots__", ()) if hasattr(obj, s)]
    if isinstance(obj, functools.partial):
        found += [obj.func, *obj.args, *obj.keywords.values()]
    if isinstance(obj, types.MethodType):
        found += [obj.__func__, obj.__self__]
    if isinstance(obj, types.FunctionType):
        found += [cell.cell_contents for cell in obj.__closure__ or ()]
    return found


def reachable(obj: object, seen: set[int] | None = None) -> Iterator[object]:
    """Every object reachable from a model's attributes."""
    seen = set() if seen is None else seen
    if id(obj) in seen or isinstance(obj, str | bytes | int | float | bool | type):
        return
    seen.add(id(obj))
    yield obj
    for child in children(obj):
        yield from reachable(child, seen)


def from_store(obj: object) -> bool:
    """An object or callable that belongs to the store's side of the seam."""
    module = getattr(obj, "__module__", None) or type(obj).__module__
    return module.startswith(STORE_MODULES)


def is_clock(obj: object) -> bool:
    """A bound clock: `time.time`, `datetime.now`, `date.today` and the like."""
    owner = getattr(obj, "__self__", None)
    return owner is time or (isinstance(owner, type) and issubclass(owner, date))


def model_modules() -> list[types.ModuleType]:
    """`forecast.models` and every module inside it, helpers included."""
    package = forecast.models
    return [package] + [
        importlib.import_module(info.name)
        for info in pkgutil.walk_packages(package.__path__, f"{package.__name__}.")
    ]


@pytest.mark.parametrize("slug", SLUGS)
def test_forecast_takes_history_and_a_target_day_and_nothing_else(slug: str) -> None:
    parameters = inspect.signature(built(slug).forecast).parameters

    assert list(parameters) == ["history", "target_day"]


@pytest.mark.parametrize("slug", SLUGS)
def test_a_model_holds_no_store_handle_provider_or_clock(slug: str) -> None:
    for obj in reachable(vars(built(slug))):
        assert not isinstance(obj, types.ModuleType), obj
        assert not from_store(obj), obj
        assert not is_clock(obj), obj


@pytest.mark.parametrize("slug", SLUGS)
def test_forecast_runs_with_the_network_and_the_clocks_sealed(
    slug: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    model = built(slug)

    def sealed(*args: object, **kwargs: object) -> None:
        raise AssertionError("a model reached outside its argument")

    monkeypatch.setattr(psycopg, "connect", sealed)
    monkeypatch.setattr(socket.socket, "connect", sealed)
    for clock in ("time", "time_ns", "monotonic", "perf_counter"):
        monkeypatch.setattr(time, clock, sealed)

    assert len(model.forecast(some_history(), date(2025, 1, 1))) == 24


@pytest.mark.parametrize("module", model_modules(), ids=lambda m: m.__name__)
def test_no_model_module_imports_a_way_out_or_reads_the_time(
    module: types.ModuleType,
) -> None:
    tree = ast.parse(inspect.getsource(module))

    imported: set[str] = set()
    called: set[str] = set()
    strings: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module)
            imported |= {f"{node.module}.{alias.name}" for alias in node.names}
        elif isinstance(node, ast.Call):
            func = node.func
            name = getattr(func, "attr", None) or getattr(func, "id", None)
            called.add(name or "")
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            strings.add(node.value.strip().lower())

    assert not [m for m in imported if m.startswith(FORBIDDEN_MODULES)]
    assert not called & FORBIDDEN_CALLS
    assert not [c for c in called if c.startswith("read_")]  # pd.read_csv & co
    assert not strings & FORBIDDEN_STRINGS


@pytest.fixture(scope="module")
def frozen_store(database_url: str) -> Iterator[psycopg.Connection]:
    """The frozen dataset, loaded once for this module and rolled back after."""
    with (
        psycopg.connect(database_url) as conn,
        conn.transaction(force_rollback=True),
    ):
        load_frozen_dataset(conn)
        yield conn


@pytest.mark.parametrize("slug", SLUGS)
def test_rewriting_the_store_from_the_target_day_onward_changes_no_forecast(
    frozen_store: psycopg.Connection, slug: str
) -> None:
    target = date(2024, 6, 1)
    before = run_forecast(built(slug), target, StoredHistory(frozen_store))

    with frozen_store.transaction(force_rollback=True):
        frozen_store.execute(
            "UPDATE repaired_observed_price SET price = -9999"
            " WHERE delivery_date >= %s",
            (target,),
        )
        after = run_forecast(built(slug), target, StoredHistory(frozen_store))

    assert after == before
