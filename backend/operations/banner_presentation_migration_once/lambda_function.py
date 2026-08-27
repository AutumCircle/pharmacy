"""Guarded one-time 0009 homepage banner presentation migration.

Deploy temporarily to the existing VPC Admin Lambda. Invoke ``preflight`` first,
then invoke ``apply`` with the exact confirmation token. Replace this handler
with the regular Admin API package immediately after verification.
"""

from __future__ import annotations

import json
import os
from typing import Any

import psycopg2


APPLY_ACTION = "apply_0009_banner_presentation"
CONFIRMATION = "VATAN-0009-BANNER-PRESENTATION"

MIGRATION_SQL = r"""
ALTER TABLE homepage_banners
    ALTER COLUMN title DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS cta_text VARCHAR(80),
    ADD COLUMN IF NOT EXISTS alt_text VARCHAR(200),
    ADD COLUMN IF NOT EXISTS fit_mode VARCHAR(10) NOT NULL DEFAULT 'cover',
    ADD COLUMN IF NOT EXISTS object_position_x SMALLINT NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS object_position_y SMALLINT NOT NULL DEFAULT 50,
    ADD COLUMN IF NOT EXISTS image_width INTEGER,
    ADD COLUMN IF NOT EXISTS image_height INTEGER,
    ADD COLUMN IF NOT EXISTS overlay_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS overlay_color VARCHAR(7) NOT NULL DEFAULT '#FFFFFF',
    ADD COLUMN IF NOT EXISTS overlay_opacity SMALLINT NOT NULL DEFAULT 94,
    ADD COLUMN IF NOT EXISTS overlay_type VARCHAR(10) NOT NULL DEFAULT 'gradient',
    ADD COLUMN IF NOT EXISTS overlay_direction VARCHAR(10) NOT NULL DEFAULT 'to_right',
    ADD COLUMN IF NOT EXISTS text_color VARCHAR(7) NOT NULL DEFAULT '#333333',
    ADD COLUMN IF NOT EXISTS text_align VARCHAR(10) NOT NULL DEFAULT 'left',
    ADD COLUMN IF NOT EXISTS content_vertical VARCHAR(10) NOT NULL DEFAULT 'top',
    ADD COLUMN IF NOT EXISTS title_size SMALLINT NOT NULL DEFAULT 26,
    ADD COLUMN IF NOT EXISTS subtitle_size SMALLINT NOT NULL DEFAULT 16,
    ADD COLUMN IF NOT EXISTS content_max_width SMALLINT NOT NULL DEFAULT 75;

UPDATE homepage_banners
SET title_size = 20
WHERE slot IN ('right_top', 'right_bottom') AND title_size = 26;

DO $constraints$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_fit_mode_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_fit_mode_check
            CHECK (fit_mode IN ('cover', 'contain'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_object_position_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_object_position_check
            CHECK (object_position_x BETWEEN 0 AND 100 AND object_position_y BETWEEN 0 AND 100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_image_dimensions_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_image_dimensions_check
            CHECK ((image_width IS NULL OR image_width BETWEEN 1 AND 20000)
               AND (image_height IS NULL OR image_height BETWEEN 1 AND 20000));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_overlay_color_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_overlay_color_check
            CHECK (overlay_color ~ '^#[0-9A-Fa-f]{6}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_overlay_opacity_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_overlay_opacity_check
            CHECK (overlay_opacity BETWEEN 0 AND 100);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_overlay_type_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_overlay_type_check
            CHECK (overlay_type IN ('solid', 'gradient'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_overlay_direction_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_overlay_direction_check
            CHECK (overlay_direction IN ('to_right', 'to_left', 'to_top', 'to_bottom'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_text_color_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_text_color_check
            CHECK (text_color ~ '^#[0-9A-Fa-f]{6}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_text_align_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_text_align_check
            CHECK (text_align IN ('left', 'center', 'right'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_content_vertical_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_content_vertical_check
            CHECK (content_vertical IN ('top', 'center', 'bottom'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_text_sizes_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_text_sizes_check
            CHECK (title_size BETWEEN 14 AND 64 AND subtitle_size BETWEEN 10 AND 40);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'homepage_banners_content_width_check') THEN
        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_content_width_check
            CHECK (content_max_width BETWEEN 30 AND 100);
    END IF;
END
$constraints$;
"""


def _response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(payload, ensure_ascii=False),
    }


def _connect():
    return psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        sslmode=os.environ.get("DB_SSLMODE", "require"),
        connect_timeout=5,
    )


def _inspect(cursor: Any) -> dict[str, Any]:
    cursor.execute(
        """
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'homepage_banners'
        ORDER BY ordinal_position
        """
    )
    columns = [
        {"name": row[0], "type": row[1], "nullable": row[2] == "YES", "has_default": row[3] is not None}
        for row in cursor.fetchall()
    ]
    cursor.execute(
        """
        SELECT COUNT(*), COUNT(*) FILTER (WHERE is_active),
               COUNT(*) FILTER (WHERE is_active AND image_url IS NULL)
        FROM homepage_banners
        """
    )
    total, active, active_without_image = cursor.fetchone()
    return {
        "columns": columns,
        "banner_count": int(total),
        "active_count": int(active),
        "active_without_image": int(active_without_image),
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    action = event.get("action")
    if action not in {"preflight_0009_banner_presentation", APPLY_ACTION}:
        return _response(403, {"ok": False, "error": "action is invalid"})
    if action == APPLY_ACTION and event.get("confirmation") != CONFIRMATION:
        return _response(403, {"ok": False, "error": "confirmation is invalid"})

    connection = None
    try:
        connection = _connect()
        connection.autocommit = False
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '15000ms'")
            before = _inspect(cursor)
            if action == APPLY_ACTION:
                cursor.execute(MIGRATION_SQL)
            after = _inspect(cursor)
        if action == APPLY_ACTION:
            connection.commit()
        else:
            connection.rollback()
        return _response(200, {
            "ok": True,
            "status": "0009_banner_presentation_applied" if action == APPLY_ACTION else "0009_banner_presentation_preflight",
            "before": before,
            "after": after,
        })
    except Exception:
        if connection is not None:
            connection.rollback()
        return _response(500, {"ok": False, "error": "migration failed; inspect CloudWatch"})
    finally:
        if connection is not None:
            connection.close()
