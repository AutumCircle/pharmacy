"""One-time additive migration 0006 runner for direct Lambda invocation."""

from __future__ import annotations

import json
import os
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor


CONFIRMATION = "APPLY_ADMIN_SAFETY_V1_20260811"


def _response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(payload, ensure_ascii=False),
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if event.get("confirmation") != CONFIRMATION:
        return _response(403, {"ok": False, "error": "confirmation is invalid"})
    connection = psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        sslmode=os.environ.get("DB_SSLMODE", "require"),
        connect_timeout=5,
    )
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SET LOCAL statement_timeout = '15000ms'")
            cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")
            cur.execute("ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100)")
            cur.execute(
                "CREATE INDEX IF NOT EXISTS orders_visible_created "
                "ON orders (created_at DESC, id DESC) WHERE deleted_at IS NULL"
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS admin_audit_log (
                    id BIGSERIAL PRIMARY KEY,
                    actor_id VARCHAR(100) NOT NULL,
                    action VARCHAR(80) NOT NULL,
                    resource_type VARCHAR(50) NOT NULL,
                    resource_id VARCHAR(100) NOT NULL,
                    request_id VARCHAR(80) NOT NULL,
                    details JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS admin_audit_log_resource_created "
                "ON admin_audit_log (resource_type, resource_id, created_at DESC)"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS admin_audit_log_actor_created "
                "ON admin_audit_log (actor_id, created_at DESC)"
            )
            cur.execute(
                """
                SELECT
                    EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'deleted_at'
                    ) AS order_soft_delete_ready,
                    to_regclass('public.admin_audit_log') IS NOT NULL AS audit_ready,
                    (SELECT COUNT(*) FROM orders WHERE deleted_at IS NOT NULL) AS archived_orders
                """
            )
            verification = dict(cur.fetchone())
        connection.commit()
        return _response(200, {
            "ok": True,
            "status": "admin_safety_ready",
            "migration": "0006_admin_safety_and_duplicates.sql",
            "verification": verification,
        })
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
