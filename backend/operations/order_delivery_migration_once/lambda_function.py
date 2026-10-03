"""One-time, narrowly scoped migration for per-order delivery amounts."""
from __future__ import annotations

import json
import os

import psycopg2


CONFIRMATION = "VATAN-0018-ORDER-DELIVERY-FEE"
SQL = """
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_courier_amount numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_owner_amount numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_updated_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_updated_by text;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_amounts_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_delivery_amounts_check
            CHECK (delivery_courier_amount >= 0 AND delivery_owner_amount >= 0
                   AND delivery_courier_amount <= 1000000 AND delivery_owner_amount <= 1000000);
    END IF;
END $$;
"""
COLUMNS = (
    "delivery_courier_amount",
    "delivery_owner_amount",
    "delivery_updated_at",
    "delivery_updated_by",
)


def _inspect(cursor):
    cursor.execute("SELECT to_regclass('public.orders')")
    if cursor.fetchone()[0] is None:
        raise RuntimeError("orders table is missing")
    cursor.execute("""SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders'
          AND column_name = ANY(%s) ORDER BY column_name""", (list(COLUMNS),))
    present = [row[0] for row in cursor.fetchall()]
    cursor.execute("SELECT count(*) FROM orders")
    order_count = cursor.fetchone()[0]
    cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = %s)",
                   ("orders_delivery_amounts_check",))
    return {
        "order_count": order_count,
        "columns_present": present,
        "all_columns_present": set(present) == set(COLUMNS),
        "constraint_present": cursor.fetchone()[0],
    }


def lambda_handler(event, context):
    action = event.get("action")
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
                cursor.execute("SET LOCAL lock_timeout = '3s'")
                cursor.execute("SET LOCAL statement_timeout = '20s'")
                before = _inspect(cursor)
                if action == "apply":
                    cursor.execute(SQL)
                after = _inspect(cursor)
        return {"statusCode": 200, "body": json.dumps({"before": before, "after": after})}
    finally:
        connection.close()
