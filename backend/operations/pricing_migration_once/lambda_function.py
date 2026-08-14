"""One-time 0007 pricing migration for direct invocation in an existing VPC Lambda.

Deploy temporarily, invoke with the exact guarded action, verify the response,
then immediately replace it with the regular Admin API package.
"""

from __future__ import annotations

import json
import os
from typing import Any

import psycopg2


MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS pricing_settings (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
    markup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    markup_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100),
    CONSTRAINT pricing_settings_singleton_check CHECK (singleton_id = 1),
    CONSTRAINT pricing_settings_markup_percent_check CHECK (markup_percent BETWEEN 0 AND 100)
);

INSERT INTO pricing_settings (singleton_id, markup_enabled, markup_percent)
VALUES (1, TRUE, 5.00)
ON CONFLICT (singleton_id) DO NOTHING;

CREATE OR REPLACE FUNCTION vatan_selling_unit_price(base_price NUMERIC)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $function$
    SELECT CEIL(
        base_price * COALESCE(
            (
                SELECT CASE
                    WHEN markup_enabled THEN 1 + (markup_percent / 100)
                    ELSE 1
                END
                FROM pricing_settings
                WHERE singleton_id = 1
            ),
            1.05
        )
    )::BIGINT;
$function$;
"""


def _response(status_code: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body, ensure_ascii=False),
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if event.get("action") != "apply_0007_pricing_settings" or event.get("confirm") != "VATAN-0007":
        return _response(403, {"ok": False, "error": "guard confirmation failed"})
    connection = None
    try:
        connection = psycopg2.connect(
            host=os.environ["DB_HOST"],
            port=int(os.environ.get("DB_PORT", "5432")),
            dbname=os.environ["DB_NAME"],
            user=os.environ["DB_USER"],
            password=os.environ["DB_PASSWORD"],
            connect_timeout=5,
            sslmode=os.environ.get("DB_SSLMODE", "require"),
        )
        connection.autocommit = False
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '5000ms'")
            cursor.execute(MIGRATION_SQL)
            cursor.execute(
                """
                SELECT markup_enabled, markup_percent,
                       vatan_selling_unit_price(100) AS example_price
                FROM pricing_settings WHERE singleton_id = 1
                """
            )
            enabled, percent, example_price = cursor.fetchone()
        connection.commit()
        return _response(200, {
            "ok": True,
            "status": "0007_pricing_settings_applied",
            "markup_enabled": bool(enabled),
            "markup_percent": str(percent),
            "example_price_for_100": int(example_price),
        })
    except Exception:
        if connection is not None:
            connection.rollback()
        return _response(500, {"ok": False, "error": "migration failed; inspect CloudWatch"})
    finally:
        if connection is not None:
            connection.close()
