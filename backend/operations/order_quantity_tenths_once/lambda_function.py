"""Direct-invoke-only, one-time order quantity constraint migration."""
from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2


CONFIRMATION = "VATAN-0026-ORDER-QUANTITY-TENTHS"


def _inspect(cursor):
    cursor.execute("""SELECT data_type, numeric_precision, numeric_scale
                      FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'quantity'""")
    quantity = cursor.fetchone()
    cursor.execute("""SELECT pg_get_constraintdef(c.oid)
                      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                      JOIN pg_namespace n ON n.oid = t.relnamespace
                      WHERE n.nspname = 'public' AND t.relname = 'order_items'
                        AND c.conname = 'order_items_quantity_positive'""")
    constraint = cursor.fetchone()
    cursor.execute("""SELECT COUNT(*) FROM order_items
                      WHERE quantity < 0.1 OR quantity > 99 OR mod(quantity * 100, 1) <> 0""")
    incompatible_count = cursor.fetchone()[0]
    return {
        "quantity_type": quantity[0] if quantity else None,
        "quantity_precision": quantity[1] if quantity else None,
        "quantity_scale": quantity[2] if quantity else None,
        "quantity_constraint": constraint[0] if constraint else None,
        "incompatible_count": incompatible_count,
    }


def lambda_handler(event, context):
    action = event.get("action") if isinstance(event, dict) else None
    if action not in ("inspect", "apply"):
        return {"statusCode": 403, "body": "Invalid action"}
    if action == "apply" and event.get("confirmation") != CONFIRMATION:
        return {"statusCode": 403, "body": "Invalid confirmation"}

    connection = psycopg2.connect(
        host=os.environ["DB_HOST"], port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"], user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
        sslmode=os.environ.get("DB_SSLMODE", "require"), connect_timeout=5,
    )
    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '5s'")
                cursor.execute("SET LOCAL statement_timeout = '30s'")
                before = _inspect(cursor)
                if action == "apply":
                    if before["incompatible_count"]:
                        raise RuntimeError("Existing order quantities are incompatible; migration not applied")
                    sql = Path(__file__).with_name("migration.sql").read_text(encoding="utf-8").strip()
                    if not sql.startswith("--") or "BEGIN;" not in sql or not sql.endswith("COMMIT;"):
                        raise RuntimeError("Unexpected migration wrapper")
                    cursor.execute(sql[sql.index("BEGIN;") + len("BEGIN;"): -len("COMMIT;")])
                after = _inspect(cursor)
        return {"statusCode": 200, "body": json.dumps({"before": before, "after": after})}
    finally:
        connection.close()
