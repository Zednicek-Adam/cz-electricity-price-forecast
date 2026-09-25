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


@pytest.fixture
def database_url() -> str:
    return os.environ.get("DATABASE_URL", LOCAL_DATABASE_URL)


@pytest.fixture
def db(database_url: str) -> Iterator[psycopg.Connection]:
    """A connection whose every write is rolled back when the test ends."""
    with psycopg.connect(database_url) as conn:
        conn.execute("BEGIN")
        try:
            yield conn
        finally:
            conn.rollback()
