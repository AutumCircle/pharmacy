"""Direct-invoke-only, one-time migration 0021 using the existing VPC Lambda."""
from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2


CONFIRMATION = "VATAN-0021-ORDER-NOTIFICATIONS"


def _inspect(cursor):
    cursor.execute("SELECT to_regclass('public.order_notification_settings'), to_regclass('public.order_notification_deliveries')")
    settings, deliveries = cursor.fetchone()
    singleton = False
    claims = None
    if settings is not None:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM order_notification_settings WHERE singleton_id = 1)")
        singleton = cursor.fetchone()[0]
    if deliveries is not None:
        cursor.execute("SELECT COUNT(*) FROM order_notification_deliveries")
        claims = cursor.fetchone()[0]
    return {"settings_table": settings is not None, "deliveries_table": deliveries is not None,
            "singleton_present": singleton, "claim_count": claims}


def lambda_handler(event, context):
    action = event.get("action") if isinstance(event, dict) else None
    if action not in ("inspect", "apply"):
        return {"statusCode": 403, "body": "Invalid action"}
    if action == "apply" and event.get("confirmation") != CONFIRMATION:
        return {"statusCode": 403, "body": "Invalid confirmation"}
    connection = psycopg2.connect(
        host=os.environ["DB_HOST"], port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"], user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"], sslmode=os.environ.get("DB_SSLMODE", "require"),
        connect_timeout=5,
    )
    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '5s'")
                cursor.execute("SET LOCAL statement_timeout = '30s'")
                before = _inspect(cursor)
                if action == "apply":
                    sql = Path(__file__).with_name("migration.sql").read_text(encoding="utf-8").strip()
                    if not sql.startswith("--") or "BEGIN;" not in sql or not sql.endswith("COMMIT;"):
                        raise RuntimeError("Unexpected migration wrapper")
                    cursor.execute(sql[sql.index("BEGIN;") + len("BEGIN;"): -len("COMMIT;")])
                after = _inspect(cursor)
        return {"statusCode": 200, "body": json.dumps({"before": before, "after": after})}
    finally:
        connection.close()
