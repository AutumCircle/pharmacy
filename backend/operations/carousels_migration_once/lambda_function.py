"""One-time additive migration 0005 runner for direct Lambda invocation only."""

from __future__ import annotations

import json
import os
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor


CONFIRMATION = "APPLY_PRODUCT_CAROUSELS_V1_20260811"


def _response(status_code: int, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(payload, ensure_ascii=False),
    }


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if event.get("confirmation") != CONFIRMATION:
        return _response(403, {"ok": False, "error": "confirmation is invalid"})
    connection = psycopg2.connect(
        host=os.environ["DB_HOST"],
        port=int(os.environ.get("DB_PORT", "5432")),
        dbname=os.environ["DB_NAME"],
        user=os.environ["DB_USER"],
        password=os.environ["DB_PASSWORD"],
        sslmode=os.environ.get("DB_SSLMODE", "require"),
        connect_timeout=5,
    )
    try:
        with connection.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SET LOCAL statement_timeout = '15000ms'")
            cur.execute("ALTER TABLE medicines ADD COLUMN IF NOT EXISTS image_url TEXT")
            cur.execute(
                """
                DO $$
                BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'medicines_image_url_check') THEN
                        ALTER TABLE medicines ADD CONSTRAINT medicines_image_url_check
                            CHECK (image_url IS NULL OR image_url ~ '^https://');
                    END IF;
                END $$
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS product_carousels (
                    id BIGSERIAL PRIMARY KEY,
                    slug VARCHAR(80) NOT NULL UNIQUE,
                    title VARCHAR(120) NOT NULL,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT product_carousels_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
                    CONSTRAINT product_carousels_title_check CHECK (length(btrim(title)) BETWEEN 2 AND 120),
                    CONSTRAINT product_carousels_sort_order_check CHECK (sort_order BETWEEN 0 AND 100000)
                )
                """
            )
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS product_carousel_items (
                    id BIGSERIAL PRIMARY KEY,
                    carousel_id BIGINT NOT NULL REFERENCES product_carousels(id) ON DELETE CASCADE,
                    medicine_id INTEGER NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT product_carousel_items_unique UNIQUE (carousel_id, medicine_id),
                    CONSTRAINT product_carousel_items_sort_order_check CHECK (sort_order BETWEEN 0 AND 100000)
                )
                """
            )
            cur.execute("CREATE INDEX IF NOT EXISTS product_carousels_public_order ON product_carousels (is_active, sort_order, id)")
            cur.execute("CREATE INDEX IF NOT EXISTS product_carousel_items_order ON product_carousel_items (carousel_id, sort_order, id)")
            cur.execute(
                """
                INSERT INTO product_carousels (slug, title, is_active, sort_order)
                VALUES ('items-of-the-day', 'Товары дня', TRUE, 10),
                       ('best-sellers', 'Хиты продаж', TRUE, 20)
                ON CONFLICT (slug) DO NOTHING
                """
            )
            cur.execute(
                """
                UPDATE medicines AS m SET image_url = fp.image_url
                FROM featured_products AS fp
                WHERE fp.medicine_id = m.id AND fp.image_url IS NOT NULL AND m.image_url IS NULL
                """
            )
            cur.execute(
                """
                INSERT INTO product_carousel_items (carousel_id, medicine_id, sort_order, updated_at)
                SELECT pc.id, fp.medicine_id, COALESCE(fp.sort_order, 0), CURRENT_TIMESTAMP
                FROM featured_products fp
                JOIN product_carousels pc ON pc.slug = 'items-of-the-day'
                WHERE fp.medicine_id IS NOT NULL
                ON CONFLICT (carousel_id, medicine_id) DO NOTHING
                """
            )
            cur.execute("SELECT COUNT(*) AS count FROM product_carousels")
            carousel_count = int(cur.fetchone()["count"])
            cur.execute("SELECT COUNT(*) AS count FROM product_carousel_items")
            item_count = int(cur.fetchone()["count"])
        connection.commit()
        return _response(200, {
            "ok": True,
            "status": "product_carousels_ready",
            "migration": "0005_product_carousels.sql",
            "carousel_count": carousel_count,
            "item_count": item_count,
        })
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
