"""PostgreSQL connection and transaction helpers for API v1 Lambda handlers."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

import psycopg2
from psycopg2.extras import RealDictCursor


_connection = None


def _database_config() -> dict[str, object]:
    required = ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError("Database configuration is incomplete")
    return {
        "host": os.environ["DB_HOST"],
        "port": int(os.environ.get("DB_PORT", "5432")),
        "dbname": os.environ["DB_NAME"],
        "user": os.environ["DB_USER"],
        "password": os.environ["DB_PASSWORD"],
        "connect_timeout": int(os.environ.get("DB_CONNECT_TIMEOUT_SECONDS", "5")),
        "sslmode": os.environ.get("DB_SSLMODE", "require"),
    }


def _reset_connection() -> None:
    global _connection
    if _connection is not None:
        try:
            _connection.close()
        except Exception:
            pass
    _connection = None


def get_connection():
    """Return a warm Lambda connection, replacing stale connections safely."""

    global _connection
    try:
        if _connection is None or _connection.closed:
            _connection = psycopg2.connect(**_database_config())
            _connection.autocommit = False
        else:
            with _connection.cursor() as cursor:
                cursor.execute("SELECT 1")
    except psycopg2.Error:
        _reset_connection()
        _connection = psycopg2.connect(**_database_config())
        _connection.autocommit = False
    return _connection


@contextmanager
def transaction() -> Iterator[RealDictCursor]:
    """Yield a cursor and commit exactly once, rolling back on every failure."""

    connection = get_connection()
    cursor = connection.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute("SET LOCAL statement_timeout = '5000ms'")
        yield cursor
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        cursor.close()
