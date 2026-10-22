"""Direct-invoke-only, one-time migration 0027: medicines.hidden_from_clients (owner's «Нет в наличии»).

Package with migration.sql (a copy of db/migrations/0027_medicine_hidden_from_clients.sql) next to this file.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2


CONFIRMATION = "VATAN-0027-MEDICINE-HIDDEN-FROM-CLIENTS"


def _inspect(cursor):
    cursor.execute("""SELECT column_name, data_type, is_nullable, column_default
                      FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'medicines'
                        AND column_name IN ('hidden_from_clients', 'hidden_from_clients_at')
                      ORDER BY column_name""")
    columns = {row[0]: {"type": row[1], "nullable": row[2], "default": row[3]} for row in cursor.fetchall()}
    cursor.execute("""SELECT 1 FROM pg_indexes
                      WHERE schemaname = 'public' AND indexname = 'medicines_hidden_from_clients_idx'""")
    index = cursor.fetchone() is not None
    hidden_count = None
    if "hidden_from_clients" in columns:
        cursor.execute("SELECT COUNT(*) FROM medicines WHERE hidden_from_clients")
        hidden_count = cursor.fetchone()[0]
    cursor.execute("SELECT COUNT(*) FROM medicines")
    return {"columns": columns, "index": index, "hidden_count": hidden_count, "medicine_count": cursor.fetchone()[0]}


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
                    sql = Path(__file__).with_name("migration.sql").read_text(encoding="utf-8").strip()
                    if not sql.startswith("--") or "BEGIN;" not in sql or not sql.endswith("COMMIT;"):
                        raise RuntimeError("Unexpected migration wrapper")
                    cursor.execute(sql[sql.index("BEGIN;") + len("BEGIN;"): -len("COMMIT;")])
                after = _inspect(cursor)
        return {"statusCode": 200, "body": json.dumps({"before": before, "after": after})}
    finally:
        connection.close()
