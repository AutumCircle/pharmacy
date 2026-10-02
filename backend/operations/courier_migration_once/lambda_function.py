"""One-time, narrowly scoped courier-account migration inside the existing VPC."""
from __future__ import annotations

import json
import os

import psycopg2


SQL = """
ALTER TABLE staff_accounts DROP CONSTRAINT IF EXISTS staff_accounts_account_id_check;
ALTER TABLE staff_accounts DROP CONSTRAINT IF EXISTS staff_accounts_catalog_access_check;
ALTER TABLE staff_accounts ALTER COLUMN password_hash DROP NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_accounts_account_id_check') THEN
        ALTER TABLE staff_accounts ADD CONSTRAINT staff_accounts_account_id_check CHECK (account_id IN (1, 2, 3));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_accounts_catalog_access_check') THEN
        ALTER TABLE staff_accounts ADD CONSTRAINT staff_accounts_catalog_access_check
            CHECK (catalog_access = (account_id = 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_accounts_pharmacy_password_check') THEN
        ALTER TABLE staff_accounts ADD CONSTRAINT staff_accounts_pharmacy_password_check
            CHECK (account_id = 3 OR password_hash IS NOT NULL);
    END IF;
END $$;
INSERT INTO staff_accounts (account_id, username, password_hash, catalog_access)
VALUES (3, 'courier', NULL, false) ON CONFLICT (account_id) DO NOTHING;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_pharmacy_id smallint;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_pharmacy_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_pharmacy_check
            CHECK (fulfillment_pharmacy_id IS NULL OR fulfillment_pharmacy_id IN (1, 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_courier_pharmacy_required_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_courier_pharmacy_required_check
            CHECK (created_by_staff_account_id IS DISTINCT FROM 3 OR fulfillment_pharmacy_id IN (1, 2));
    END IF;
END $$;
"""


def lambda_handler(event, context):
    action = event.get("action")
    if action not in ("inspect", "apply"):
        return {"statusCode": 403, "body": "Invalid action"}
    if action == "apply" and event.get("confirmation") != "VATAN-0017-COURIER-ACCOUNT":
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
                cursor.execute("""SELECT account_id, catalog_access, password_hash IS NOT NULL
                    FROM staff_accounts ORDER BY account_id""")
                accounts = cursor.fetchall()
                if action == "apply":
                    if len(accounts) < 2 or [(row[0], row[1]) for row in accounts[:2]] != [(1, False), (2, True)]:
                        raise RuntimeError("Unexpected pharmacy staff account layout")
                    if any(row[0] not in (1, 2, 3) for row in accounts):
                        raise RuntimeError("Unexpected extra staff account")
                    if any(not row[2] for row in accounts[:2]):
                        raise RuntimeError("Pharmacy staff password is missing")
                    cursor.execute(SQL)
                cursor.execute("SELECT count(*) FROM staff_accounts WHERE account_id = 3")
                courier_rows = cursor.fetchone()[0]
                cursor.execute("""SELECT count(*) FROM information_schema.columns
                    WHERE table_schema = current_schema() AND table_name = 'orders'
                    AND column_name = 'fulfillment_pharmacy_id'""")
                column_exists = cursor.fetchone()[0] == 1
                cursor.execute("SELECT count(*) FROM orders WHERE created_by_staff_account_id = 3")
                courier_orders = cursor.fetchone()[0]
        return {"statusCode": 200, "body": json.dumps({
            "courier_rows": courier_rows, "pharmacy_column_exists": column_exists,
            "courier_orders": courier_orders,
            "accounts": [{"id": row[0], "catalog_access": row[1], "password_set": row[2]}
                         for row in accounts],
        })}
    finally:
        connection.close()
