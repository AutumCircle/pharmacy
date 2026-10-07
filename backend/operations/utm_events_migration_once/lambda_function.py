"""One-time, narrowly scoped migration for first-party UTM landing events."""
from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg2


CONFIRMATION = "VATAN-0020-UTM-LINK-EVENTS"
EXPECTED_INDEXES = (
    "utm_link_events_created",
    "utm_link_events_campaign_content_created",
)


def _migration_sql():
    text = Path(__file__).with_name("migration.sql").read_text(encoding="utf-8").strip()
    begin_at = text.find("BEGIN;")
    commit_at = text.rfind("COMMIT;")
    if begin_at < 0 or commit_at <= begin_at:
        raise RuntimeError("migration.sql transaction wrapper is missing")
    return text[begin_at + len("BEGIN;"):commit_at].strip()


def _inspect(cursor):
    cursor.execute("SELECT to_regclass('public.utm_link_events')")
    table_present = cursor.fetchone()[0] is not None
    cursor.execute(
        """SELECT indexname FROM pg_indexes
           WHERE schemaname = 'public' AND indexname = ANY(%s) ORDER BY indexname""",
        (list(EXPECTED_INDEXES),),
    )
    indexes = [row[0] for row in cursor.fetchall()]
    event_count = 0
    if table_present:
        cursor.execute("SELECT COUNT(*) FROM utm_link_events")
        event_count = cursor.fetchone()[0]
    return {
        "table_present": table_present,
        "indexes_present": indexes,
        "schema_complete": table_present and set(indexes) == set(EXPECTED_INDEXES),
        "event_count": event_count,
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
