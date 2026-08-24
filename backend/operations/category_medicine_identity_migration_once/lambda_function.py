"""One-time guarded 0008 category/medicine identity migration."""

from __future__ import annotations

import json
import os
from typing import Any

import psycopg2


CONFIRMATION = "APPLY_CATEGORY_MEDICINE_IDENTITY_0008"
MIGRATION_SQL = """
ALTER TABLE category_medicines
    DROP CONSTRAINT IF EXISTS category_medicines_category_id_medicine_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS category_medicines_category_medicine_unique
    ON category_medicines (category_id, medicine_id)
    WHERE medicine_id IS NOT NULL;
"""


def _response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(payload, ensure_ascii=False),
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if event.get("confirmation") != CONFIRMATION:
        return _response(403, {"ok": False, "error": "confirmation is invalid"})
    connection = None
    try:
        connection = psycopg2.connect(
            host=os.environ["DB_HOST"],
            port=int(os.environ.get("DB_PORT", "5432")),
            dbname=os.environ["DB_NAME"],
            user=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"],
            sslmode=os.environ.get("DB_SSLMODE", "require"),
            connect_timeout=5,
        )
        connection.autocommit = False
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '15000ms'")
            cursor.execute(MIGRATION_SQL)
            cursor.execute(
                """
                SELECT
                    to_regclass('public.category_medicines_category_medicine_unique') IS NOT NULL,
                    EXISTS (
                        SELECT 1
                        FROM pg_constraint
                        WHERE conrelid = 'public.category_medicines'::regclass
                          AND conname = 'category_medicines_category_id_medicine_name_key'
                    ),
                    COUNT(*) FILTER (WHERE medicine_id IS NULL)
                FROM category_medicines
                """
            )
            medicine_id_index_ready, legacy_name_constraint_present, legacy_null_links = cursor.fetchone()
        connection.commit()
        return _response(200, {
            "ok": True,
            "status": "0008_category_medicine_identity_applied",
            "medicine_id_index_ready": bool(medicine_id_index_ready),
            "legacy_name_constraint_present": bool(legacy_name_constraint_present),
            "legacy_null_links": int(legacy_null_links),
        })
    except Exception:
        if connection is not None:
            connection.rollback()
        return _response(500, {"ok": False, "error": "migration failed; inspect CloudWatch"})
    finally:
        if connection is not None:
            connection.close()
