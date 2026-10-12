"""Connection pools and the per-request connection dependencies.

Two pools, two database roles: `read` (flownetic_api_ro) for GET endpoints and `write`
(flownetic_api_rw) for the import endpoints.
"""

import re
from collections.abc import Iterator

import psycopg
from fastapi import Request
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from .config import Settings
from .errors import ApiError

_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


def create_pool(settings: Settings, url: str) -> ConnectionPool:
    search_path = settings.db_search_path
    if search_path and not _SCHEMA_RE.match(search_path):
        raise ValueError(f"Invalid db_search_path {search_path!r}")

    def configure(conn: psycopg.Connection) -> None:
        if search_path:
            conn.execute(f"set search_path to {search_path}")

    return ConnectionPool(
        url,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        timeout=settings.db_connect_timeout,
        kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None},
        configure=configure,
        open=False,
    )


def _connection(pool: ConnectionPool | None) -> Iterator[psycopg.Connection]:
    if pool is None:
        raise ApiError(503, "database_unavailable", "Writing is not configured (API_WRITE_DATABASE_URL is missing).")
    try:
        with pool.connection() as conn:
            yield conn
    except (PoolTimeout, psycopg.OperationalError) as e:
        raise ApiError(503, "database_unavailable", "The database is not reachable.") from e


def get_conn(request: Request) -> Iterator[psycopg.Connection]:
    """Read-only connection. Any database failure becomes a 503."""
    yield from _connection(request.app.state.pool)


def get_write_conn(request: Request) -> Iterator[psycopg.Connection]:
    """Connection as the write role (import endpoints only)."""
    yield from _connection(request.app.state.write_pool)
