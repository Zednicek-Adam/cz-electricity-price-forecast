"""Fixtures for tests that run against a real Postgres.

There is no mocked database anywhere in this repository. The database is the
`db` service of `docker-compose.yml`, locally and in the pull request gate, with
the migrations applied by the pinned `dbmate` container:

    docker compose up -d --wait db && docker compose run --rm dbmate up

`DATABASE_URL` overrides the local default.
"""

import os
from collections.abc import Iterator

import psycopg
import pytest

LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/czepf"


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
