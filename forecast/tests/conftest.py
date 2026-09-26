"""Fixtures for tests that run against a real Postgres.

There is no mocked database anywhere in this repository. The database is the
`db` service of `docker-compose.yml`, locally and in the pull request gate, with
the migrations applied by the pinned `dbmate` container:

    docker compose up -d --wait db && docker compose run --rm dbmate up

`DATABASE_URL` overrides the local default.
"""

import os
from collections.abc import Iterator
from functools import cache

import psycopg
import pytest

from forecast.model import Model
from forecast.models import DOWNLOADED, ROSTER, build

LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/czepf"


def roster() -> list:
    """Every model on the roster as a test parameter. Chronos-2 carries the
    `chronos` marker, so the default run, the gate's, never builds it."""
    return [
        pytest.param(slug, marks=pytest.mark.chronos) if slug in DOWNLOADED else slug
        for slug in sorted(ROSTER)
    ]


@cache
def built(slug: str) -> Model:
    """A model built once per test session: Chronos-2 takes seconds to load."""
    return build(slug)


@pytest.fixture(scope="session")
def database_url() -> str:
    return os.environ.get("DATABASE_URL", LOCAL_DATABASE_URL)


@pytest.fixture
def db(database_url: str) -> Iterator[psycopg.Connection]:
    """A connection whose every write is rolled back when the test ends.

    Everything a test does, including a `conn.transaction()` block in the code
    under test (which becomes a savepoint), sits inside one transaction that is
    rolled back at the end, whatever the test's first statement is.
    """
    with (
        psycopg.connect(database_url) as conn,
        conn.transaction(force_rollback=True),
    ):
        yield conn
