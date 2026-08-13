"""One-time catalogue reset operation for the existing VPC Lambda.

This package is intentionally not part of any API v1 route. Upload it only
temporarily, invoke it from the Lambda console, then restore the sync receiver.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import psycopg2
from psycopg2 import sql


LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
ACTION_KEY = "catalog-reset-after-background-agent-stop-20260810"
BACKUP_SCHEMA = "vatan_pre_sync_v1_20260806"
CONFIRMATION = "RESET VATAN CATALOG ONLY"


def _response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(payload, ensure_ascii=False, default=str),
    }


def _connection():
    required = ("DB_HOST", "DB_NAME", "DB_USER", "DB_PASSWORD")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise RuntimeError("Database configuration is incomplete")
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        connect_timeout=5,
        sslmode=os.environ.get("DB_SSLMODE", "require"),
    )


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    request_id = getattr(context, "aws_request_id", "unknown")
    if os.environ.get("ENABLE_CATALOG_RESET_ONCE") != "YES_RESET_CATALOG_ONLY":
        return _response(403, {"ok": False, "error": "catalog reset is disabled", "request_id": request_id})
    if event.get("action") != "reset_catalog_once" or event.get("confirmation") != CONFIRMATION:
        return _response(400, {"ok": False, "error": "invalid reset confirmation", "request_id": request_id})

    connection = None
    try:
        connection = _connection()
        connection.autocommit = False
        with connection.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '5000ms'")
            cur.execute("SET LOCAL statement_timeout = '60000ms'")
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('vatan-catalog-reset'))")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS catalog_reset_audit (
                    id BIGSERIAL PRIMARY KEY,
                    action_key VARCHAR(100) NOT NULL UNIQUE,
                    backup_schema VARCHAR(100) NOT NULL,
                    rows_before BIGINT NOT NULL,
                    rows_preserved BIGINT NOT NULL,
                    category_links_removed BIGINT NOT NULL,
                    featured_links_removed BIGINT NOT NULL,
                    sync_logs_removed BIGINT NOT NULL,
                    request_id VARCHAR(100),
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            cur.execute("SELECT rows_before, rows_preserved, created_at FROM catalog_reset_audit WHERE action_key = %s", (ACTION_KEY,))
            prior = cur.fetchone()
            if prior:
                connection.rollback()
                return _response(200, {
                    "ok": True,
                    "status": "already_completed",
                    "rows_before": prior[0],
                    "rows_preserved": prior[1],
                    "completed_at": prior[2],
                    "request_id": request_id,
                })

            cur.execute("SELECT to_regclass(%s)", (f"{BACKUP_SCHEMA}.medicines",))
            if cur.fetchone()[0] is None:
                raise RuntimeError("Required pre-sync backup table is missing")
            cur.execute(sql.SQL("SELECT COUNT(*) FROM {}.medicines").format(sql.Identifier(BACKUP_SCHEMA)))
            backup_rows = int(cur.fetchone()[0])
            if not 5_000 <= backup_rows <= 100_000:
                raise RuntimeError("Pre-sync backup row count is outside the safe range")

            cur.execute("SELECT COUNT(*) FROM medicines")
            rows_before = int(cur.fetchone()[0])
            if rows_before < 5_000:
                raise RuntimeError("Reset stopped because the catalogue is already small")
            rows_preserved = 0

            cur.execute("""
                SELECT child_ns.nspname, child.relname, constraint_row.conname,
                       pg_get_constraintdef(constraint_row.oid)
                FROM pg_constraint constraint_row
                JOIN pg_class child ON child.oid = constraint_row.conrelid
                JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
                WHERE constraint_row.contype = 'f'
                  AND constraint_row.confrelid = 'medicines'::regclass
            """)
            foreign_keys = cur.fetchall()
            for schema_name, table_name, constraint_name, _definition in foreign_keys:
                cur.execute(
                    sql.SQL("ALTER TABLE {}.{} DROP CONSTRAINT {}").format(
                        sql.Identifier(schema_name), sql.Identifier(table_name), sql.Identifier(constraint_name)
                    )
                )

            cur.execute("UPDATE order_items SET medicine_id = NULL WHERE medicine_id IS NOT NULL")
            order_item_links_cleared = cur.rowcount
            cur.execute("DELETE FROM category_medicines")
            category_links_removed = cur.rowcount
            cur.execute("DELETE FROM featured_products")
            featured_links_removed = cur.rowcount
            cur.execute("SELECT COUNT(*) FROM sync_logs")
            sync_logs_removed = int(cur.fetchone()[0])
            cur.execute("TRUNCATE TABLE sync_logs RESTART IDENTITY")
            cur.execute("ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS sync_id UUID")
            cur.execute("ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS snapshot_sha256 CHAR(64)")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS sync_logs_sync_id_unique ON sync_logs (sync_id) WHERE sync_id IS NOT NULL")

            cur.execute("TRUNCATE TABLE medicines RESTART IDENTITY")

            for schema_name, table_name, constraint_name, definition in foreign_keys:
                cur.execute(
                    sql.SQL("ALTER TABLE {}.{} ADD CONSTRAINT {} {}").format(
                        sql.Identifier(schema_name), sql.Identifier(table_name),
                        sql.Identifier(constraint_name), sql.SQL(definition)
                    )
                )

            cur.execute("SELECT pg_get_serial_sequence('medicines', 'id')")
            sequence_name = cur.fetchone()[0]
            cur.execute("SELECT MAX(id) FROM medicines")
            maximum_id = cur.fetchone()[0]
            if maximum_id is None:
                cur.execute("SELECT setval(%s::regclass, 1, false)", (sequence_name,))
            else:
                cur.execute("SELECT setval(%s::regclass, %s, true)", (sequence_name, maximum_id))

            cur.execute("""
                INSERT INTO catalog_reset_audit
                    (action_key, backup_schema, rows_before, rows_preserved,
                     category_links_removed, featured_links_removed, sync_logs_removed, request_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                ACTION_KEY, BACKUP_SCHEMA, rows_before, rows_preserved,
                category_links_removed, featured_links_removed, sync_logs_removed, request_id,
            ))
        connection.commit()
        return _response(200, {
            "ok": True,
            "status": "catalog_reset_completed",
            "backup_schema": BACKUP_SCHEMA,
            "backup_rows": backup_rows,
            "rows_before": rows_before,
            "rows_preserved_for_orders": rows_preserved,
            "order_item_links_cleared": order_item_links_cleared,
            "category_links_removed": category_links_removed,
            "featured_links_removed": featured_links_removed,
            "sync_logs_removed": sync_logs_removed,
            "request_id": request_id,
        })
    except psycopg2.Error as exc:
        if connection is not None:
            connection.rollback()
        LOGGER.exception("One-time catalog reset database error request_id=%s pgcode=%s", request_id, exc.pgcode)
        return _response(500, {
            "ok": False,
            "error": "catalog reset database error",
            "pgcode": exc.pgcode,
            "message": getattr(exc.diag, "message_primary", None),
            "request_id": request_id,
        })
    except Exception:
        if connection is not None:
            connection.rollback()
        LOGGER.exception("One-time catalog reset failed request_id=%s", request_id)
        return _response(500, {"ok": False, "error": "catalog reset failed; inspect CloudWatch", "request_id": request_id})
    finally:
        if connection is not None:
            connection.close()
