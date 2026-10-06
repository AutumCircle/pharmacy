"""One-time, narrowly scoped migration for collections and order attribution."""
from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2


CONFIRMATION = "VATAN-0019-COLLECTIONS-ATTRIBUTION"
EXPECTED_COLUMNS = (
    "source_collection", "utm_source", "utm_medium", "utm_campaign", "utm_content",
)
EXPECTED_INDEXES = (
    "collection_events_slug_created", "collection_events_created",
    "orders_source_collection_created", "orders_utm_created",
)


def _migration_sql() -> str:
    text = Path(__file__).with_name("migration.sql").read_text(encoding="utf-8").strip()
    begin_at = text.find("BEGIN;")
    commit_at = text.rfind("COMMIT;")
    if begin_at < 0 or commit_at <= begin_at:
        raise RuntimeError("migration.sql transaction wrapper is missing")
    return text[begin_at + len("BEGIN;"):commit_at].strip()


def _inspect(cursor):
    cursor.execute("SELECT to_regclass('public.orders'), to_regclass('public.medicines')")
    orders_table, medicines_table = cursor.fetchone()
    if orders_table is None or medicines_table is None:
        raise RuntimeError("required catalogue tables are missing")
    cursor.execute(
        """SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ANY(%s) ORDER BY table_name""",
        (["collections", "collection_events"],),
    )
    tables = [row[0] for row in cursor.fetchall()]
    cursor.execute(
        """SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'orders'
             AND column_name = ANY(%s) ORDER BY column_name""",
        (list(EXPECTED_COLUMNS),),
    )
    columns = [row[0] for row in cursor.fetchall()]
    cursor.execute(
        """SELECT indexname FROM pg_indexes
           WHERE schemaname = 'public' AND indexname = ANY(%s) ORDER BY indexname""",
        (list(EXPECTED_INDEXES),),
    )
    indexes = [row[0] for row in cursor.fetchall()]
    collection_count = 0
    event_count = 0
    seed_slugs = []
    if "collections" in tables:
        cursor.execute("SELECT COUNT(*) FROM collections")
        collection_count = cursor.fetchone()[0]
        cursor.execute("SELECT slug, is_active FROM collections WHERE slug = ANY(%s) ORDER BY slug", (["oct-5", "oct-6"],))
        seed_slugs = [{"slug": row[0], "is_active": row[1]} for row in cursor.fetchall()]
    if "collection_events" in tables:
        cursor.execute("SELECT COUNT(*) FROM collection_events")
        event_count = cursor.fetchone()[0]
    return {
        "tables_present": tables,
        "columns_present": columns,
        "indexes_present": indexes,
        "schema_complete": (
            set(tables) == {"collections", "collection_events"}
            and set(columns) == set(EXPECTED_COLUMNS)
            and set(indexes) == set(EXPECTED_INDEXES)
        ),
        "collection_count": collection_count,
        "event_count": event_count,
        "seed_slugs": seed_slugs,
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
                cursor.execute("SET LOCAL lock_timeout = '5s'")
                cursor.execute("SET LOCAL statement_timeout = '30s'")
                before = _inspect(cursor)
                if action == "apply":
                    cursor.execute(_migration_sql())
                after = _inspect(cursor)
        return {"statusCode": 200, "body": json.dumps({"before": before, "after": after})}
    finally:
        connection.close()
