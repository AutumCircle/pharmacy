"""Create the singleton delivery contact settings row."""
from __future__ import annotations

import json
import os

import psycopg2


SQL = """
CREATE TABLE IF NOT EXISTS site_contact_settings (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
    delivery_contact_phone VARCHAR(13),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100),
    CONSTRAINT site_contact_settings_singleton_check CHECK (singleton_id = 1),
    CONSTRAINT site_contact_settings_phone_check CHECK (
        delivery_contact_phone IS NULL OR delivery_contact_phone ~ '^\\+992[0-9]{9}$'
    )
);
INSERT INTO site_contact_settings (singleton_id, delivery_contact_phone)
VALUES (1, NULL) ON CONFLICT (singleton_id) DO NOTHING;
"""


def lambda_handler(event, context):
    if event.get("action") not in ("inspect", "apply"):
        return {"statusCode": 403, "body": "Invalid action"}
    if event["action"] == "apply" and event.get("confirmation") != "VATAN-0013-CONTACT-SETTINGS":
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
                cursor.execute("SET LOCAL statement_timeout = '15s'")
                if event["action"] == "apply":
                    cursor.execute(SQL)
                cursor.execute(
                    "SELECT delivery_contact_phone FROM site_contact_settings WHERE singleton_id = 1"
                )
                row = cursor.fetchone()
        return {"statusCode": 200, "body": json.dumps({"configured": bool(row and row[0])})}
    finally:
        connection.close()
