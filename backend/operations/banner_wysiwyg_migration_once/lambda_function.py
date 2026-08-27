"""Guarded one-time 0010 migration for normalized banner compositions."""

from __future__ import annotations

import json
import os
from typing import Any

import psycopg2


APPLY_ACTION = "apply_0010_banner_wysiwyg"
CONFIRMATION = "VATAN-0010-BANNER-WYSIWYG"

COMPOSITION_COLUMNS = {
    "image_scale": "SMALLINT NOT NULL DEFAULT 100",
    "contain_background": "VARCHAR(10) NOT NULL DEFAULT 'color'",
    "contain_background_color": "VARCHAR(7) NOT NULL DEFAULT '#F5F5F5'",
    "title_x": "SMALLINT NOT NULL DEFAULT 8", "title_y": "SMALLINT NOT NULL DEFAULT 12",
    "title_width": "SMALLINT NOT NULL DEFAULT 75", "title_scale": "SMALLINT NOT NULL DEFAULT 100",
    "subtitle_x": "SMALLINT NOT NULL DEFAULT 8", "subtitle_y": "SMALLINT NOT NULL DEFAULT 38",
    "subtitle_width": "SMALLINT NOT NULL DEFAULT 75", "subtitle_scale": "SMALLINT NOT NULL DEFAULT 100",
    "cta_x": "SMALLINT NOT NULL DEFAULT 8", "cta_y": "SMALLINT NOT NULL DEFAULT 65",
    "cta_width": "SMALLINT NOT NULL DEFAULT 35", "cta_scale": "SMALLINT NOT NULL DEFAULT 100",
    "mobile_override": "BOOLEAN NOT NULL DEFAULT FALSE",
    "mobile_image_x": "SMALLINT NOT NULL DEFAULT 50", "mobile_image_y": "SMALLINT NOT NULL DEFAULT 50",
    "mobile_image_scale": "SMALLINT NOT NULL DEFAULT 100",
    "mobile_title_x": "SMALLINT NOT NULL DEFAULT 8", "mobile_title_y": "SMALLINT NOT NULL DEFAULT 12",
    "mobile_title_width": "SMALLINT NOT NULL DEFAULT 84", "mobile_title_scale": "SMALLINT NOT NULL DEFAULT 100",
    "mobile_subtitle_x": "SMALLINT NOT NULL DEFAULT 8", "mobile_subtitle_y": "SMALLINT NOT NULL DEFAULT 38",
    "mobile_subtitle_width": "SMALLINT NOT NULL DEFAULT 84", "mobile_subtitle_scale": "SMALLINT NOT NULL DEFAULT 100",
    "mobile_cta_x": "SMALLINT NOT NULL DEFAULT 8", "mobile_cta_y": "SMALLINT NOT NULL DEFAULT 68",
    "mobile_cta_width": "SMALLINT NOT NULL DEFAULT 55", "mobile_cta_scale": "SMALLINT NOT NULL DEFAULT 100",
}


def _response(status: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {"statusCode": status, "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "body": json.dumps(payload, ensure_ascii=False)}


def _connect():
    return psycopg2.connect(host=os.environ["DB_HOST"], port=int(os.environ.get("DB_PORT", "5432")),
                            dbname=os.environ["DB_NAME"], user=os.environ["DB_USER"],
                            password=os.environ["DB_PASSWORD"], sslmode=os.environ.get("DB_SSLMODE", "require"),
                            connect_timeout=5)


def _inspect(cur: Any) -> dict[str, Any]:
    cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='homepage_banners'")
    present = {row[0] for row in cur.fetchall()}
    cur.execute("SELECT COUNT(*), COUNT(*) FILTER (WHERE is_active) FROM homepage_banners")
    total, active = cur.fetchone()
    return {"banner_count": int(total), "active_count": int(active),
            "composition_columns_present": sorted(set(COMPOSITION_COLUMNS) & present),
            "composition_columns_missing": sorted(set(COMPOSITION_COLUMNS) - present)}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    action = event.get("action")
    if action not in {"preflight_0010_banner_wysiwyg", APPLY_ACTION}:
        return _response(403, {"ok": False, "error": "action is invalid"})
    if action == APPLY_ACTION and event.get("confirmation") != CONFIRMATION:
        return _response(403, {"ok": False, "error": "confirmation is invalid"})
    connection = None
    try:
        connection = _connect()
        connection.autocommit = False
        with connection.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = '15000ms'")
            before = _inspect(cur)
            if action == APPLY_ACTION:
                for name, definition in COMPOSITION_COLUMNS.items():
                    cur.execute(f"ALTER TABLE homepage_banners ADD COLUMN IF NOT EXISTS {name} {definition}")
                cur.execute("""
                    DO $constraints$ BEGIN
                      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='homepage_banners_image_scale_check') THEN
                        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_image_scale_check CHECK (image_scale BETWEEN 50 AND 300 AND mobile_image_scale BETWEEN 50 AND 300);
                      END IF;
                      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='homepage_banners_contain_background_check') THEN
                        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_contain_background_check CHECK (contain_background IN ('color','blur') AND contain_background_color ~ '^#[0-9A-Fa-f]{6}$');
                      END IF;
                      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='homepage_banners_composition_position_check') THEN
                        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_composition_position_check CHECK (
                          title_x BETWEEN 0 AND 100 AND title_y BETWEEN 0 AND 92 AND subtitle_x BETWEEN 0 AND 100 AND subtitle_y BETWEEN 0 AND 92 AND cta_x BETWEEN 0 AND 100 AND cta_y BETWEEN 0 AND 92 AND
                          mobile_title_x BETWEEN 0 AND 100 AND mobile_title_y BETWEEN 0 AND 92 AND mobile_subtitle_x BETWEEN 0 AND 100 AND mobile_subtitle_y BETWEEN 0 AND 92 AND mobile_cta_x BETWEEN 0 AND 100 AND mobile_cta_y BETWEEN 0 AND 92 AND mobile_image_x BETWEEN 0 AND 100 AND mobile_image_y BETWEEN 0 AND 100);
                      END IF;
                      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='homepage_banners_composition_size_check') THEN
                        ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_composition_size_check CHECK (
                          title_width BETWEEN 15 AND 100 AND subtitle_width BETWEEN 15 AND 100 AND cta_width BETWEEN 15 AND 100 AND mobile_title_width BETWEEN 15 AND 100 AND mobile_subtitle_width BETWEEN 15 AND 100 AND mobile_cta_width BETWEEN 15 AND 100 AND
                          title_x + title_width <= 100 AND subtitle_x + subtitle_width <= 100 AND cta_x + cta_width <= 100 AND mobile_title_x + mobile_title_width <= 100 AND mobile_subtitle_x + mobile_subtitle_width <= 100 AND mobile_cta_x + mobile_cta_width <= 100 AND
                          title_scale BETWEEN 50 AND 200 AND subtitle_scale BETWEEN 50 AND 200 AND cta_scale BETWEEN 50 AND 200 AND mobile_title_scale BETWEEN 50 AND 200 AND mobile_subtitle_scale BETWEEN 50 AND 200 AND mobile_cta_scale BETWEEN 50 AND 200);
                      END IF;
                    END $constraints$;
                """)
            after = _inspect(cur)
        connection.commit() if action == APPLY_ACTION else connection.rollback()
        return _response(200, {"ok": True, "status": "0010_banner_wysiwyg_applied" if action == APPLY_ACTION else "0010_banner_wysiwyg_preflight", "before": before, "after": after})
    except Exception:
        if connection is not None:
            connection.rollback()
        return _response(500, {"ok": False, "error": "migration failed; inspect CloudWatch"})
    finally:
        if connection is not None:
            connection.close()
