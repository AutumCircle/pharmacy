"""Temporary pre-v1 rollback-copy and migration Lambda.

This handler must be deployed as a separate Lambda, never added to the legacy
public action router. Delete the function after the migration is verified.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from pathlib import Path
from typing import Any

import psycopg2
from psycopg2 import sql
from psycopg2.extras import RealDictCursor


BACKUP_CONFIRMATION = "CREATE_PRE_V1_ROLLBACK_COPY"
MIGRATION_CONFIRMATION = "APPLY_VATAN_V1_MIGRATION"
BACKUP_TABLES = (
    "users",
    "orders",
    "order_items",
    "categories",
    "category_medicines",
    "featured_products",
    "medicines",
    "sync_logs",
)
DEFAULT_BACKUP_SCHEMA = "vatan_pre_v1_20260806"
SCHEMA_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
MIGRATION_FILE = (
    Path(__file__).resolve().parents[3]
    / "db"
    / "migrations"
    / "0001_api_v1_foundation.sql"
)


class OperationError(RuntimeError):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.safe_message = message


def _response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(payload, ensure_ascii=False, default=str),
    }


def _headers(event: dict[str, Any]) -> dict[str, str]:
    return {
        str(key).lower(): str(value)
        for key, value in (event.get("headers") or {}).items()
        if value is not None
    }


def _body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or "{}"
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as exc:
        raise OperationError(400, "INVALID_JSON", "Request body is not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise OperationError(400, "INVALID_REQUEST", "Request body must be an object")
    return parsed


def _authorize(event: dict[str, Any]) -> None:
    if os.environ.get("MIGRATION_ENABLED", "").lower() != "true":
        raise OperationError(503, "MIGRATION_DISABLED", "Migration Lambda is disabled")
    expected = os.environ.get("MIGRATION_ADMIN_TOKEN", "")
    provided = _headers(event).get("x-migration-token", "")
    if len(expected) < 32 or not hmac.compare_digest(provided, expected):
        raise OperationError(403, "FORBIDDEN", "Migration authorization failed")


def _backup_schema() -> str:
    name = os.environ.get("MIGRATION_BACKUP_SCHEMA", DEFAULT_BACKUP_SCHEMA)
    if not SCHEMA_NAME_PATTERN.fullmatch(name):
        raise OperationError(500, "INVALID_CONFIGURATION", "Backup schema name is invalid")
    return name


def _connect():
    required = ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD")
    if any(not os.environ.get(name) for name in required):
        raise OperationError(500, "INVALID_CONFIGURATION", "Database configuration is incomplete")
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        connect_timeout=5,
        sslmode=os.environ.get("DB_SSLMODE", "require"),
        application_name="vatan-v1-migration",
    )


def _acquire_lock(cursor: RealDictCursor) -> None:
    cursor.execute("SELECT pg_try_advisory_xact_lock(hashtext(%s)) AS acquired", ("vatan-v1-migration",))
    if not cursor.fetchone()["acquired"]:
        raise OperationError(409, "OPERATION_IN_PROGRESS", "Another migration operation is running")


def _require_confirmation(payload: dict[str, Any], expected: str) -> None:
    if payload.get("confirmation") != expected:
        raise OperationError(400, "CONFIRMATION_REQUIRED", f"confirmation must equal {expected}")


def _create_rollback_copy(connection, schema_name: str) -> dict[str, Any]:
    connection.set_session(isolation_level="REPEATABLE READ", readonly=False, autocommit=False)
    with connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute("SET LOCAL lock_timeout = '10s'")
        cursor.execute("SET LOCAL statement_timeout = '120s'")
        _acquire_lock(cursor)
        cursor.execute("SELECT 1 FROM pg_namespace WHERE nspname = %s", (schema_name,))
        if cursor.fetchone():
            raise OperationError(409, "BACKUP_ALREADY_EXISTS", "Rollback-copy schema already exists")

        cursor.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema_name)))
        cursor.execute(
            sql.SQL(
                """
                CREATE TABLE {}.backup_manifest (
                    table_name TEXT PRIMARY KEY,
                    row_count BIGINT NOT NULL,
                    copied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            ).format(sql.Identifier(schema_name))
        )
        cursor.execute(
            sql.SQL(
                """
                CREATE TABLE {}.migration_journal (
                    migration_name TEXT PRIMARY KEY,
                    migration_sha256 CHAR(64) NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            ).format(sql.Identifier(schema_name))
        )

        copied: dict[str, int] = {}
        for table_name in BACKUP_TABLES:
            cursor.execute(
                sql.SQL("CREATE TABLE {}.{} (LIKE public.{} INCLUDING ALL)").format(
                    sql.Identifier(schema_name),
                    sql.Identifier(table_name),
                    sql.Identifier(table_name),
                )
            )
            cursor.execute(
                sql.SQL("INSERT INTO {}.{} SELECT * FROM public.{}").format(
                    sql.Identifier(schema_name),
                    sql.Identifier(table_name),
                    sql.Identifier(table_name),
                )
            )
            copied[table_name] = cursor.rowcount
            cursor.execute(
                sql.SQL("INSERT INTO {}.backup_manifest (table_name, row_count) VALUES (%s, %s)").format(
                    sql.Identifier(schema_name)
                ),
                (table_name, cursor.rowcount),
            )
    connection.commit()
    return {"backup_schema": schema_name, "tables": copied}


def _load_migration() -> tuple[str, str]:
    if not MIGRATION_FILE.is_file():
        raise OperationError(500, "MIGRATION_FILE_MISSING", "Migration SQL is missing from the Lambda package")
    migration = MIGRATION_FILE.read_text(encoding="utf-8")
    executable_lines = [
        line for line in migration.splitlines()
        if line.strip().upper() not in {"BEGIN;", "COMMIT;"}
    ]
    executable = "\n".join(executable_lines).strip()
    if not executable:
        raise OperationError(500, "MIGRATION_FILE_INVALID", "Migration SQL is empty")
    return executable, hashlib.sha256(migration.encode("utf-8")).hexdigest()


def _apply_migration(connection, schema_name: str) -> dict[str, Any]:
    migration_sql, migration_hash = _load_migration()
    migration_name = MIGRATION_FILE.name
    connection.set_session(isolation_level="READ COMMITTED", readonly=False, autocommit=False)
    with connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute("SET LOCAL lock_timeout = '10s'")
        cursor.execute("SET LOCAL statement_timeout = '120s'")
        _acquire_lock(cursor)
        cursor.execute("SELECT to_regnamespace(%s) AS schema_oid", (schema_name,))
        if cursor.fetchone()["schema_oid"] is None:
            raise OperationError(409, "BACKUP_REQUIRED", "Create the rollback copy before applying migration")
        cursor.execute(
            sql.SQL("SELECT table_name, row_count FROM {}.backup_manifest ORDER BY table_name").format(
                sql.Identifier(schema_name)
            )
        )
        manifest = {row["table_name"]: row["row_count"] for row in cursor.fetchall()}
        if set(manifest) != set(BACKUP_TABLES):
            raise OperationError(409, "BACKUP_INCOMPLETE", "Rollback-copy manifest is incomplete")
        for table_name in BACKUP_TABLES:
            cursor.execute(
                "SELECT to_regclass(%s) AS backup_table",
                (f"{schema_name}.{table_name}",),
            )
            if cursor.fetchone()["backup_table"] is None:
                raise OperationError(409, "BACKUP_INCOMPLETE", "A rollback-copy table is missing")
        cursor.execute(
            sql.SQL("SELECT migration_sha256 FROM {}.migration_journal WHERE migration_name = %s").format(
                sql.Identifier(schema_name)
            ),
            (migration_name,),
        )
        applied = cursor.fetchone()
        if applied:
            if applied["migration_sha256"] != migration_hash:
                raise OperationError(409, "MIGRATION_HASH_MISMATCH", "A different migration version was already applied")
            connection.rollback()
            return {"status": "already_applied", "migration": migration_name, "sha256": migration_hash}

        cursor.execute(migration_sql)
        cursor.execute(
            sql.SQL(
                "INSERT INTO {}.migration_journal (migration_name, migration_sha256) VALUES (%s, %s)"
            ).format(sql.Identifier(schema_name)),
            (migration_name, migration_hash),
        )
    connection.commit()
    return {"status": "applied", "migration": migration_name, "sha256": migration_hash}


def _status(connection, schema_name: str) -> dict[str, Any]:
    with connection.cursor(cursor_factory=RealDictCursor) as cursor:
        cursor.execute(
            "SELECT current_setting('server_version') AS postgres_version, "
            "pg_database_size(current_database()) AS database_bytes"
        )
        database = dict(cursor.fetchone())
        source_tables = []
        estimated_copy_bytes = 0
        for table_name in BACKUP_TABLES:
            cursor.execute(
                "SELECT pg_total_relation_size(%s::regclass) AS total_bytes",
                (f"public.{table_name}",),
            )
            total_bytes = cursor.fetchone()["total_bytes"]
            estimated_copy_bytes += total_bytes
            source_tables.append({"table_name": table_name, "total_bytes": total_bytes})
        cursor.execute("SELECT to_regnamespace(%s) AS schema_oid", (schema_name,))
        exists = cursor.fetchone()["schema_oid"] is not None
        result: dict[str, Any] = {
            "postgres_version": database["postgres_version"],
            "database_bytes": database["database_bytes"],
            "estimated_copy_bytes": estimated_copy_bytes,
            "source_tables": source_tables,
            "backup_schema": schema_name,
            "backup_exists": exists,
        }
        if exists:
            cursor.execute(
                sql.SQL("SELECT table_name, row_count, copied_at FROM {}.backup_manifest ORDER BY table_name").format(
                    sql.Identifier(schema_name)
                )
            )
            result["tables"] = [dict(row) for row in cursor.fetchall()]
            cursor.execute(
                sql.SQL("SELECT migration_name, migration_sha256, applied_at FROM {}.migration_journal").format(
                    sql.Identifier(schema_name)
                )
            )
            result["migrations"] = [dict(row) for row in cursor.fetchall()]
    connection.rollback()
    return result


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    connection = None
    try:
        if event.get("httpMethod", "").upper() != "POST":
            raise OperationError(405, "METHOD_NOT_ALLOWED", "Only POST is allowed")
        _authorize(event)
        payload = _body(event)
        action = payload.get("action")
        schema_name = _backup_schema()
        connection = _connect()

        if action == "status":
            result = _status(connection, schema_name)
        elif action == "create_rollback_copy":
            _require_confirmation(payload, BACKUP_CONFIRMATION)
            result = _create_rollback_copy(connection, schema_name)
        elif action == "apply_v1_migration":
            _require_confirmation(payload, MIGRATION_CONFIRMATION)
            result = _apply_migration(connection, schema_name)
        else:
            raise OperationError(400, "UNKNOWN_ACTION", "Unknown migration action")
        return _response(200, {"ok": True, "result": result})
    except OperationError as exc:
        if connection is not None:
            connection.rollback()
        return _response(exc.status_code, {"ok": False, "error": {"code": exc.code, "message": exc.safe_message}})
    except psycopg2.Error:
        if connection is not None:
            connection.rollback()
        return _response(500, {"ok": False, "error": {"code": "DATABASE_ERROR", "message": "Database operation failed"}})
    except Exception:
        if connection is not None:
            connection.rollback()
        return _response(500, {"ok": False, "error": {"code": "INTERNAL_ERROR", "message": "Migration operation failed"}})
    finally:
        if connection is not None:
            connection.close()
