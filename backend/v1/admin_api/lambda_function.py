"""Authenticated Pharmacy Vatan admin API v1 Lambda handler."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import os
import re
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote, urlparse
from uuid import uuid4
from zoneinfo import ZoneInfo

import boto3
import psycopg2

from backend.v1.shared.contract import (
    ContractError,
    STATUS_TRANSITIONS,
    calculate_selling_unit_price,
    normalize_phone,
    validate_idempotency_key,
    validate_manual_order_items,
    validate_order_quantity,
    validate_staff_order_request,
    validate_unit_price,
    validate_status_transition,
)
from backend.v1.shared.authorization import require_admin_identity, require_notification_claim_identity
from backend.v1.shared.database import transaction
from backend.v1.shared.responses import error_response, request_id, success, success_document
from backend.v1.shared.xlsx_export import (
    build_available_medicines_csv,
    build_available_medicines_workbook,
    build_out_of_stock_workbook,
)
from backend.v1.shared import collection_admin, staff_accounts
from backend.v1.shared.order_notification_settings import (
    CHANNELS as NOTIFICATION_CHANNELS, effective_settings, stored_policies, validate_update,
)
from backend.v1.shared.order_notification_messages import format_configured_message
from backend.v1.shared.order_time import absolute_order_time, order_time_dushanbe, order_time_iso
from backend.v1.shared.order_stage import assembled_sql, assembly_complete, order_stage
from backend.v1.shared.order_timeline import (
    COURIER_ACTIONS,
    TIMELINE_LIMIT,
    build_timeline,
    courier_view,
    creator_actor,
)


DEFAULT_LIMIT = 20
MAX_LIMIT = 100
MAX_BATCH_ITEMS = 100
MAX_EXPORT_ROWS = 25_000
DELETABLE_ORDER_STATUSES = frozenset({"pending", "cancelled", "delivered"})
SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
COLOR_PATTERN = re.compile(r"^#[0-9a-fA-F]{6}$")
LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(logging.INFO)
MAX_MEDIA_IMAGE_BYTES = 3 * 1024 * 1024
MEDIA_IMAGE_TYPES = {
    "image/jpeg": ("jpg", lambda value: value.startswith(b"\xff\xd8\xff")),
    "image/png": ("png", lambda value: value.startswith(b"\x89PNG\r\n\x1a\n")),
    "image/webp": ("webp", lambda value: len(value) >= 12 and value[:4] == b"RIFF" and value[8:12] == b"WEBP"),
}
BANNER_SELECT_COLUMNS = """
slot, title, subtitle, image_url, link_url, is_active, updated_at,
cta_text, alt_text, fit_mode, object_position_x, object_position_y,
image_width, image_height, overlay_enabled, overlay_color, overlay_opacity,
overlay_type, overlay_direction, text_color, text_align, content_vertical,
title_size, subtitle_size, content_max_width,
image_scale, contain_background, contain_background_color,
title_x, title_y, title_width, title_scale,
subtitle_x, subtitle_y, subtitle_width, subtitle_scale,
cta_x, cta_y, cta_width, cta_scale,
mobile_override, mobile_image_x, mobile_image_y, mobile_image_scale,
mobile_title_x, mobile_title_y, mobile_title_width, mobile_title_scale,
mobile_subtitle_x, mobile_subtitle_y, mobile_subtitle_width, mobile_subtitle_scale,
mobile_cta_x, mobile_cta_y, mobile_cta_width, mobile_cta_scale
""".strip()
_s3 = None


def _s3_client():
    global _s3
    if _s3 is None:
        _s3 = boto3.client("s3")
    return _s3


def upload_media_image(payload: dict[str, Any], actor_id: str, current_request_id: str) -> dict[str, Any]:
    bucket = os.environ.get("MEDIA_BUCKET", "").strip()
    public_base_url = os.environ.get("MEDIA_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not bucket or not public_base_url.startswith("https://"):
        raise ContractError("MEDIA_CONFIGURATION_ERROR", "Image storage is not configured", http_status=500)
    if set(payload) != {"content_type", "data_base64", "scope"}:
        raise ContractError("VALIDATION_ERROR", "content_type, data_base64 and scope are required")
    content_type = payload.get("content_type")
    scope = payload.get("scope")
    encoded = payload.get("data_base64")
    if content_type not in MEDIA_IMAGE_TYPES or scope not in {"banners", "products", "categories"} or not isinstance(encoded, str):
        raise ContractError("VALIDATION_ERROR", "Only JPEG, PNG or WebP banner/product images are supported")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ContractError("VALIDATION_ERROR", "Image data is invalid") from exc
    extension, signature_matches = MEDIA_IMAGE_TYPES[content_type]
    if not content or len(content) > MAX_MEDIA_IMAGE_BYTES or not signature_matches(content):
        raise ContractError("VALIDATION_ERROR", "Image is invalid or larger than 3 MB")
    now = datetime.now(timezone.utc)
    key = f"images/{scope}/{now:%Y/%m}/{uuid4().hex}.{extension}"
    _s3_client().put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )
    with transaction() as cur:
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="media.image.uploaded",
            resource_type="media_image",
            resource_id=key,
            request=current_request_id,
            details={"scope": scope, "content_type": content_type, "size_bytes": len(content)},
        )
    return {"url": f"{public_base_url}/{quote(key)}", "key": key, "size_bytes": len(content)}

# Formatting-only normalization shared by all duplicate queries. This avoids
# unsafe fuzzy matching while treating whitespace and punctuation spacing alike.
NORMALIZED_MEDICINE_NAME_SQL = """
lower(
    regexp_replace(
        regexp_replace(btrim({column}), '[[:space:]]+', ' ', 'g'),
        '[[:space:]]*([,.;:/()№-])[[:space:]]*',
        '\\1',
        'g'
    )
)
""".strip()


def _normalized_medicine_name_sql(column: str = "name") -> str:
    if column not in {"name", "m.name"}:
        raise ValueError("Unsupported medicine-name column")
    return NORMALIZED_MEDICINE_NAME_SQL.format(column=column)


def _write_admin_audit(
    cur: Any,
    *,
    actor_id: str,
    action: str,
    resource_type: str,
    resource_id: str,
    request: str,
    details: dict[str, Any],
) -> None:
    cur.execute(
        """
        INSERT INTO admin_audit_log
            (actor_id, action, resource_type, resource_id, request_id, details)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
        """,
        (actor_id, action, resource_type, resource_id, request, json.dumps(details, ensure_ascii=False)),
    )


def _body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or "{}"
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as exc:
        raise ContractError("VALIDATION_ERROR", "Malformed JSON request body") from exc
    if not isinstance(parsed, dict):
        raise ContractError("VALIDATION_ERROR", "Request body must be a JSON object")
    return parsed


def _limit(query: dict[str, Any]) -> int:
    try:
        value = int(query.get("limit") or DEFAULT_LIMIT)
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "limit must be an integer") from exc
    if not 1 <= value <= MAX_LIMIT:
        raise ContractError("VALIDATION_ERROR", f"limit must be between 1 and {MAX_LIMIT}")
    return value


def _encode_cursor(value: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def _decode_cursor(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        parsed = json.loads(base64.urlsafe_b64decode(value.encode()).decode())
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError("VALIDATION_ERROR", "cursor is invalid") from exc
    if not isinstance(parsed, dict):
        raise ContractError("VALIDATION_ERROR", "cursor is invalid")
    return parsed


def _positive_int(value: Any, field: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", f"{field} must be a positive integer") from exc
    if parsed <= 0:
        raise ContractError("VALIDATION_ERROR", f"{field} must be a positive integer")
    return parsed


def _id_batch(payload: dict[str, Any], field: str) -> list[int]:
    if set(payload) != {field} or not isinstance(payload.get(field), list):
        raise ContractError("VALIDATION_ERROR", f"{field} must be an array")
    values = payload[field]
    if not 1 <= len(values) <= MAX_BATCH_ITEMS or any(
        isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in values
    ) or len(set(values)) != len(values):
        raise ContractError(
            "VALIDATION_ERROR",
            f"{field} must contain between 1 and {MAX_BATCH_ITEMS} unique positive integers",
        )
    return values


def _sort_order(value: Any, field: str = "sort_order") -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100_000:
        raise ContractError("VALIDATION_ERROR", f"{field} must be an integer between 0 and 100000")
    return value


def _image_url(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ContractError("VALIDATION_ERROR", "image_url must be a string or null")
    normalized = value.strip()
    if len(normalized) > 2000 or not normalized.startswith("https://"):
        raise ContractError("VALIDATION_ERROR", "image_url must use HTTPS")
    return normalized


def _page_number(query: dict[str, Any]) -> int:
    return _positive_int(query.get("page") or 1, "page")


def _medicine_name_fragment(value: Any) -> str:
    if not isinstance(value, str):
        raise ContractError("VALIDATION_ERROR", "fragment must be a string")
    fragment = value.strip()
    if not 2 <= len(fragment) <= 120:
        raise ContractError("VALIDATION_ERROR", "fragment must contain between 2 and 120 characters")
    return fragment


def _literal_ilike_pattern(fragment: str) -> str:
    """Escape LIKE metacharacters so the admin fragment is always literal."""

    escaped = fragment.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def get_pricing_settings() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT markup_enabled, markup_percent, updated_at, updated_by
            FROM pricing_settings
            WHERE singleton_id = 1
            """
        )
        row = cur.fetchone()
    if not row:
        raise ContractError("PRICING_SETTINGS_NOT_FOUND", "Pricing settings were not found", http_status=500)
    return {
        "markup_enabled": bool(row["markup_enabled"]),
        "markup_percent": row["markup_percent"],
        "updated_at": row["updated_at"],
        "updated_by": row["updated_by"],
    }


def update_pricing_settings(
    payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    if set(payload) != {"markup_enabled", "markup_percent"}:
        raise ContractError("VALIDATION_ERROR", "markup_enabled and markup_percent are required")
    enabled = payload["markup_enabled"]
    if not isinstance(enabled, bool):
        raise ContractError("VALIDATION_ERROR", "markup_enabled must be a boolean")
    if isinstance(payload["markup_percent"], bool):
        raise ContractError("VALIDATION_ERROR", "markup_percent must be a number")
    try:
        percent = Decimal(str(payload["markup_percent"])).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "markup_percent must be a number") from exc
    if not percent.is_finite() or not Decimal("0") <= percent <= Decimal("100"):
        raise ContractError("VALIDATION_ERROR", "markup_percent must be between 0 and 100")

    with transaction() as cur:
        cur.execute(
            """
            SELECT markup_enabled, markup_percent
            FROM pricing_settings WHERE singleton_id = 1 FOR UPDATE
            """
        )
        previous = cur.fetchone()
        if not previous:
            raise ContractError("PRICING_SETTINGS_NOT_FOUND", "Pricing settings were not found", http_status=500)
        cur.execute(
            """
            UPDATE pricing_settings
            SET markup_enabled = %s, markup_percent = %s,
                updated_at = CURRENT_TIMESTAMP, updated_by = %s
            WHERE singleton_id = 1
            RETURNING markup_enabled, markup_percent, updated_at, updated_by
            """,
            (enabled, percent, actor_id),
        )
        updated = dict(cur.fetchone())
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="pricing_settings.updated",
            resource_type="pricing_settings",
            resource_id="1",
            request=current_request_id,
            details={
                "before": {
                    "markup_enabled": bool(previous["markup_enabled"]),
                    "markup_percent": str(previous["markup_percent"]),
                },
                "after": {
                    "markup_enabled": enabled,
                    "markup_percent": str(percent),
                },
            },
        )
    return updated


def get_contact_settings() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT delivery_contact_phone, updated_at, updated_by
            FROM site_contact_settings WHERE singleton_id = 1
            """
        )
        row = cur.fetchone()
    if not row:
        raise ContractError("CONTACT_SETTINGS_NOT_FOUND", "Contact settings were not found", http_status=500)
    return dict(row)


def update_contact_settings(payload: dict[str, Any], actor_id: str, current_request_id: str) -> dict[str, Any]:
    if set(payload) != {"delivery_contact_phone"}:
        raise ContractError("VALIDATION_ERROR", "delivery_contact_phone is required")
    phone = normalize_phone(payload.get("delivery_contact_phone"))
    with transaction() as cur:
        cur.execute(
            "SELECT delivery_contact_phone FROM site_contact_settings WHERE singleton_id = 1 FOR UPDATE"
        )
        previous = cur.fetchone()
        if not previous:
            raise ContractError("CONTACT_SETTINGS_NOT_FOUND", "Contact settings were not found", http_status=500)
        cur.execute(
            """
            UPDATE site_contact_settings
            SET delivery_contact_phone = %s, updated_at = CURRENT_TIMESTAMP, updated_by = %s
            WHERE singleton_id = 1
            RETURNING delivery_contact_phone, updated_at, updated_by
            """,
            (phone, actor_id),
        )
        updated = dict(cur.fetchone())
        _write_admin_audit(
            cur, actor_id=actor_id, action="contact_settings.updated",
            resource_type="contact_settings", resource_id="1", request=current_request_id,
            details={"previous_phone": previous["delivery_contact_phone"], "new_phone": phone},
        )
    return updated


def catalog_stats() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("""
            SELECT in_stock_count, out_of_stock_count,
                   sync_time AT TIME ZONE 'UTC' AS sync_time
            FROM sync_logs
            ORDER BY id DESC
            LIMIT 1
        """)
        latest = cur.fetchone()
        if latest:
            in_stock = int(latest["in_stock_count"] or 0)
            out_of_stock = int(latest["out_of_stock_count"] or 0)
            result = {
                "total": in_stock + out_of_stock,
                "in_stock": in_stock,
                "out_of_stock": out_of_stock,
                "last_updated_at": latest["sync_time"],
            }
        else:
            cur.execute("""
                SELECT COUNT(*) AS total,
                       COUNT(*) FILTER (WHERE in_stock IS TRUE) AS in_stock,
                       COUNT(*) FILTER (WHERE in_stock IS NOT TRUE) AS out_of_stock,
                       MAX(updated_at) AS last_updated_at
                FROM medicines
            """)
            result = dict(cur.fetchone())
        normalized_name = _normalized_medicine_name_sql("name")
        cur.execute(f"""
            SELECT COUNT(*) AS duplicate_groups
            FROM (
                SELECT {normalized_name}
                FROM medicines
                WHERE name IS NOT NULL AND btrim(name) <> ''
                GROUP BY {normalized_name}
                HAVING COUNT(*) > 1
            ) AS grouped_names
        """)
        result["duplicate_groups"] = int(cur.fetchone()["duplicate_groups"])
        result["warnings"] = []
        if int(result["out_of_stock"] or 0) > 100_000:
            result["warnings"].append("CATALOG_ARCHIVE_ABNORMALLY_LARGE")
        return result


def get_order_notification_settings() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("""SELECT courier_enabled, policies, revision, updated_at, updated_by
                       FROM order_notification_settings WHERE singleton_id = 1""")
        return effective_settings(cur.fetchone())


def preview_order_notifications(payload: dict[str, Any]) -> dict[str, Any]:
    """Render a fixed sample with the exact formatter used by Telegram delivery."""
    try:
        enabled, policies, _, _alarm = validate_update(payload)
    except ValueError as exc:
        raise ContractError("VALIDATION_ERROR", "Неверные настройки предпросмотра") from exc
    sample = {
        "order_reference": "VAT-1042", "created_at": "2026-10-11T10:30:00+00:00",
        "order_source": "Сайт", "customer_name": "Пример клиента", "phone": "+992 90 000 00 00",
        "address": "Душанбе, ул. Айни 29", "landmark": "У главного входа",
        "comment": "Позвоните перед доставкой", "created_by_staff_username": "Сайт",
        "fulfillment_pharmacy_id": 1, "status": "pending", "order_total": "40.00",
        "base_total": "32.00", "profit": "8.00",
        "items": [{"medicine_name": "Пример лекарства", "quantity": 2,
                   "line_total": "40.00", "base_line_total": "32.00"}],
    }
    telegram = {channel: format_configured_message(sample, policies[channel], channel)
                for channel in NOTIFICATION_CHANNELS[:3]}
    web_labels = {
        "order_reference": ("Заказ", sample["order_reference"]),
        "created_at": ("Создан", order_time_dushanbe(sample["created_at"])),
        "source": ("Источник", sample["order_source"]),
        "customer_name": ("Клиент", sample["customer_name"]),
        "phone": ("Телефон", sample["phone"]),
        "address": ("Адрес", sample["address"]),
        "landmark": ("Ориентир", sample["landmark"]),
        "comment": ("Комментарий", sample["comment"]),
        "client_total": ("Клиентская сумма", "40.00 с."),
        "base_total": ("Базовая сумма", "32.00 с."),
        "profit": ("Разница", "8.00 с."),
        "creator": ("Создал", "Сайт"),
        "status": ("Статус", "pending"),
    }
    web = [{"label": label, "value": value} for field, (label, value) in web_labels.items()
           if policies["pharmacy_web"][field]]
    if policies["pharmacy_web"]["items"]:
        item = "Пример лекарства"
        if policies["pharmacy_web"]["quantity"]:
            item += " × 2"
        if policies["pharmacy_web"]["item_client_total"]:
            item += " · клиенту 40.00 с."
        if policies["pharmacy_web"]["item_base_total"]:
            item += " · базовая 32.00 с."
        web.append({"label": "Товары", "value": item})
    return {"telegram": telegram, "pharmacy_web": web, "courier_enabled": enabled}


def update_order_notification_settings(payload: dict[str, Any], actor_id: str, current_request_id: str) -> dict[str, Any]:
    try:
        enabled, policies, revision, alarm = validate_update(payload)
    except ValueError as exc:
        raise ContractError("VALIDATION_ERROR", "Неверные настройки уведомлений") from exc
    with transaction() as cur:
        cur.execute("""SELECT courier_enabled, policies, revision, updated_at, updated_by
                       FROM order_notification_settings WHERE singleton_id = 1 FOR UPDATE""")
        current = effective_settings(cur.fetchone())
        if current["revision"] != revision:
            raise ContractError("SETTINGS_CONFLICT", "Настройки уже изменились. Обновите страницу.", http_status=409)
        cur.execute("""UPDATE order_notification_settings
                       SET courier_enabled = %s, policies = %s::jsonb, revision = revision + 1,
                           courier_enabled_since = CASE WHEN courier_enabled IS FALSE AND %s IS TRUE
                               THEN CURRENT_TIMESTAMP ELSE courier_enabled_since END,
                           updated_at = CURRENT_TIMESTAMP, updated_by = %s
                       WHERE singleton_id = 1
                       RETURNING courier_enabled, policies, revision, updated_at, updated_by""",
                    (enabled, json.dumps(stored_policies(policies, alarm)), enabled, actor_id))
        saved = effective_settings(cur.fetchone())
        _write_admin_audit(cur, actor_id=actor_id, action="order.notification_settings_updated",
                           resource_type="order_notification_settings", resource_id="1", request=current_request_id,
                           details={"previous": {"courier_enabled": current["courier_enabled"], "policies": current["policies"],
                                                 "pharmacy_alarm": current["pharmacy_alarm"]},
                                    "current": {"courier_enabled": enabled, "policies": policies,
                                                "pharmacy_alarm": alarm}})
    return saved


# Job 013: a pharmacy's price change / routing to «Ватан 2» is announced to the owner and the courier only.
# Job 015: so is «Заказ собран» (order:{id}:assembled:{request_id}).
_CHANGE_EVENT_RECIPIENTS = ("owner_telegram", "courier_telegram")


def claim_order_notification(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {"event_key", "recipient"}:
        raise ContractError("VALIDATION_ERROR", "Неверное событие уведомления")
    event_key, recipient = payload["event_key"], payload["recipient"]
    match = (re.fullmatch(r"order:([1-9][0-9]*):(created|(?:pharmacy-change|assembled):req_[0-9a-f]{32})", event_key)
             if isinstance(event_key, str) else None)
    if not match or recipient not in NOTIFICATION_CHANNELS[:3]:
        raise ContractError("VALIDATION_ERROR", "Неверное событие уведомления")
    if match.group(2) != "created" and recipient not in _CHANGE_EVENT_RECIPIENTS:
        raise ContractError("VALIDATION_ERROR", "Неверное событие уведомления")
    with transaction() as cur:
        cur.execute("""SELECT s.courier_enabled, s.courier_enabled_since, s.policies,
                              o.created_at AS order_created_at
                       FROM order_notification_settings s
                       JOIN orders o ON o.id = %s AND o.deleted_at IS NULL
                       WHERE s.singleton_id = 1 FOR SHARE OF s""", (int(match.group(1)),))
        row = cur.fetchone()
        if not row:
            return {"claimed": False, "fields": {}}
        settings = effective_settings(row)
        if recipient == "courier_telegram" and (not settings["courier_enabled"] or
                absolute_order_time(row["order_created_at"]) < row["courier_enabled_since"]):
            return {"claimed": False, "fields": {}}
        cur.execute("""INSERT INTO order_notification_deliveries (event_key, recipient)
                       VALUES (%s, %s) ON CONFLICT DO NOTHING RETURNING event_key""",
                    (event_key, recipient))
        claimed = bool(cur.fetchone())
    return {"claimed": claimed, "fields": settings["policies"][recipient] if claimed else {}}


def dashboard_summary(query: dict[str, Any]) -> dict[str, Any]:
    try:
        days = int(query.get("days") or 30)
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "days must be an integer") from exc
    if days not in {7, 30, 90}:
        raise ContractError("VALIDATION_ERROR", "days must be 7, 30 or 90")
    with transaction() as cur:
        cur.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
                COUNT(*) FILTER (WHERE status = 'delivering') AS delivering,
                COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
            FROM orders
            WHERE deleted_at IS NULL
            """
        )
        row = dict(cur.fetchone())
        cur.execute(
            """
            SELECT
                o.public_id,
                COALESCE(o.order_reference, o.public_id, o.id::text) AS order_reference,
                o.customer_name,
                o.created_at,
                COALESCE(SUM(oi.line_total), o.items_subtotal, o.total_price, 0) AS sales_total,
                COALESCE(SUM(COALESCE(oi.base_unit_price, 0) * oi.quantity), 0) AS pharmacy_total,
                o.delivery_owner_amount,
                o.delivery_courier_amount
            FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            WHERE o.deleted_at IS NULL
              AND o.status = 'delivered'
              AND o.created_at >= CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')
            GROUP BY o.id, o.public_id, o.order_reference, o.customer_name, o.created_at,
                     o.items_subtotal, o.total_price, o.delivery_owner_amount,
                     o.delivery_courier_amount
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT 100
            """,
            (days,),
        )
        delivered_orders = [dict(item) for item in cur.fetchall()]
        cur.execute(
            """
            SELECT
                COUNT(*) AS total_orders,
                COUNT(*) FILTER (WHERE created_by_staff_account_id IS NULL) AS client_orders,
                COUNT(*) FILTER (WHERE created_by_staff_account_id IN (1, 2)) AS pharmacy_orders,
                COUNT(*) FILTER (WHERE created_by_staff_account_id = 3) AS courier_orders,
                COUNT(*) FILTER (WHERE COALESCE(fulfillment_pharmacy_id, created_by_staff_account_id) = 1) AS pharmacy_1_orders,
                COUNT(*) FILTER (WHERE COALESCE(fulfillment_pharmacy_id, created_by_staff_account_id) = 2) AS pharmacy_2_orders,
                COUNT(*) FILTER (WHERE created_by_staff_account_id IS NOT NULL
                                  AND order_source = 'instagram') AS instagram_orders,
                COUNT(*) FILTER (WHERE created_by_staff_account_id IS NOT NULL
                                  AND order_source = 'whatsapp') AS whatsapp_orders,
                COUNT(*) FILTER (WHERE created_by_staff_account_id IS NOT NULL
                                  AND order_source = 'phone') AS phone_orders,
                COUNT(*) FILTER (WHERE created_by_staff_account_id IS NOT NULL
                                  AND order_source IS NULL) AS unspecified_source_orders
            FROM orders
            WHERE deleted_at IS NULL
              AND created_at >= CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')
            """,
            (days,),
        )
        origin_counts = dict(cur.fetchone())
        cur.execute(
            """
            SELECT
                o.id,
                o.public_id,
                COALESCE(o.order_reference, o.public_id, o.id::text) AS order_reference,
                o.customer_name,
                o.created_at,
                COALESCE(o.order_total, o.items_subtotal, o.total_price, 0) AS order_total,
                o.status,
                o.created_by_staff_account_id,
                o.fulfillment_pharmacy_id,
                o.order_source
            FROM orders o
            WHERE o.deleted_at IS NULL
              AND o.created_at >= CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT 20
            """,
            (days,),
        )
        recent_orders = [dict(item) for item in cur.fetchall()]
        for item in recent_orders:
            item["created_at"] = order_time_iso(item["created_at"])
        cur.execute(
            """
            SELECT
                COALESCE(SUM(financial.sales_total), 0) AS sales_total,
                COALESCE(SUM(financial.pharmacy_total), 0) AS pharmacy_total,
                COALESCE(SUM(financial.sales_total - financial.pharmacy_total)
                    FILTER (WHERE financial.created_by_staff_account_id IS NULL), 0) AS online_profit_total,
                COALESCE(SUM(financial.delivery_owner_amount), 0) AS delivery_owner_total,
                COALESCE(SUM(financial.delivery_courier_amount), 0) AS delivery_courier_total
            FROM (
                SELECT
                    o.id,
                    COALESCE(SUM(oi.line_total), o.items_subtotal, o.total_price, 0) AS sales_total,
                    COALESCE(SUM(COALESCE(oi.base_unit_price, 0) * oi.quantity), 0) AS pharmacy_total,
                    o.created_by_staff_account_id,
                    o.delivery_owner_amount,
                    o.delivery_courier_amount
                FROM orders o
                LEFT JOIN order_items oi ON oi.order_id = o.id
                WHERE o.deleted_at IS NULL
                  AND o.status = 'delivered'
                  AND o.created_at >= CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')
                GROUP BY o.id, o.items_subtotal, o.total_price,
                         o.created_by_staff_account_id, o.delivery_owner_amount, o.delivery_courier_amount
            ) AS financial
            """,
            (days,),
        )
        financial_totals = dict(cur.fetchone())
        cur.execute(
            """
            WITH days AS (
                SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dushanbe')::date - offsets.day AS day
                FROM generate_series(0, %s - 1) AS offsets(day)
            ), earned AS (
                SELECT (COALESCE(
                    (SELECT MAX(h.created_at) FROM order_status_history h
                     WHERE h.order_id = o.id AND h.to_status = 'delivered'),
                    o.delivery_updated_at,
                    CASE WHEN pg_typeof(o.created_at) = 'timestamp without time zone'::regtype
                         THEN o.created_at::timestamp AT TIME ZONE 'UTC'
                         ELSE o.created_at::timestamptz END
                ) AT TIME ZONE 'Asia/Dushanbe')::date AS day,
                o.delivery_courier_amount
                FROM orders o
                WHERE o.deleted_at IS NULL AND o.status = 'delivered'
            )
            SELECT days.day AS date, COALESCE(SUM(earned.delivery_courier_amount), 0) AS amount,
                   COUNT(earned.day) AS orders_count
            FROM days LEFT JOIN earned ON earned.day = days.day
            GROUP BY days.day ORDER BY days.day ASC
            """,
            (days,),
        )
        courier_daily = [dict(item) for item in cur.fetchall()]
        cur.execute(
            """
            WITH days AS (
                SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dushanbe')::date - offsets.day AS day
                FROM generate_series(0, %s - 1) AS offsets(day)
            ), delivered AS (
                SELECT (COALESCE((SELECT MAX(h.created_at) FROM order_status_history h
                                  WHERE h.order_id = o.id AND h.to_status = 'delivered'),
                                 o.delivery_updated_at, o.created_at) AT TIME ZONE 'Asia/Dushanbe')::date AS day,
                       o.created_by_staff_account_id,
                       COALESCE(SUM(oi.line_total), o.items_subtotal, o.total_price, 0) AS medicine_sales
                FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
                WHERE o.deleted_at IS NULL AND o.status = 'delivered'
                GROUP BY o.id, o.created_by_staff_account_id, o.items_subtotal, o.total_price, o.delivery_updated_at, o.created_at
            )
            SELECT days.day AS date,
                COUNT(delivered.day) FILTER (WHERE delivered.created_by_staff_account_id IS NULL) AS website_orders,
                COUNT(delivered.day) FILTER (WHERE delivered.created_by_staff_account_id = 3) AS courier_orders,
                COUNT(delivered.day) FILTER (WHERE delivered.created_by_staff_account_id IN (1, 2)) AS pharmacy_orders,
                COALESCE(SUM(delivered.medicine_sales) FILTER (WHERE delivered.created_by_staff_account_id IS NULL), 0) AS website_sales,
                COALESCE(SUM(delivered.medicine_sales) FILTER (WHERE delivered.created_by_staff_account_id = 3), 0) AS courier_sales,
                COALESCE(SUM(delivered.medicine_sales) FILTER (WHERE delivered.created_by_staff_account_id IN (1, 2)), 0) AS pharmacy_sales
            FROM days LEFT JOIN delivered ON delivered.day = days.day
            GROUP BY days.day ORDER BY days.day ASC
            """, (days,))
        delivery_origin_daily = [dict(item) for item in cur.fetchall()]
    for item in delivered_orders:
        item["order_id"] = item.pop("public_id") or str(item["order_reference"])
        item["profit"] = item["sales_total"] - item["pharmacy_total"]
        item["owner_total"] = item["profit"] + item["delivery_owner_amount"]
    for item in recent_orders:
        internal_id = item.pop("id")
        item["order_id"] = item.pop("public_id") or f"legacy_{internal_id}"
    origin_counts = {key: int(value or 0) for key, value in origin_counts.items()}
    counts = {status: int(row[status] or 0) for status in STATUS_TRANSITIONS}
    sales_total = financial_totals["sales_total"]
    pharmacy_total = financial_totals["pharmacy_total"]
    return {
        "period_days": days,
        "order_counts": counts,
        "new_orders": counts["pending"],
        "active_orders": counts["pending"] + counts["confirmed"] + counts["delivering"],
        "sales_total": sales_total,
        "pharmacy_total": pharmacy_total,
        "profit_total": sales_total - pharmacy_total,
        "online_profit_total": financial_totals["online_profit_total"],
        "delivery_owner_total": financial_totals["delivery_owner_total"],
        "delivery_courier_total": financial_totals["delivery_courier_total"],
        "courier_daily": courier_daily,
        "delivery_origin_daily": delivery_origin_daily,
        "origin_counts": origin_counts,
        "recent_orders": recent_orders,
        "delivered_orders": delivered_orders,
        "currency": "TJS",
    }


def list_medicines(query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    page = _page_number(query)
    availability = str(query.get("availability") or "all")
    if availability not in {"all", "in_stock", "out_of_stock"}:
        raise ContractError("VALIDATION_ERROR", "availability is invalid")
    clauses: list[str] = []
    params: list[Any] = []
    if availability == "in_stock":
        clauses.append("m.in_stock IS TRUE")
    elif availability == "out_of_stock":
        clauses.append("m.in_stock IS NOT TRUE")
    search = str(query.get("q") or "").strip()
    if search:
        if len(search) > 120:
            raise ContractError("VALIDATION_ERROR", "q is too long")
        pattern = f"%{search}%"
        if search.isdigit():
            clauses.append("(m.id = %s OR m.name ILIKE %s OR COALESCE(m.source_sku, '') ILIKE %s)")
            params.extend([int(search), pattern, pattern])
        else:
            clauses.append("(m.name ILIKE %s OR COALESCE(m.source_sku, '') ILIKE %s)")
            params.extend([pattern, pattern])
    country = str(query.get("country") or "").strip()
    vendor = str(query.get("vendor") or "").strip()
    if len(country) > 100 or len(vendor) > 100:
        raise ContractError("VALIDATION_ERROR", "country or vendor is too long")
    if country:
        clauses.append("lower(btrim(COALESCE(m.country, ''))) = lower(btrim(%s))")
        params.append(country)
    if vendor:
        clauses.append("lower(btrim(COALESCE(m.vendor, ''))) = lower(btrim(%s))")
        params.append(vendor)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    offset = (page - 1) * limit
    with transaction() as cur:
        if not search and not country and not vendor:
            cur.execute("""
                SELECT in_stock_count, out_of_stock_count
                FROM sync_logs ORDER BY id DESC LIMIT 1
            """)
            latest = cur.fetchone()
        else:
            latest = None
        if latest:
            in_count = int(latest["in_stock_count"] or 0)
            out_count = int(latest["out_of_stock_count"] or 0)
            total_items = in_count if availability == "in_stock" else out_count if availability == "out_of_stock" else in_count + out_count
        else:
            cur.execute(f"SELECT COUNT(*) AS count FROM medicines m {where}", tuple(params))
            total_items = int(cur.fetchone()["count"])
        cur.execute(
            f"""
            SELECT id AS medicine_id, name AS medicine_name, price AS base_unit_price,
                   vatan_selling_unit_price(price) AS selling_unit_price,
                   source_sku, country, vendor, in_stock, updated_at, image_url
            FROM medicines m
            {where}
            ORDER BY id DESC
            LIMIT %s OFFSET %s
            """,
            tuple([*params, limit, offset]),
        )
        rows = [dict(row) for row in cur.fetchall()]
    total_pages = max(1, (total_items + limit - 1) // limit)
    return {
        "data": rows,
        "page": {
            "number": page,
            "size": limit,
            "total_items": total_items,
            "total_pages": total_pages,
        },
    }


def search_staff_order_medicines(query: dict[str, Any]) -> dict[str, Any]:
    search = str(query.get("q") or "").strip()
    if not 2 <= len(search) <= 120:
        raise ContractError("VALIDATION_ERROR", "q must contain between 2 and 120 characters")
    pattern = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    with transaction() as cur:
        cur.execute(
            """
            SELECT id AS medicine_id, name AS medicine_name, price AS base_unit_price,
                   vatan_selling_unit_price(price) AS selling_unit_price,
                   source_sku, country, vendor, in_stock
            FROM medicines
            WHERE in_stock IS TRUE
              AND (name ILIKE %s ESCAPE '\\' OR COALESCE(source_sku, '') ILIKE %s ESCAPE '\\')
            ORDER BY lower(name) ASC, id ASC
            LIMIT 20
            """,
            (pattern, pattern),
        )
        rows = [dict(row) for row in cur.fetchall()]
    return {"data": rows, "page": {"number": 1, "size": 20, "total_items": len(rows), "total_pages": 1}}


def export_out_of_stock_medicines() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("SELECT COUNT(*) AS count FROM medicines WHERE in_stock IS NOT TRUE")
        row_count = int(cur.fetchone()["count"])
        if row_count > MAX_EXPORT_ROWS:
            raise ContractError(
                "EXPORT_TOO_LARGE",
                f"Export contains more than {MAX_EXPORT_ROWS} medicines",
                http_status=413,
            )
        cur.execute(
            """
            SELECT id AS medicine_id, name AS medicine_name, price AS base_unit_price,
                   vatan_selling_unit_price(price) AS selling_unit_price,
                   vendor, country, updated_at
            FROM medicines
            WHERE in_stock IS NOT TRUE
            ORDER BY updated_at DESC NULLS LAST, id ASC
            """
        )
        rows = [dict(row) for row in cur.fetchall()]
    generated_at = datetime.now(timezone.utc)
    workbook = build_out_of_stock_workbook(rows, generated_at)
    return {
        "filename": f"vatan-out-of-stock-{generated_at:%Y-%m-%d}.xlsx",
        "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content_base64": base64.b64encode(workbook).decode("ascii"),
        "row_count": row_count,
    }


def _export_site_origin(event: dict[str, Any]) -> str:
    headers = {str(key).lower(): str(value) for key, value in (event.get("headers") or {}).items() if value}
    parsed = urlparse(headers.get("x-public-site-url", ""))
    if (parsed.scheme not in {"https", "http"} or not parsed.netloc
            or parsed.username or parsed.password or parsed.path not in {"", "/"}
            or parsed.query or parsed.fragment):
        raise ContractError("VALIDATION_ERROR", "A valid public site origin is required for this export")
    if parsed.scheme != "https" and parsed.hostname not in {"localhost", "127.0.0.1"}:
        raise ContractError("VALIDATION_ERROR", "The public site origin must use HTTPS")
    return f"{parsed.scheme}://{parsed.netloc}"


def export_available_medicines(event: dict[str, Any], query: dict[str, Any]) -> dict[str, Any]:
    export_format = str(query.get("format") or "xlsx")
    if export_format not in {"xlsx", "csv"}:
        raise ContractError("VALIDATION_ERROR", "format must be xlsx or csv")
    site_origin = _export_site_origin(event)
    with transaction() as cur:
        cur.execute("SELECT COUNT(*) AS count FROM medicines WHERE in_stock IS TRUE")
        row_count = int(cur.fetchone()["count"])
        if row_count > MAX_EXPORT_ROWS:
            raise ContractError("EXPORT_TOO_LARGE", f"Export contains more than {MAX_EXPORT_ROWS} medicines", http_status=413)
        cur.execute("""
            SELECT id AS medicine_id, name AS medicine_name,
                   vatan_selling_unit_price(price) AS selling_unit_price
            FROM medicines
            WHERE in_stock IS TRUE
            ORDER BY lower(name) ASC, id ASC
        """)
        rows = [dict(row) for row in cur.fetchall()]
    generated_at = datetime.now(timezone.utc)
    if export_format == "csv":
        content = build_available_medicines_csv(rows, site_origin)
        content_type = "text/csv; charset=utf-8"
    else:
        content = build_available_medicines_workbook(rows, site_origin)
        content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return {
        "filename": f"vatan-available-medicines-{generated_at:%Y-%m-%d}.{export_format}",
        "content_type": content_type,
        "content_base64": base64.b64encode(content).decode("ascii"),
        "row_count": row_count,
    }


def list_medicine_duplicates(query: dict[str, Any]) -> dict[str, Any]:
    normalized_name = _normalized_medicine_name_sql("name")
    group_key = str(query.get("group_key") or "").lower()
    if group_key:
        if not re.fullmatch(r"[0-9a-f]{32}", group_key):
            raise ContractError("VALIDATION_ERROR", "group_key is invalid")
        with transaction() as cur:
            cur.execute(f"""
                SELECT id AS medicine_id, name AS medicine_name, price AS base_unit_price,
                       vatan_selling_unit_price(price) AS selling_unit_price,
                       source_sku, country, vendor, in_stock, updated_at, image_url
                FROM medicines
                WHERE name IS NOT NULL AND btrim(name) <> ''
                  AND md5({normalized_name}) = %s
                ORDER BY lower(btrim(name)) ASC, id ASC
            """, (group_key,))
            rows = [dict(row) for row in cur.fetchall()]
        if len(rows) < 2:
            raise ContractError("DUPLICATE_GROUP_NOT_FOUND", "Duplicate group was not found", http_status=404)
        return {"group_key": group_key, "data": rows}

    limit = _limit(query)
    page = _page_number(query)
    offset = (page - 1) * limit
    with transaction() as cur:
        cur.execute(f"""
            SELECT COUNT(*) AS count FROM (
                SELECT 1 FROM medicines
                WHERE name IS NOT NULL AND btrim(name) <> ''
                GROUP BY {normalized_name} HAVING COUNT(*) > 1
            ) duplicate_groups
        """)
        total_items = int(cur.fetchone()["count"])
        cur.execute(f"""
            SELECT md5({normalized_name}) AS group_key,
                   MIN(name) AS medicine_name,
                   COUNT(*) AS medicine_count,
                   COUNT(*) FILTER (WHERE in_stock IS TRUE) AS in_stock_count,
                   COUNT(*) FILTER (WHERE in_stock IS NOT TRUE) AS out_of_stock_count,
                   MIN(price) AS min_base_price,
                   MAX(price) AS max_base_price,
                   MAX(updated_at) AS last_updated_at
            FROM medicines
            WHERE name IS NOT NULL AND btrim(name) <> ''
            GROUP BY {normalized_name}
            HAVING COUNT(*) > 1
            ORDER BY {normalized_name} ASC, md5({normalized_name}) ASC
            LIMIT %s OFFSET %s
        """, (limit, offset))
        rows = [dict(row) for row in cur.fetchall()]
    total_pages = max(1, (total_items + limit - 1) // limit)
    return {
        "data": rows,
        "page": {
            "number": page,
            "size": limit,
            "total_items": total_items,
            "total_pages": total_pages,
        },
    }


def _order_lookup(order_id: str, alias: str = "") -> tuple[str, tuple[Any, ...]]:
    prefix = f"{alias}." if alias else ""
    if order_id.startswith("legacy_"):
        legacy_id = _positive_int(order_id.removeprefix("legacy_"), "order_id")
        return f"{prefix}id = %s AND {prefix}public_id IS NULL", (legacy_id,)
    return f"{prefix}public_id = %s", (order_id,)


def create_staff_order(
    payload: dict[str, Any],
    idempotency_key: str,
    account: dict[str, Any],
    current_request_id: str,
) -> tuple[dict[str, Any], int, dict[str, Any] | None]:
    request = validate_staff_order_request(payload)
    if account["account_id"] != 3:
        raise ContractError("FORBIDDEN", "Заказы создаёт только доставщик", http_status=403)
    if request.get("pharmacy_id") not in (1, 2):
        raise ContractError("VALIDATION_ERROR", "Доставщик должен выбрать аптеку")
    pharmacy_id = request["pharmacy_id"]
    normalized_key = validate_idempotency_key(idempotency_key)
    request_hash = hashlib.sha256(
        json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    with transaction() as cur:
        cur.execute(
            """
            INSERT INTO order_idempotency (idempotency_key, request_hash)
            VALUES (%s, %s)
            ON CONFLICT (idempotency_key) DO NOTHING
            RETURNING id
            """,
            (normalized_key, request_hash),
        )
        if not cur.fetchone():
            cur.execute(
                """
                SELECT request_hash, response_status, response_body
                FROM order_idempotency WHERE idempotency_key = %s FOR UPDATE
                """,
                (normalized_key,),
            )
            existing = cur.fetchone()
            if not existing or existing["request_hash"] != request_hash:
                raise ContractError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different request", http_status=409)
            if existing["response_body"] is None:
                raise ContractError("IDEMPOTENCY_IN_PROGRESS", "Order request is still being processed", http_status=409)
            saved_response = dict(existing["response_body"])
            if saved_response.get("created_at"):
                saved_response["created_at"] = order_time_iso(saved_response["created_at"])
            return saved_response, int(existing["response_status"]), None

        order_items: list[dict[str, Any]] = []
        base_total = Decimal("0")
        selling_total = Decimal("0")
        if request["items"]:
            medicine_ids = [item["medicine_id"] for item in request["items"]]
            cur.execute(
                """
                SELECT id, name, price, in_stock, vatan_selling_unit_price(price) AS selling_unit_price
                FROM medicines WHERE id = ANY(%s) FOR UPDATE
                """,
                (medicine_ids,),
            )
            medicines = {int(row["id"]): dict(row) for row in cur.fetchall()}
            missing = [medicine_id for medicine_id in medicine_ids if medicine_id not in medicines]
            if missing:
                raise ContractError("MEDICINE_NOT_FOUND", "One or more medicines were not found", http_status=404)
            unavailable = [medicine_id for medicine_id in medicine_ids if not medicines[medicine_id]["in_stock"]]
            if unavailable:
                raise ContractError("ORDER_ITEMS_UNAVAILABLE", "One or more medicines are unavailable", http_status=409)
            for requested_item in request["items"]:
                medicine = medicines[requested_item["medicine_id"]]
                quantity = Decimal(str(requested_item["quantity"]))
                base_price = Decimal(str(medicine["price"]))
                # Courier-entered orders default to the pharmacy's base price, never the public markup;
                # the courier may set the client price explicitly.
                selling_price = (Decimal(requested_item["unit_price"]) if "unit_price" in requested_item
                                 else base_price)
                base_line_total = base_price * quantity
                selling_line_total = selling_price * quantity
                base_total += base_line_total
                selling_total += selling_line_total
                order_items.append({
                    "medicine_id": int(medicine["id"]), "medicine_name": medicine["name"],
                    "quantity": str(quantity), "base_unit_price": str(base_price),
                    "selling_unit_price": str(selling_price), "base_line_total": str(base_line_total),
                    "line_total": str(selling_line_total),
                })
        for manual in request.get("manual_items", []):
            price = Decimal(manual["price"])
            line_total = price * Decimal(str(manual["quantity"]))
            base_total += line_total
            selling_total += line_total
            order_items.append({
                "medicine_id": None, "medicine_name": manual["medicine_name"],
                "quantity": manual["quantity"], "base_unit_price": str(price),
                "selling_unit_price": str(price), "base_line_total": str(line_total),
                "line_total": str(line_total),
            })
        if selling_total > Decimal("99999999.99"):
            raise ContractError("VALIDATION_ERROR", "Сумма заказа слишком велика")

        public_id = f"ord_{uuid4().hex}"
        cur.execute(
            """
            INSERT INTO orders (
                user_id, customer_name, phone, phone_normalized, address, notes,
                total_price, items_subtotal, order_total, public_id, status,
                payment_method, payment_status, currency,
                created_by_staff_account_id, order_source, landmark, fulfillment_pharmacy_id
            )
            VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending',
                    'cash_on_delivery', 'unpaid', 'TJS', %s, %s, %s, %s)
            RETURNING id, public_id, status, created_at
            """,
            (
                request["customer_name"], request["phone"], request["phone"], request["address"],
                request.get("comment"),
                selling_total, selling_total, selling_total, public_id,
                account["account_id"], request["source"], request["landmark"], pharmacy_id,
            ),
        )
        order = dict(cur.fetchone())
        order_reference = f"{request['phone'][-4:]}-{order['id']:03d}"
        cur.execute("UPDATE orders SET order_reference = %s WHERE id = %s", (order_reference, order["id"]))
        if order_items:
            cur.execute(
                """
                INSERT INTO order_items (
                    order_id, medicine_id, medicine_name, price, quantity,
                    base_unit_price, selling_unit_price, line_total
                )
                SELECT %s, item.medicine_id, item.medicine_name, item.selling_unit_price,
                       item.quantity, item.base_unit_price, item.selling_unit_price, item.line_total
                FROM jsonb_to_recordset(%s::jsonb) AS item(
                    medicine_id integer, medicine_name text, quantity numeric,
                    base_unit_price numeric, selling_unit_price numeric, line_total numeric
                )
                """,
                (order["id"], json.dumps(order_items, ensure_ascii=False)),
            )
        cur.execute(
            """
            INSERT INTO order_status_history
                (order_id, from_status, to_status, actor_type, actor_id, reason)
            VALUES (%s, NULL, 'pending', 'staff', %s, %s)
            """,
            (order["id"], str(account["account_id"]), f"Источник: {request['source']}"),
        )
        response = {
            "order_id": order["public_id"], "order_reference": order_reference,
            "status": order["status"], "created_at": order_time_iso(order["created_at"]),
            "created_by_staff_account_id": account["account_id"],
            "created_by_staff_username": account["username"], "order_source": request["source"],
            "fulfillment_pharmacy_id": pharmacy_id,
            "items": order_items, "pharmacy_total": str(base_total), "order_total": str(selling_total),
        }
        cur.execute(
            """
            UPDATE order_idempotency
            SET order_id = %s, response_status = 201, response_body = %s::jsonb,
                completed_at = CURRENT_TIMESTAMP
            WHERE idempotency_key = %s
            """,
            (order["id"], json.dumps(response, default=str), normalized_key),
        )
        _write_admin_audit(
            cur, actor_id=f"staff:{account['account_id']}", action="staff.order.created",
            resource_type="order", resource_id=order["public_id"], request=current_request_id,
            details={"staff_account_id": account["account_id"], "pharmacy_id": pharmacy_id,
                     "source": request["source"]},
        )
        notification = {
            "notification_kind": "staff_manual_order", "admin_order_id": int(order["id"]),
            "created_at": order_time_iso(order["created_at"]),
            "status": "pending",
            "order_reference": order_reference, "customer_name": request["customer_name"],
            "phone": request["phone"], "address": request["address"], "landmark": request["landmark"],
            "comment": request.get("comment"),
            "order_source": request["source"], "created_by_staff_account_id": account["account_id"],
            "created_by_staff_username": account["username"],
            "fulfillment_pharmacy_id": pharmacy_id, "items": order_items,
            "base_total": str(base_total), "order_total": str(selling_total),
            "profit": str(selling_total - base_total),
        }
        return response, 201, notification


# Courier checklist v2 (the owner's 7 steps). Steps 4, 5 and 7 are derived from orders.status and are
# never stored; step 3 («Получить подтверждение наличия и цены») is derived from the pharmacy answers
# (job 010: pharmacy_answers_complete or status past pending), so stored step-3 rows are ignored on read.
# The courier ticks steps 1, 2 and 6. Rows written by v2 carry
# completed_by = 'staff:3/v2'; any other marker is a job-001 (8-step) row, mapped on read:
# old 1 -> new 1, old 4 -> new 2, everything else is ignored. No migration, no data rewrite.
COURIER_CHECKLIST_MANUAL_STEPS = frozenset({1, 2, 6})
COURIER_CHECKLIST_MARKER = "staff:3/v2"
# Maps one stored row (alias c) to its v2 step number, or NULL when the row is ignored. The marker is a
# server-side constant, not client input; it must equal COURIER_CHECKLIST_MARKER.
_COURIER_CHECKLIST_STEP_SQL = """CASE
            WHEN c.completed_by = 'staff:3/v2' THEN CASE WHEN c.step IN (1, 2, 6) THEN c.step::integer END
            WHEN c.step = 1 THEN 1
            WHEN c.step = 4 THEN 2
        END"""
_COURIER_CHECKLIST_AGG_SQL = (f"array_agg(DISTINCT {_COURIER_CHECKLIST_STEP_SQL})"
                              f" FILTER (WHERE {_COURIER_CHECKLIST_STEP_SQL} IS NOT NULL)")

# Order-level pharmacy as the courier sees it (pharmacy-entered orders default to their creator).
_COURIER_ORDER_PHARMACY_SQL = """COALESCE(o.fulfillment_pharmacy_id,
               CASE WHEN o.created_by_staff_account_id IN (1, 2)
                    THEN o.created_by_staff_account_id ELSE 1 END)"""

# Assembly marks (job 011): one entry per assembly pharmacy = distinct effective pharmacy of the items
# that pharmacy has not answered «Нет в наличии» (unanswered items count). Website orders only; the
# state is 'waiting' while the pharmacy has no mark. assembly_complete is derived in _courier_order_row.
# Per-item pharmacy answers (job 010). Effective item pharmacy = the item's own assignment, else the
# order's. The "current" answer is the one from that pharmacy; pharmacy_answers_complete and
# confirmed_total (client sum of items answered «available») are computed here, never by a client.
_COURIER_ORDER_SELECT = f"""
    SELECT o.id, o.public_id, o.order_reference, o.customer_name, o.phone,
           o.address, o.landmark, o.notes, o.order_source, o.status, o.created_at,
           o.delivery_courier_amount, o.order_total,
           o.created_by_staff_account_id IS NULL AS website_order,
           COALESCE(o.created_by_staff_account_id = 3, false) AS own_order,
           COALESCE(items.medicines, '[]'::json) AS medicines,
           COALESCE(items.pharmacy_answers_complete, false) AS pharmacy_answers_complete,
           items.confirmed_total,
           COALESCE(items.unavailable_count, 0) AS unavailable_count,
           COALESCE(items.answered_count, 0) AS answered_count,
           COALESCE(items.item_count, 0) AS item_count,
           COALESCE(checklist.steps, ARRAY[]::integer[]) AS checklist_steps,
           COALESCE(assembly.list, '[]'::json) AS assembly,
           {_COURIER_ORDER_PHARMACY_SQL} AS pharmacy_id
    FROM orders o
    LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('order_item_id', oi.id, 'medicine_id', oi.medicine_id,
            'medicine_name', oi.medicine_name, 'quantity', oi.quantity,
            'base_unit_price', COALESCE(oi.base_unit_price, oi.price),
            'selling_unit_price', COALESCE(oi.selling_unit_price, oi.price),
            'line_total', oi.line_total,
            'pharmacy_id', COALESCE(oi.fulfillment_pharmacy_id, {_COURIER_ORDER_PHARMACY_SQL}),
            'answers', COALESCE(answers.list, '[]'::json)) ORDER BY oi.id) AS medicines,
            COUNT(*) AS item_count,
            COUNT(cur.answer) AS answered_count,
            COUNT(*) FILTER (WHERE cur.answer = 'unavailable') AS unavailable_count,
            (COUNT(*) > 0 AND COUNT(cur.answer) = COUNT(*)) AS pharmacy_answers_complete,
            CASE WHEN COUNT(*) > 0 AND COUNT(cur.answer) = COUNT(*)
                      AND COUNT(*) FILTER (WHERE cur.answer = 'price_differs') = 0
                 THEN COALESCE(SUM(oi.line_total) FILTER (WHERE cur.answer = 'available'), 0)
            END AS confirmed_total
        FROM order_items oi
        LEFT JOIN order_item_pharmacy_answers cur
               ON cur.order_item_id = oi.id
              AND cur.pharmacy_id = COALESCE(oi.fulfillment_pharmacy_id, {_COURIER_ORDER_PHARMACY_SQL})
        LEFT JOIN LATERAL (
            SELECT json_agg(json_build_object('pharmacy_id', a.pharmacy_id, 'answer', a.answer,
                'problem', a.problem, 'answered_at', a.answered_at) ORDER BY a.pharmacy_id) AS list
            FROM order_item_pharmacy_answers a WHERE a.order_item_id = oi.id
        ) answers ON true
        WHERE oi.order_id = o.id
    ) items ON true
    LEFT JOIN LATERAL (
        SELECT {_COURIER_CHECKLIST_AGG_SQL} AS steps
        FROM order_courier_checklist c WHERE c.order_id = o.id
    ) checklist ON true
    LEFT JOIN LATERAL (
        SELECT json_agg(json_build_object('pharmacy_id', ph.pharmacy_id,
            'state', COALESCE(asm.state, 'waiting'), 'started_at', asm.started_at,
            'assembled_at', asm.assembled_at) ORDER BY ph.pharmacy_id) AS list
        FROM (
            SELECT DISTINCT COALESCE(oi.fulfillment_pharmacy_id, {_COURIER_ORDER_PHARMACY_SQL}) AS pharmacy_id
            FROM order_items oi
            LEFT JOIN order_item_pharmacy_answers cur
                   ON cur.order_item_id = oi.id
                  AND cur.pharmacy_id = COALESCE(oi.fulfillment_pharmacy_id, {_COURIER_ORDER_PHARMACY_SQL})
            WHERE oi.order_id = o.id AND o.created_by_staff_account_id IS NULL
              AND cur.answer IS DISTINCT FROM 'unavailable'
        ) ph
        LEFT JOIN order_pharmacy_assembly asm ON asm.order_id = o.id AND asm.pharmacy_id = ph.pharmacy_id
    ) assembly ON true
"""


def _checklist_steps(value: Any) -> list[int]:
    return sorted({int(step) for step in (value or []) if int(step) in COURIER_CHECKLIST_MANUAL_STEPS})


def _courier_order_row(row: dict[str, Any]) -> dict[str, Any]:
    row["order_id"] = row.pop("public_id") or f"legacy_{row['id']}"
    row.pop("id")
    row["checklist_steps"] = _checklist_steps(row.get("checklist_steps"))
    row["created_at"] = order_time_iso(row["created_at"])
    row["pharmacy_answers_complete"] = bool(row.get("pharmacy_answers_complete"))
    confirmed = row.get("confirmed_total")
    # Decimal string from the SQL sum; null while answers are incomplete or a price differs.
    row["confirmed_total"] = None if confirmed is None or not row["pharmacy_answers_complete"] else str(confirmed)
    row["unavailable_count"] = int(row.get("unavailable_count") or 0)
    row["answered_count"] = int(row.get("answered_count") or 0)
    row["item_count"] = int(row.get("item_count") or 0)
    assembly = row.get("assembly")
    if isinstance(assembly, str):
        assembly = json.loads(assembly)
    if not row.get("website_order") or not isinstance(assembly, list):
        assembly = []
    row["assembly"] = [{"pharmacy_id": int(entry["pharmacy_id"]),
                        "state": entry.get("state") if entry.get("state") in ASSEMBLY_STATES else "waiting",
                        "started_at": entry.get("started_at"), "assembled_at": entry.get("assembled_at")}
                       for entry in sorted(assembly, key=lambda value: int(value["pharmacy_id"]))]
    # Rework 1: every assembly pharmacy marked «Собран» (vacuously true without any, e.g. courier-created
    # orders or all items unavailable). Not tied to «confirmed»: «Согласовано» waits for it.
    row["assembly_complete"] = (row.get("status") != "cancelled"
                                and all(entry["state"] == "assembled" for entry in row["assembly"]))
    # Job 013: shared stage rule (shared.order_stage); «Собран» needs at least one assembly pharmacy.
    row["stage"] = order_stage(row.get("status"), assembly_complete(
        row.get("website_order"), [entry["state"] for entry in row["assembly"]]))
    return row


def _require_courier_own_order(order: dict[str, Any]) -> None:
    """Couriers change content only in orders they entered; website orders belong to the admin."""
    if order.get("created_by_staff_account_id") != 3:
        raise ContractError("FORBIDDEN", "Заказ с сайта может изменить только администратор", http_status=403)


def get_courier_order(order_id: str) -> dict[str, Any]:
    lookup, lookup_values = _order_lookup(order_id, "o")
    with transaction() as cur:
        cur.execute(f"{_COURIER_ORDER_SELECT} WHERE {lookup} AND o.deleted_at IS NULL", lookup_values)
        row = cur.fetchone()
        if not row:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        # Job 016: the courier's short history, two bounded reads; only courier-visible audit actions.
        public_order_id = row["public_id"] or f"legacy_{row['id']}"
        limit = TIMELINE_LIMIT + 1
        cur.execute(
            """SELECT id, from_status, to_status, actor_type, actor_id, reason, created_at
               FROM order_status_history WHERE order_id = %s
               ORDER BY created_at DESC, id DESC LIMIT %s""",
            (row["id"], limit),
        )
        status_rows = [dict(entry) for entry in cur.fetchall()]
        cur.execute(
            """SELECT id, actor_id, action, resource_type, resource_id, details, created_at
               FROM admin_audit_log
               WHERE resource_type = 'order' AND resource_id = %s AND action = ANY(%s::text[])
               ORDER BY created_at DESC, id DESC LIMIT %s""",
            (public_order_id, list(COURIER_ACTIONS), limit),
        )
        audit_rows = [dict(entry) for entry in cur.fetchall()]
    result = _courier_order_row(dict(row))
    medicines = result.get("medicines")
    if isinstance(medicines, str):
        medicines = json.loads(medicines)
    item_names = {int(item["order_item_id"]): str(item.get("medicine_name") or "")
                  for item in (medicines or []) if isinstance(item, dict) and item.get("order_item_id")}
    creator = ({"actor": "customer"} if result.get("website_order")
               else {"actor": "courier"} if result.get("own_order") else None)
    events, truncated = build_timeline(
        created_at=row["created_at"], creator=creator, status_rows=status_rows, audit_rows=audit_rows,
        item_names=item_names, source_truncated=len(status_rows) >= limit or len(audit_rows) >= limit,
    )
    result["timeline"] = courier_view(events)
    result["timeline_truncated"] = truncated
    return result


def list_courier_orders(query: dict[str, Any]) -> dict[str, Any]:
    """Delivery projection with the order's own client prices; no admin or payment fields."""
    if set(query) - {"limit", "cursor", "status"}:
        raise ContractError("VALIDATION_ERROR", "Unknown order filter")
    limit = min(_limit(query), 50)
    clauses = ["o.deleted_at IS NULL", "o.status <> 'cancelled'"]
    params: list[Any] = []
    status = query.get("status")
    if status:
        if status not in {"pending", "confirmed", "delivering", "delivered"}:
            raise ContractError("VALIDATION_ERROR", "status is invalid")
        clauses.append("o.status = %s")
        params.append(status)
    cursor = _decode_cursor(query.get("cursor"))
    if cursor:
        try:
            created_at = datetime.fromisoformat(cursor["created_at"])
            order_id = int(cursor["id"])
            if order_id <= 0:
                raise ValueError()
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "cursor is invalid") from exc
        clauses.append("(o.created_at, o.id) < (%s, %s)")
        params.extend([created_at, order_id])
    params.append(limit + 1)
    with transaction() as cur:
        cur.execute(
            f"""{_COURIER_ORDER_SELECT}
                WHERE {' AND '.join(clauses)}
                ORDER BY o.created_at DESC, o.id DESC LIMIT %s""",
            tuple(params),
        )
        rows = [dict(row) for row in cur.fetchall()]
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor({"created_at": last["created_at"].isoformat(), "id": last["id"]})
    return {"data": [_courier_order_row(row) for row in rows],
            "page": {"next_cursor": next_cursor, "has_more": has_more}}


def add_courier_order_items(
    order_id: str, payload: dict[str, Any], idempotency_key: str, current_request_id: str,
    actor_id: str = "staff:3",
    allow_cancelled: bool = False,
) -> dict[str, Any]:
    """Atomically add catalogue medicines to a non-cancelled order of either pharmacy.

    Both pharmacies share one catalogue price list; an optional unit_price sets the client price.
    """
    if not isinstance(payload, dict) or set(payload) != {"items"} or not isinstance(payload["items"], list):
        raise ContractError("VALIDATION_ERROR", "Укажите лекарства для добавления")
    if not 1 <= len(payload["items"]) <= 20:
        raise ContractError("VALIDATION_ERROR", "Можно добавить от 1 до 20 лекарств за раз")
    requested: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in payload["items"]:
        if (not isinstance(item, dict) or not {"medicine_id", "quantity"} <= set(item) <= {"medicine_id", "quantity", "unit_price"}
                or type(item["medicine_id"]) is not int or item["medicine_id"] <= 0
                or item["medicine_id"] in seen):
            raise ContractError("VALIDATION_ERROR", "Проверьте лекарства и количество")
        try:
            normalized = {"medicine_id": item["medicine_id"], "quantity": str(validate_order_quantity(item["quantity"]))}
        except ContractError as exc:
            raise ContractError("VALIDATION_ERROR", "Проверьте лекарства и количество") from exc
        if "unit_price" in item:
            normalized["unit_price"] = str(validate_unit_price(item["unit_price"]))
        requested.append(normalized)
        seen.add(item["medicine_id"])
    normalized_key = validate_idempotency_key(idempotency_key)
    request_hash = hashlib.sha256(json.dumps({"order_id": order_id, "items": requested},
        sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(f"""SELECT id, status, items_subtotal, created_by_staff_account_id,
                           COALESCE(fulfillment_pharmacy_id,
                               CASE WHEN created_by_staff_account_id IN (1, 2)
                                    THEN created_by_staff_account_id ELSE 1 END) AS pharmacy_id
                       FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        if order["status"] == "cancelled" and not allow_cancelled:
            raise ContractError("ORDER_STATUS_CONFLICT", "Отменённый заказ нельзя изменить", http_status=409)
        if actor_id == "staff:3":
            _require_courier_own_order(order)
        cur.execute("""INSERT INTO order_idempotency (idempotency_key, request_hash)
                       VALUES (%s, %s) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id""",
                    (normalized_key, request_hash))
        if not cur.fetchone():
            cur.execute("""SELECT request_hash, response_body FROM order_idempotency
                           WHERE idempotency_key = %s FOR UPDATE""", (normalized_key,))
            existing_request = cur.fetchone()
            if not existing_request or existing_request["request_hash"] != request_hash:
                raise ContractError("IDEMPOTENCY_CONFLICT", "Ключ уже использован для другого запроса", http_status=409)
            if existing_request["response_body"] is None:
                raise ContractError("IDEMPOTENCY_IN_PROGRESS", "Заказ ещё обновляется", http_status=409)
            return existing_request["response_body"]
        medicine_ids = [item["medicine_id"] for item in requested]
        cur.execute("""SELECT id, name, price, in_stock, vatan_selling_unit_price(price) AS selling_unit_price
                       FROM medicines WHERE id = ANY(%s) FOR UPDATE""", (medicine_ids,))
        medicines = {int(row["id"]): dict(row) for row in cur.fetchall()}
        if len(medicines) != len(medicine_ids):
            raise ContractError("MEDICINE_NOT_FOUND", "Лекарство не найдено", http_status=404)
        if any(not medicines[medicine_id]["in_stock"] for medicine_id in medicine_ids):
            raise ContractError("ORDER_ITEMS_UNAVAILABLE", "Лекарство уже не в наличии", http_status=409)
        cur.execute("""SELECT id, medicine_id, quantity FROM order_items
                       WHERE order_id = %s AND medicine_id = ANY(%s) ORDER BY id FOR UPDATE""",
                    (order["id"], medicine_ids))
        existing_items: dict[int, dict[str, Any]] = {}
        for row in cur.fetchall():
            existing_items.setdefault(int(row["medicine_id"]), dict(row))
        updates = []
        inserts = []
        for item in requested:
            medicine_id = item["medicine_id"]
            existing_item = existing_items.get(medicine_id)
            if existing_item:
                quantity = Decimal(str(existing_item["quantity"])) + Decimal(item["quantity"])
                if quantity > 99:
                    raise ContractError("VALIDATION_ERROR", "Количество одного лекарства не может превышать 99")
                updates.append({"order_item_id": int(existing_item["id"]), "quantity": str(quantity),
                                "unit_price": item.get("unit_price")})
            else:
                medicine = medicines[medicine_id]
                base_price = Decimal(str(medicine["price"]))
                if "unit_price" in item:
                    selling_price = Decimal(item["unit_price"])
                else:
                    selling_price = (base_price if order["created_by_staff_account_id"] is not None
                                     else Decimal(str(medicine["selling_unit_price"])))
                inserts.append({"medicine_id": medicine_id, "medicine_name": medicine["name"],
                    "quantity": item["quantity"], "base_unit_price": str(base_price),
                    "selling_unit_price": str(selling_price),
                    "line_total": str((selling_price * Decimal(item["quantity"])).quantize(Decimal("0.01")))})
        if updates:
            cur.execute("""UPDATE order_items oi SET quantity = data.quantity,
                           selling_unit_price = COALESCE(data.unit_price, oi.selling_unit_price),
                           price = COALESCE(data.unit_price, oi.price),
                           line_total = data.quantity * COALESCE(data.unit_price, oi.selling_unit_price, oi.price)
                           FROM jsonb_to_recordset(%s::jsonb) AS data(order_item_id bigint, quantity numeric,
                                                                      unit_price numeric)
                           WHERE oi.id = data.order_item_id AND oi.order_id = %s""",
                        (json.dumps(updates), order["id"]))
            _invalidate_pharmacy_answers(cur, order["id"], [update["order_item_id"] for update in updates])
        if inserts:
            cur.execute("""INSERT INTO order_items (order_id, medicine_id, medicine_name, price, quantity,
                           base_unit_price, selling_unit_price, line_total)
                           SELECT %s, item.medicine_id, item.medicine_name, item.selling_unit_price,
                                  item.quantity, item.base_unit_price, item.selling_unit_price, item.line_total
                           FROM jsonb_to_recordset(%s::jsonb) AS item(
                               medicine_id integer, medicine_name text, quantity numeric,
                               base_unit_price numeric, selling_unit_price numeric, line_total numeric)""",
                        (order["id"], json.dumps(inserts, ensure_ascii=False)))
        cur.execute("SELECT COALESCE(SUM(line_total), 0) AS total FROM order_items WHERE order_id = %s", (order["id"],))
        total = cur.fetchone()["total"]
        if total > Decimal("99999999.99"):
            raise ContractError("VALIDATION_ERROR", "Сумма заказа слишком велика")
        cur.execute("UPDATE orders SET items_subtotal = %s, order_total = %s, total_price = %s WHERE id = %s",
                    (total, total, total, order["id"]))
        result = {"order_id": order_id, "added": len(inserts), "quantity_increased": len(updates),
                  "items_subtotal": str(total), "currency": "TJS"}
        cur.execute("""UPDATE order_idempotency SET order_id = %s, response_status = 200,
                       response_body = %s::jsonb, completed_at = CURRENT_TIMESTAMP
                       WHERE idempotency_key = %s""",
                    (order["id"], json.dumps(result), normalized_key))
        _write_admin_audit(cur, actor_id=actor_id,
                           action="courier.order.items_added" if actor_id == "staff:3" else "admin.order.items_added",
                           resource_type="order", resource_id=order_id, request=current_request_id,
                           details={"items": requested, "old_subtotal": str(order["items_subtotal"]),
                                    "new_subtotal": str(total), "status": order["status"]})
    return result


def add_manual_order_items(
    order_id: str, payload: dict[str, Any], idempotency_key: str,
    current_request_id: str, actor_id: str, allow_cancelled: bool = False,
) -> dict[str, Any]:
    """Append order-only snapshots; never create or modify catalogue medicines."""
    if not isinstance(payload, dict) or set(payload) != {"manual_items"}:
        raise ContractError("VALIDATION_ERROR", "Укажите ручные позиции")
    manual_items = validate_manual_order_items(payload["manual_items"])
    normalized_key = validate_idempotency_key(idempotency_key)
    request_hash = hashlib.sha256(json.dumps({"order_id": order_id, "manual_items": manual_items},
        sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(f"""SELECT id, status, items_subtotal, created_by_staff_account_id FROM orders
                       WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        if order["status"] == "cancelled" and not allow_cancelled:
            raise ContractError("ORDER_STATUS_CONFLICT", "Отменённый заказ нельзя изменить", http_status=409)
        if actor_id == "staff:3":
            _require_courier_own_order(order)
        cur.execute("""INSERT INTO order_idempotency (idempotency_key, request_hash)
                       VALUES (%s, %s) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id""",
                    (normalized_key, request_hash))
        if not cur.fetchone():
            cur.execute("""SELECT request_hash, response_body FROM order_idempotency
                           WHERE idempotency_key = %s FOR UPDATE""", (normalized_key,))
            existing = cur.fetchone()
            if not existing or existing["request_hash"] != request_hash:
                raise ContractError("IDEMPOTENCY_CONFLICT", "Ключ уже использован для другого запроса", http_status=409)
            if existing["response_body"] is None:
                raise ContractError("IDEMPOTENCY_IN_PROGRESS", "Заказ ещё обновляется", http_status=409)
            return existing["response_body"]
        records = [{"medicine_name": item["medicine_name"], "quantity": item["quantity"],
                    "price": item["price"], "line_total": str(Decimal(item["price"]) * Decimal(item["quantity"]))}
                   for item in manual_items]
        cur.execute("""INSERT INTO order_items (order_id, medicine_id, medicine_name, price, quantity,
                       base_unit_price, selling_unit_price, line_total)
                       SELECT %s, NULL, item.medicine_name, item.price, item.quantity,
                              item.price, item.price, item.line_total
                       FROM jsonb_to_recordset(%s::jsonb) AS item(
                           medicine_name text, quantity numeric, price numeric, line_total numeric)""",
                    (order["id"], json.dumps(records, ensure_ascii=False)))
        cur.execute("SELECT COALESCE(SUM(line_total), 0) AS total FROM order_items WHERE order_id = %s", (order["id"],))
        total = cur.fetchone()["total"]
        if total > Decimal("99999999.99"):
            raise ContractError("VALIDATION_ERROR", "Сумма заказа слишком велика")
        cur.execute("UPDATE orders SET items_subtotal = %s, order_total = %s, total_price = %s WHERE id = %s",
                    (total, total, total, order["id"]))
        result = {"order_id": order_id, "added": len(records), "items_subtotal": str(total), "currency": "TJS"}
        cur.execute("""UPDATE order_idempotency SET order_id = %s, response_status = 200,
                       response_body = %s::jsonb, completed_at = CURRENT_TIMESTAMP
                       WHERE idempotency_key = %s""", (order["id"], json.dumps(result), normalized_key))
        _write_admin_audit(cur, actor_id=actor_id, action="order.manual_items_added",
                           resource_type="order", resource_id=order_id, request=current_request_id,
                           details={"manual_items": manual_items, "old_subtotal": str(order["items_subtotal"]),
                                    "new_subtotal": str(total), "status": order["status"]})
    return result


# Effective pharmacy of an order item (job 010): its own assignment, else the order's, else «Ватан 1».
_ITEM_PHARMACY_SQL = "COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)"


def _invalidate_pharmacy_answers(cur: Any, order_db_id: int, order_item_ids: list[int]) -> None:
    """An admin change of quantity or pharmacy (base) price voids the answer of the item's current
    pharmacy, so it must be answered again. The assignment and other pharmacies' answers are kept."""
    if not order_item_ids:
        return
    cur.execute(f"""DELETE FROM order_item_pharmacy_answers a
                    USING order_items oi JOIN orders o ON o.id = oi.order_id
                    WHERE a.order_item_id = oi.id AND oi.order_id = %s AND oi.id = ANY(%s)
                      AND a.pharmacy_id = {_ITEM_PHARMACY_SQL}""",
                (order_db_id, [int(item_id) for item_id in order_item_ids]))


def list_pharmacy_preparation_orders(query: dict[str, Any], pharmacy_id: int) -> dict[str, Any]:
    """Only live website orders with at least one item assigned to this pharmacy; only those items.

    No courier/admin financial data. Per item: order_item_id, my_answer, my_problem (this pharmacy's
    own answer). routed_away_count = items this pharmacy answered and that now sit at another pharmacy.
    """
    if set(query) - {"limit", "cursor"}:
        raise ContractError("VALIDATION_ERROR", "Unknown order filter")
    limit = min(_limit(query), 50)
    cursor = _decode_cursor(query.get("cursor"))
    params: list[Any] = [pharmacy_id] * 7
    cursor_filter = ""
    if cursor:
        try:
            order_id = int(cursor["id"])
            if order_id <= 0:
                raise ValueError()
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "cursor is invalid") from exc
        cursor_filter = "AND o.id < %s"
        params.append(order_id)
    params.append(limit + 1)
    with transaction() as cur:
        cur.execute(
            f"""SELECT o.id, o.public_id, o.order_reference, o.status, o.created_at,
                       o.notes, o.customer_name, o.phone, o.address, o.landmark,
                       o.order_source, o.utm_source, o.order_total, o.created_by_staff_account_id,
                       COALESCE(items.base_total, 0) AS base_total,
                       COALESCE(items.medicines, '[]'::json) AS medicines,
                       COALESCE(items.unanswered_count, 0) AS unanswered_count,
                       COALESCE(items.unanswered_unrouted, false) AS unanswered_unrouted,
                       items.unanswered_routed_since,
                       COALESCE(routed.routed_away_count, 0) AS routed_away_count,
                       COALESCE(routed.routed_away, '[]'::json) AS routed_away,
                       COALESCE(items.assemblable_count, 0) AS assemblable_count,
                       COALESCE(items.all_routed_here, false) AS all_routed_here,
                       items.routed_here_since,
                       asm.state AS assembly_state,
                       {assembled_sql("o")} AS stage_assembled
                FROM orders o
                LEFT JOIN LATERAL (
                    SELECT json_agg(json_build_object('order_item_id', oi.id, 'medicine_name', oi.medicine_name,
                        'quantity', oi.quantity, 'line_total', oi.line_total,
                        'base_unit_price', COALESCE(oi.base_unit_price, oi.price)::text,
                        'base_line_total', (COALESCE(oi.base_unit_price, oi.price) * oi.quantity)::text,
                        'my_answer', mine.answer, 'my_problem', mine.problem,
                        'routed_here', oi.pharmacy_assigned_at IS NOT NULL,
                        'collected', col.order_item_id IS NOT NULL)
                        ORDER BY oi.id) AS medicines,
                        SUM(COALESCE(oi.base_unit_price, oi.price) * oi.quantity) AS base_total,
                        COUNT(*) FILTER (WHERE mine.answer IS NULL) AS unanswered_count,
                        bool_or(oi.pharmacy_assigned_at IS NULL) FILTER (WHERE mine.answer IS NULL)
                            AS unanswered_unrouted,
                        MIN(oi.pharmacy_assigned_at) FILTER (WHERE mine.answer IS NULL) AS unanswered_routed_since,
                        COUNT(*) FILTER (WHERE mine.answer IS DISTINCT FROM 'unavailable') AS assemblable_count,
                        bool_and(oi.pharmacy_assigned_at IS NOT NULL) AS all_routed_here,
                        MIN(oi.pharmacy_assigned_at) AS routed_here_since
                    FROM order_items oi
                    LEFT JOIN order_item_pharmacy_answers mine
                           ON mine.order_item_id = oi.id AND mine.pharmacy_id = %s
                    LEFT JOIN order_item_assembly col
                           ON col.order_item_id = oi.id AND col.pharmacy_id = %s
                    WHERE oi.order_id = o.id AND {_ITEM_PHARMACY_SQL} = %s
                ) items ON true
                LEFT JOIN LATERAL (
                    SELECT COUNT(*) AS routed_away_count,
                        json_agg(json_build_object('order_item_id', oi.id, 'medicine_name', oi.medicine_name,
                            'quantity', oi.quantity, 'pharmacy_id', {_ITEM_PHARMACY_SQL},
                            'answer', cur.answer) ORDER BY oi.id) AS routed_away
                    FROM order_items oi
                    JOIN order_item_pharmacy_answers mine
                      ON mine.order_item_id = oi.id AND mine.pharmacy_id = %s
                    LEFT JOIN order_item_pharmacy_answers cur
                           ON cur.order_item_id = oi.id AND cur.pharmacy_id = {_ITEM_PHARMACY_SQL}
                    WHERE oi.order_id = o.id AND {_ITEM_PHARMACY_SQL} <> %s
                ) routed ON true
                LEFT JOIN order_pharmacy_assembly asm ON asm.order_id = o.id AND asm.pharmacy_id = %s
                WHERE o.deleted_at IS NULL AND o.created_by_staff_account_id IS NULL
                  AND o.status IN ('pending', 'confirmed')
                  AND EXISTS (SELECT 1 FROM order_items oi
                              WHERE oi.order_id = o.id AND {_ITEM_PHARMACY_SQL} = %s)
                  {cursor_filter}
                ORDER BY o.id DESC LIMIT %s""",
            tuple(params),
        )
        rows = [dict(row) for row in cur.fetchall()]
        cur.execute("SELECT courier_enabled, policies, revision FROM order_notification_settings WHERE singleton_id = 1")
        settings = effective_settings(cur.fetchone())
        policy = settings["policies"]["pharmacy_web"]
        # Job 014: the owner's alarm (ringtone, duration, interval) for both pharmacies; no client data.
        alarm = settings["pharmacy_alarm"]
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor({"id": last["id"]})
    for row in rows:
        row["order_id"] = row.pop("public_id") or f"legacy_{row['id']}"
        row.pop("id")
        row["created_at"] = order_time_iso(row["created_at"])
        # Not policy-gated and free of client data: drive the pharmacy "waiting N min" badge and actions.
        # Waiting = pending and at least one assigned item without this pharmacy's answer; it starts at
        # the earliest of those items' assignment (routing) time, or at order creation.
        unanswered = int(row.pop("unanswered_count", 0) or 0)
        unrouted = bool(row.pop("unanswered_unrouted", False))
        routed_since = row.pop("unanswered_routed_since", None)
        row["awaiting_response"] = row["status"] == "pending" and unanswered > 0
        row["waiting_since"] = (order_time_iso(routed_since)
                                if row["awaiting_response"] and not unrouted and routed_since is not None
                                else row["created_at"])
        row["routed_away_count"] = int(row.get("routed_away_count") or 0)
        # Job 011 assembly mark of this pharmacy (null = «Ждёт сборки»); also ungated and client-free.
        assemblable = int(row.pop("assemblable_count", 0) or 0)
        row["assembly_state"] = row.get("assembly_state") if row.get("assembly_state") in ASSEMBLY_STATES else None
        # Rework 1: assembly starts while the order is still «Новый» (and stays possible once confirmed).
        row["assembly_available"] = row["status"] in ASSEMBLY_ORDER_STATUSES and assemblable > 0
        # Job 013 reminders (replace job 012's "first reaction"), ungated and client-free: the order is in
        # this queue (live website order, pending/confirmed), this pharmacy has something to assemble and its
        # part is not «Собран» yet. Answers, «Начать сборку» and routing do not stop them; «Сборка сделана»
        # (or, for «Ватан 2», the last per-item «Собрано») does. The clock starts at creation, or at the
        # earliest routing time when every item of this pharmacy was routed here.
        all_routed_here = bool(row.pop("all_routed_here", False))
        routed_here_since = row.pop("routed_here_since", None)
        row["needs_attention"] = (row["status"] in ASSEMBLY_ORDER_STATUSES and assemblable > 0
                                  and row["assembly_state"] != "assembled")
        row["attention_since"] = None
        if row["needs_attention"]:
            row["attention_since"] = (order_time_iso(routed_here_since)
                                      if all_routed_here and routed_here_since is not None else row["created_at"])
        row["stage"] = order_stage(row["status"], row.pop("stage_assembled", False))
        row["profit"] = (row["order_total"] or Decimal("0")) - row["base_total"]
        if policy["source"]:
            utm_source = row.pop("utm_source")
            row["source"] = row.pop("order_source") or (f"Сайт · {utm_source}" if utm_source else "Сайт")
        else:
            row.pop("order_source")
            row.pop("utm_source")
        fields = {
            "order_reference": "order_reference", "created_at": "created_at", "customer_name": "customer_name",
            "phone": "phone", "address": "address", "landmark": "landmark", "comment": "notes",
            "client_total": "order_total", "base_total": "base_total", "profit": "profit",
            "creator": "created_by_staff_account_id", "status": "status",
        }
        for field, key in fields.items():
            if not policy[field]:
                row.pop(key, None)
        if not policy["status"]:
            row.pop("stage", None)  # the stage goes with the policy-gated status field
        # Items moved to another pharmacy, with that pharmacy's answer (no client data). Shown with the
        # owner's colours: available there = «В аптеке 2», unavailable there = «Нет в наличии в обеих аптеках».
        routed_away = row.pop("routed_away", None)
        if isinstance(routed_away, str):
            routed_away = json.loads(routed_away)
        if policy["items"]:
            row["routed_away"] = [{key: entry.get(key) for key in
                                   ("order_item_id", "medicine_name", "quantity", "pharmacy_id", "answer")
                                   if key != "quantity" or policy["quantity"]}
                                  for entry in (routed_away or [])]
        if not policy["items"]:
            row.pop("medicines", None)
        else:
            for item in row["medicines"]:
                for field, key in (("quantity", "quantity"), ("item_client_total", "line_total"),
                                   ("item_base_total", "base_unit_price"),
                                   ("item_base_total", "base_line_total")):
                    if not policy[field]:
                        item.pop(key, None)
    return {"data": rows, "page": {"next_cursor": next_cursor, "has_more": has_more}, "alarm": alarm}


PHARMACY_ANSWERS = ("available", "unavailable", "price_differs")
# Job 011 pharmacy assembly marks: forward only, none -> assembling -> assembled. Job 015: one «Собран»
# button, so none -> assembled directly; «assembling» stays for old clients and the job 014 reopen.
ASSEMBLY_STATES = ("assembling", "assembled")
# Rework 1 (owner, 2026-10-16): pharmacies assemble while the order is «Новый», before the courier's call;
# confirmed orders still accept marks (orders confirmed before this change).
ASSEMBLY_ORDER_STATUSES = ("pending", "confirmed")
_ASSEMBLY_TRANSITIONS = {(None, "assembling"), (None, "assembled"), ("assembling", "assembled")}
ASSEMBLY_ALREADY_DONE_MESSAGE = "Заказ уже отмечен «Собран»"
PHARMACY_ANSWER_MAX_ITEMS = 50
PHARMACY_PROBLEM_MIN, PHARMACY_PROBLEM_MAX = 3, 300
_ORDER_ITEM_ID_MAX = 9223372036854775807


def validate_pharmacy_answers(payload: Any) -> list[dict[str, Any]]:
    """Body {"answers": [{order_item_id, answer, problem?, base_unit_price?}]}; no pharmacy id, no other keys.

    base_unit_price (rework 1) is the pharmacy's own price for an «available» item: 0.01..999999.99 with at
    most two decimals. It is an input only; the Lambda recomputes client prices and totals itself.
    """
    if not isinstance(payload, dict) or set(payload) != {"answers"} or not isinstance(payload["answers"], list):
        raise ContractError("VALIDATION_ERROR", "Укажите ответы по позициям")
    entries = payload["answers"]
    if not 1 <= len(entries) <= PHARMACY_ANSWER_MAX_ITEMS:
        raise ContractError("VALIDATION_ERROR", f"Можно ответить от 1 до {PHARMACY_ANSWER_MAX_ITEMS} позиций за раз")
    answers: list[dict[str, Any]] = []
    seen: set[int] = set()
    for entry in entries:
        if (not isinstance(entry, dict)
                or not {"order_item_id", "answer"} <= set(entry) <= {"order_item_id", "answer", "problem",
                                                                   "base_unit_price"}):
            raise ContractError("VALIDATION_ERROR", "Проверьте позиции и ответы")
        item_id = entry["order_item_id"]
        if type(item_id) is not int or not 0 < item_id <= _ORDER_ITEM_ID_MAX:
            raise ContractError("VALIDATION_ERROR", "Неверная позиция заказа")
        if item_id in seen:
            raise ContractError("VALIDATION_ERROR", "Позиция указана дважды")
        seen.add(item_id)
        answer = entry["answer"]
        if not isinstance(answer, str) or answer not in PHARMACY_ANSWERS:
            raise ContractError("VALIDATION_ERROR", "Неверный ответ по позиции")
        raw_problem = entry.get("problem")
        if raw_problem is not None and not isinstance(raw_problem, str):
            raise ContractError("VALIDATION_ERROR", "Описание проблемы должно быть текстом")
        if answer == "available":
            if raw_problem is not None:
                raise ContractError("VALIDATION_ERROR", "Для «В наличии» проблема не указывается")
            problem = None
        else:
            problem = " ".join(raw_problem.split()) if raw_problem is not None else ""
            if "\x00" in problem:
                raise ContractError("VALIDATION_ERROR", "Описание проблемы содержит недопустимые символы")
            if not problem:
                if answer == "price_differs":
                    raise ContractError("VALIDATION_ERROR", "Опишите, чем отличается цена")
                problem = None
            elif not PHARMACY_PROBLEM_MIN <= len(problem) <= PHARMACY_PROBLEM_MAX:
                raise ContractError("VALIDATION_ERROR",
                                    f"Описание проблемы: от {PHARMACY_PROBLEM_MIN} до {PHARMACY_PROBLEM_MAX} символов")
        base_unit_price = None
        if "base_unit_price" in entry:
            if answer != "available":
                raise ContractError("VALIDATION_ERROR", "Цену можно указать только для «В наличии»")
            base_unit_price = validate_unit_price(entry["base_unit_price"])
        parsed = {"order_item_id": item_id, "answer": answer, "problem": problem}
        if base_unit_price is not None:
            parsed["base_unit_price"] = base_unit_price
        answers.append(parsed)
    return answers


def answer_pharmacy_order_items(
    order_id: str, payload: Any, pharmacy_id: int, current_request_id: str,
) -> dict[str, Any]:
    """A pharmacy answers availability/price per item of a pending website order (job 010).

    pharmacy_id comes from the HMAC staff session only. «Нет в наличии» from «Ватан 1» routes that item
    to «Ватан 2» in the same transaction; «Ватан 2» «Нет в наличии» is final; «Цена отличается» never
    routes. Either pharmacy may send its own (base) price with «В наличии» for its own item (job 013; was
    «Ватан 2» only); client prices and totals are recomputed in SQL. orders.status and
    order_status_history are never touched. Repeating the same request is a no-op (no writes, no audit)
    and returns the same projection. A request that routes an item, changes a price or (job 014) records a
    «Ватан 2» «Нет в наличии» also returns `_notification` (owner/courier Telegram, no client data); the
    Next.js route strips it. Routing also reopens a stale «Собран» mark of «Ватан 2» (job 014).
    """
    if pharmacy_id not in (1, 2):
        raise ContractError("FORBIDDEN", "Доступ только для аптеки", http_status=403)
    answers = validate_pharmacy_answers(payload)
    lookup, lookup_values = _order_lookup(order_id)
    actor = f"staff:{pharmacy_id}"
    with transaction() as cur:
        cur.execute(f"""SELECT id, public_id, order_reference, status, created_by_staff_account_id,
                               fulfillment_pharmacy_id
                        FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order or order["created_by_staff_account_id"] is not None:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        cur.execute(f"""SELECT oi.id, {_ITEM_PHARMACY_SQL} AS pharmacy_id, mine.answer, mine.problem,
                               COALESCE(oi.base_unit_price, oi.price) AS base_unit_price,
                               COALESCE(oi.selling_unit_price, oi.price) AS selling_unit_price,
                               oi.medicine_name, oi.quantity
                        FROM order_items oi
                        JOIN orders o ON o.id = oi.order_id
                        LEFT JOIN order_item_pharmacy_answers mine
                               ON mine.order_item_id = oi.id AND mine.pharmacy_id = %s
                        WHERE oi.order_id = %s ORDER BY oi.id FOR UPDATE OF oi""",
                    (pharmacy_id, order["id"]))
        items = {int(row["id"]): dict(row) for row in cur.fetchall()}
        if not any(int(item["pharmacy_id"]) == pharmacy_id for item in items.values()):
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        if order["status"] != "pending":
            raise ContractError("ORDER_STATUS_CONFLICT",
                                "Ответить можно только по новому заказу", http_status=409)
        # Job 015: after «Собран» this pharmacy's part is read-only, so the courier's «Заказ собран» message
        # stays true. The job 014 reopen (routing to «Ватан 2») sets the part back to «Собирается».
        cur.execute("""SELECT state FROM order_pharmacy_assembly WHERE order_id = %s AND pharmacy_id = %s""",
                    (order["id"], pharmacy_id))
        if any(row.get("state") == "assembled" for row in cur.fetchall()):
            raise ContractError("ASSEMBLY_STATE_CONFLICT", ASSEMBLY_ALREADY_DONE_MESSAGE, http_status=409)
        changes: list[dict[str, Any]] = []
        routed: list[int] = []
        unavailable_both: list[int] = []
        price_changes: list[dict[str, Any]] = []
        for entry in answers:
            item = items.get(entry["order_item_id"])
            if not item:
                raise ContractError("ORDER_ITEM_NOT_FOUND", "Позиция не найдена в заказе", http_status=404)
            new_base = entry.get("base_unit_price")
            current_base = item.get("base_unit_price")
            price_change = new_base is not None and (current_base is None or Decimal(str(current_base)) != new_base)
            same = (item["answer"] == entry["answer"] and item["problem"] == entry["problem"]
                    and not price_change)
            if int(item["pharmacy_id"]) != pharmacy_id:
                # An item this pharmacy already routed away may be re-sent unchanged (idempotent);
                # anything else on another pharmacy's item is forbidden.
                if same:
                    continue
                raise ContractError("FORBIDDEN", "Эта позиция передана другой аптеке", http_status=403)
            if same:
                continue
            if price_change:
                price_changes.append({"order_item_id": entry["order_item_id"],
                                      "previous_base_unit_price": current_base, "new_base_unit_price": new_base})
            if item["answer"] == entry["answer"] and item["problem"] == entry["problem"]:
                continue  # only the price changed
            changes.append(entry)
            if pharmacy_id == 1 and entry["answer"] == "unavailable":
                routed.append(entry["order_item_id"])
            elif pharmacy_id == 2 and entry["answer"] == "unavailable":
                unavailable_both.append(entry["order_item_id"])  # job 014: owner/courier are told
        if changes:
            cur.execute("""INSERT INTO order_item_pharmacy_answers
                               (order_item_id, pharmacy_id, answer, problem, answered_by)
                           SELECT data.order_item_id, %s, data.answer, data.problem, %s
                           FROM jsonb_to_recordset(%s::jsonb) AS data(order_item_id bigint, answer text, problem text)
                           ON CONFLICT (order_item_id, pharmacy_id) DO UPDATE
                           SET answer = EXCLUDED.answer, problem = EXCLUDED.problem,
                               answered_by = EXCLUDED.answered_by, answered_at = now()""",
                        (pharmacy_id, actor, json.dumps(
                            [{key: entry[key] for key in ("order_item_id", "answer", "problem")} for entry in changes],
                            ensure_ascii=False)))
            if routed:
                cur.execute("""UPDATE order_items SET fulfillment_pharmacy_id = 2, pharmacy_assigned_at = now()
                               WHERE order_id = %s AND id = ANY(%s)""",
                            (order["id"], routed))
                _reopen_pharmacy_two_assembly(cur, order["id"], order_id, routed, current_request_id)
            _write_admin_audit(cur, actor_id=actor, action="pharmacy.order.items_answered",
                               resource_type="order", resource_id=order_id, request=current_request_id,
                               details={"pharmacy_id": pharmacy_id,
                                        "items": [{"order_item_id": entry["order_item_id"], "answer": entry["answer"]}
                                                  for entry in changes],
                                        "routed_to_pharmacy_2": routed})
        repriced: dict[int, dict[str, Any]] = {}
        if price_changes:
            repriced = {entry["order_item_id"]: entry for entry in _reprice_items_from_base(
                cur, order["id"], order_id, pharmacy_id, price_changes, current_request_id)}
        if changes or price_changes:
            _sync_item_assembly(cur, order["id"], pharmacy_id)
        for entry in changes:
            item = items[entry["order_item_id"]]
            item["answer"], item["problem"] = entry["answer"], entry["problem"]
            if entry["order_item_id"] in routed:
                item["pharmacy_id"] = 2
    mine = [item for item in items.values() if int(item["pharmacy_id"]) == pharmacy_id]
    away = [item for item in items.values() if int(item["pharmacy_id"]) != pharmacy_id and item["answer"]]
    result: dict[str, Any] = {
        "order_id": order_id,
        "items": [{"order_item_id": int(item["id"]), "my_answer": item["answer"], "my_problem": item["problem"]}
                  for item in sorted(mine, key=lambda value: int(value["id"]))],
        "routed_away_count": len(away),
        "awaiting_response": any(item["answer"] is None for item in mine),
    }
    notification = _pharmacy_change_notification(order, order_id, pharmacy_id, items, routed, repriced,
                                                 current_request_id, unavailable_both)
    if notification:
        result["_notification"] = notification
    return result


def _reopen_pharmacy_two_assembly(
    cur: Any, order_db_id: int, order_id: str, routed: list[int], current_request_id: str,
) -> None:
    """Job 014: «Ватан 1» just routed new items to «Ватан 2». If «Ватан 2» had already marked its part
    «Собран» (e.g. it collected an earlier routed item), that mark is stale: reopen it to «Собирается» so
    «Ватан 2» is alerted again, the order leaves «Собран» and «Согласовано» waits. Items already collected
    keep their «Собрано». One statement in the routing transaction; the audit row is written only when a
    part was actually reopened. The actor is always 'staff:1': only «Ватан 1» routes items (see
    answer_pharmacy_order_items); pass the actor in if that ever changes."""
    cur.execute("""WITH reopened AS (
                       UPDATE order_pharmacy_assembly
                       SET state = 'assembling', assembled_at = NULL, updated_by = 'staff:1'
                       WHERE order_id = %s AND pharmacy_id = 2 AND state = 'assembled'
                       RETURNING order_id)
                   INSERT INTO admin_audit_log (actor_id, action, resource_type, resource_id, request_id, details)
                   SELECT 'staff:1', 'pharmacy.order.assembly_reopened', 'order', %s, %s, %s::jsonb
                   FROM reopened""",
                (order_db_id, order_id, current_request_id,
                 json.dumps({"pharmacy_id": 2, "from_state": "assembled", "to_state": "assembling",
                             "routed_order_item_ids": sorted(routed)})))


def _decimal_text(value: Any) -> str | None:
    return None if value is None else str(value)


def _pharmacy_change_notification(
    order: Any, order_id: str, pharmacy_id: int, items: dict[int, dict[str, Any]], routed: list[int],
    repriced: dict[int, dict[str, Any]], current_request_id: str, unavailable_both: list[int] | None = None,
) -> dict[str, Any] | None:
    """Job 013 owner/courier Telegram payload for a price change or a routing to «Ватан 2»; job 014 adds
    «Ватан 2» «Нет в наличии» (kind "unavailable_both": the item is missing in both pharmacies).

    Only the reference, the pharmacy and the changed items (name, quantity, prices); never the client
    name, phone, address, landmark or comment. None when nothing was routed, repriced or reported missing."""
    missing = set(unavailable_both or ())
    changes: list[dict[str, Any]] = []
    for item_id in sorted(set(routed) | set(repriced) | missing):
        item = items.get(item_id) or {}
        base = {"medicine_name": item.get("medicine_name"), "quantity": _decimal_text(item.get("quantity"))}
        if item_id in routed:
            changes.append({"kind": "routed", **base})
        if item_id in missing:
            changes.append({"kind": "unavailable_both", **base})
        if item_id in repriced:
            change = repriced[item_id]
            changes.append({"kind": "price", **base,
                            "old_base_unit_price": change["previous_base_unit_price"],
                            "new_base_unit_price": change["new_base_unit_price"],
                            "old_selling_unit_price": _decimal_text(item.get("selling_unit_price")),
                            "new_selling_unit_price": change["new_selling_unit_price"]})
    if not changes:
        return None
    return {
        "notification_kind": "pharmacy_item_change",
        "admin_order_id": int(order["id"]),
        "order_id": order.get("public_id") or order_id,
        "order_reference": order.get("order_reference"),
        "pharmacy_id": pharmacy_id,
        "event_key": f"order:{int(order['id'])}:pharmacy-change:{current_request_id}",
        "changes": changes,
    }


def _reprice_items_from_base(
    cur: Any, order_db_id: int, order_id: str, pharmacy_id: int, changes: list[dict[str, Any]],
    current_request_id: str,
) -> list[dict[str, Any]]:
    """A pharmacy set its own (base) price for an item while answering «В наличии» (rework 1: «Ватан 2»;
    job 013: «Ватан 1» too, through this same path). Returns the audited changes.

    The pharmacy's price is an input only. The client price is recomputed in SQL with the stored
    pricing rule (vatan_selling_unit_price, as at checkout), then the line and the order totals are
    recomputed the same way as the admin base-price edit. One audit row; no client data.
    """
    audited = []
    for change in changes:
        cur.execute("""UPDATE order_items
                       SET base_unit_price = %s,
                           selling_unit_price = vatan_selling_unit_price(%s),
                           line_total = ROUND(vatan_selling_unit_price(%s) * quantity, 2)
                       WHERE id = %s AND order_id = %s
                       RETURNING selling_unit_price, line_total""",
                    (change["new_base_unit_price"], change["new_base_unit_price"], change["new_base_unit_price"],
                     change["order_item_id"], order_db_id))
        saved = cur.fetchone() or {}
        audited.append({
            "order_item_id": change["order_item_id"],
            "previous_base_unit_price": (None if change["previous_base_unit_price"] is None
                                         else str(change["previous_base_unit_price"])),
            "new_base_unit_price": str(change["new_base_unit_price"]),
            "new_selling_unit_price": None if saved.get("selling_unit_price") is None else str(saved["selling_unit_price"]),
        })
    cur.execute("""UPDATE orders SET items_subtotal = totals.subtotal, order_total = totals.subtotal,
                                     total_price = totals.subtotal
                   FROM (SELECT COALESCE(SUM(line_total), 0) AS subtotal
                         FROM order_items WHERE order_id = %s) totals
                   WHERE orders.id = %s""",
                (order_db_id, order_db_id))
    _write_admin_audit(cur, actor_id=f"staff:{pharmacy_id}", action="pharmacy.order.item_price_changed",
                       resource_type="order", resource_id=order_id, request=current_request_id,
                       details={"pharmacy_id": pharmacy_id, "items": audited})
    return audited


def _sync_item_assembly(cur: Any, order_db_id: int, pharmacy_id: int) -> None:
    """Per-item «Собрано» (rework 1) drives the pharmacy's part mark: once at least one item is collected
    the part is «Собирается»; when every item it did not answer «Нет в наличии» is collected it becomes
    «Собран». Forward only: an «assembled» part never goes back. One statement, no reads."""
    cur.execute(f"""INSERT INTO order_pharmacy_assembly (order_id, pharmacy_id, state, assembled_at, updated_by)
                    SELECT %s, %s,
                           CASE WHEN progress.open_count = 0 THEN 'assembled' ELSE 'assembling' END,
                           CASE WHEN progress.open_count = 0 THEN now() END, %s
                    FROM (SELECT COUNT(*) FILTER (WHERE col.order_item_id IS NOT NULL) AS collected_count,
                                 COUNT(*) FILTER (WHERE col.order_item_id IS NULL
                                                    AND mine.answer IS DISTINCT FROM 'unavailable') AS open_count
                          FROM order_items oi
                          JOIN orders o ON o.id = oi.order_id
                          LEFT JOIN order_item_pharmacy_answers mine
                                 ON mine.order_item_id = oi.id AND mine.pharmacy_id = %s
                          LEFT JOIN order_item_assembly col
                                 ON col.order_item_id = oi.id AND col.pharmacy_id = %s
                          WHERE oi.order_id = %s AND {_ITEM_PHARMACY_SQL} = %s) progress
                    WHERE progress.collected_count > 0
                    ON CONFLICT (order_id, pharmacy_id) DO UPDATE
                    SET state = EXCLUDED.state, assembled_at = EXCLUDED.assembled_at,
                        updated_by = EXCLUDED.updated_by
                    WHERE order_pharmacy_assembly.state = 'assembling' AND EXCLUDED.state = 'assembled'""",
                (order_db_id, pharmacy_id, f"staff:{pharmacy_id}", pharmacy_id, pharmacy_id, order_db_id, pharmacy_id))


# Assembly pharmacies of one order (website orders): distinct effective pharmacies of the items their
# current pharmacy did not answer «Нет в наличии», with that pharmacy's part mark. Same rule as the
# courier projection (_COURIER_ORDER_SELECT).
_ORDER_ASSEMBLY_PARTS_SQL = f"""
    SELECT parts.pharmacy_id, asm.state
    FROM (SELECT DISTINCT {_ITEM_PHARMACY_SQL} AS pharmacy_id
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          LEFT JOIN order_item_pharmacy_answers cur
                 ON cur.order_item_id = oi.id AND cur.pharmacy_id = {_ITEM_PHARMACY_SQL}
          WHERE oi.order_id = %s AND cur.answer IS DISTINCT FROM 'unavailable') parts
    LEFT JOIN order_pharmacy_assembly asm ON asm.order_id = %s AND asm.pharmacy_id = parts.pharmacy_id
    ORDER BY parts.pharmacy_id"""

ASSEMBLY_NOT_COMPLETE_MESSAGE = "Сначала все аптеки должны отметить «Сборка сделана»"


def _require_assembly_complete(cur: Any, order_db_id: int) -> None:
    """Rework 1: the courier's «Согласовано» (pending -> confirmed) waits until every pharmacy that holds
    collectable items marked its part «Собран». Orders with nothing to assemble are not blocked."""
    cur.execute(_ORDER_ASSEMBLY_PARTS_SQL, (order_db_id, order_db_id))
    waiting = [int(row["pharmacy_id"]) for row in cur.fetchall() if row.get("state") != "assembled"]
    if waiting:
        raise ContractError("ASSEMBLY_NOT_COMPLETE", ASSEMBLY_NOT_COMPLETE_MESSAGE, http_status=409)


def validate_item_collect_request(payload: Any) -> int:
    """Body is exactly {"order_item_id": <positive int>}."""
    if (not isinstance(payload, dict) or set(payload) != {"order_item_id"}
            or type(payload["order_item_id"]) is not int or not 0 < payload["order_item_id"] <= _ORDER_ITEM_ID_MAX):
        raise ContractError("VALIDATION_ERROR", "Укажите позицию заказа")
    return payload["order_item_id"]


def collect_pharmacy_order_item(
    order_id: str, payload: Any, pharmacy_id: int, current_request_id: str,
) -> dict[str, Any]:
    """«Собрано» for one item of this pharmacy (rework 1; used by «Ватан 2» for routed items).

    The item must be effectively assigned to the session pharmacy and answered «В наличии» by it.
    Repeating is a no-op. The pharmacy's part mark follows the items (_sync_item_assembly).
    orders.status and order_status_history are never touched.
    """
    if pharmacy_id not in (1, 2):
        raise ContractError("FORBIDDEN", "Доступ только для аптеки", http_status=403)
    order_item_id = validate_item_collect_request(payload)
    lookup, lookup_values = _order_lookup(order_id)
    actor = f"staff:{pharmacy_id}"
    with transaction() as cur:
        cur.execute(f"""SELECT id, status, created_by_staff_account_id, fulfillment_pharmacy_id
                        FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order or order["created_by_staff_account_id"] is not None:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        cur.execute(f"""SELECT oi.id, {_ITEM_PHARMACY_SQL} AS pharmacy_id, mine.answer,
                               col.order_item_id IS NOT NULL AS collected
                        FROM order_items oi
                        JOIN orders o ON o.id = oi.order_id
                        LEFT JOIN order_item_pharmacy_answers mine
                               ON mine.order_item_id = oi.id AND mine.pharmacy_id = %s
                        LEFT JOIN order_item_assembly col
                               ON col.order_item_id = oi.id AND col.pharmacy_id = %s
                        WHERE oi.order_id = %s AND oi.id = %s FOR UPDATE OF oi""",
                    (pharmacy_id, pharmacy_id, order["id"], order_item_id))
        item = cur.fetchone()
        if not item:
            raise ContractError("ORDER_ITEM_NOT_FOUND", "Позиция не найдена в заказе", http_status=404)
        if int(item["pharmacy_id"]) != pharmacy_id:
            raise ContractError("FORBIDDEN", "Эта позиция у другой аптеки", http_status=403)
        if order["status"] not in ASSEMBLY_ORDER_STATUSES:
            raise ContractError("ORDER_STATUS_CONFLICT", "Сборка доступна только для нового или согласованного заказа",
                                http_status=409)
        if not item["collected"]:
            if item["answer"] != "available":
                raise ContractError("ITEM_NOT_AVAILABLE", "Сначала отметьте «В наличии»", http_status=409)
            cur.execute("""INSERT INTO order_item_assembly (order_item_id, pharmacy_id, collected_by)
                           VALUES (%s, %s, %s) ON CONFLICT (order_item_id, pharmacy_id) DO NOTHING""",
                        (order_item_id, pharmacy_id, actor))
            _sync_item_assembly(cur, order["id"], pharmacy_id)
            _write_admin_audit(cur, actor_id=actor, action="pharmacy.order.item_collected",
                               resource_type="order", resource_id=order_id, request=current_request_id,
                               details={"pharmacy_id": pharmacy_id, "order_item_id": order_item_id})
        cur.execute("""SELECT state FROM order_pharmacy_assembly WHERE order_id = %s AND pharmacy_id = %s""",
                    (order["id"], pharmacy_id))
        part = cur.fetchone()
    return {"order_id": order_id, "order_item_id": order_item_id, "pharmacy_id": pharmacy_id, "collected": True,
            "assembly_state": part["state"] if part and part.get("state") in ASSEMBLY_STATES else None}


def validate_assembly_request(payload: Any) -> str:
    """Body is exactly {"state": "assembling" | "assembled"}; no pharmacy id, no other keys."""
    if (not isinstance(payload, dict) or set(payload) != {"state"}
            or not isinstance(payload["state"], str) or payload["state"] not in ASSEMBLY_STATES):
        raise ContractError("VALIDATION_ERROR", "Укажите отметку сборки")
    return payload["state"]


def _assembly_projection(order_id: str, pharmacy_id: int, row: Any) -> dict[str, Any]:
    return {
        "order_id": order_id,
        "pharmacy_id": pharmacy_id,
        "state": row["state"] if row else None,
        "started_at": order_time_iso(row["started_at"]) if row and row.get("started_at") else None,
        "assembled_at": order_time_iso(row["assembled_at"]) if row and row.get("assembled_at") else None,
    }


def mark_pharmacy_assembly(order_id: str, payload: Any, pharmacy_id: int, current_request_id: str) -> dict[str, Any]:
    """«Собран» for this pharmacy's part of a website order (job 011, rework 1, job 015).

    Allowed while the order is «Новый» (assembly happens before the courier's call) or already confirmed.
    pharmacy_id comes from the HMAC staff session only. The pharmacy must hold at least one item it did
    not answer «Нет в наличии». Transitions are forward only (none -> assembling -> assembled, and since
    job 015 none -> assembled); repeating the current state is a no-op (no writes, no audit, no
    notification). «Собран» on a «Новый» order records «В наличии» for this pharmacy's still unanswered
    items (not marked = available), so the courier gets a confirmed sum. When this «Собран» completes the
    order's assembly (every assembly pharmacy is «Собран», computed in the same transaction) the result
    carries `_notification` (owner/courier Telegram «Заказ собран», no client data); the Next.js route
    strips it. orders.status and order_status_history are never touched.
    """
    if pharmacy_id not in (1, 2):
        raise ContractError("FORBIDDEN", "Доступ только для аптеки", http_status=403)
    target = validate_assembly_request(payload)
    lookup, lookup_values = _order_lookup(order_id)
    actor = f"staff:{pharmacy_id}"
    with transaction() as cur:
        cur.execute(f"""SELECT id, public_id, order_reference, status, order_total, created_by_staff_account_id,
                               fulfillment_pharmacy_id
                        FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order or order["created_by_staff_account_id"] is not None:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        cur.execute(f"""SELECT COUNT(*) AS assigned_count,
                               COUNT(*) FILTER (WHERE mine.answer IS DISTINCT FROM 'unavailable')
                                   AS assemblable_count
                        FROM order_items oi
                        JOIN orders o ON o.id = oi.order_id
                        LEFT JOIN order_item_pharmacy_answers mine
                               ON mine.order_item_id = oi.id AND mine.pharmacy_id = %s
                        WHERE oi.order_id = %s AND {_ITEM_PHARMACY_SQL} = %s""",
                    (pharmacy_id, order["id"], pharmacy_id))
        counts = cur.fetchone() or {}
        if not int(counts.get("assigned_count") or 0):
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        if order["status"] not in ASSEMBLY_ORDER_STATUSES:
            raise ContractError("ORDER_STATUS_CONFLICT", "Сборка доступна только для нового или согласованного заказа",
                                http_status=409)
        if not int(counts.get("assemblable_count") or 0):
            raise ContractError("NOTHING_TO_ASSEMBLE", "Нечего собирать", http_status=409)
        cur.execute("""SELECT state, started_at, assembled_at FROM order_pharmacy_assembly
                       WHERE order_id = %s AND pharmacy_id = %s FOR UPDATE""",
                    (order["id"], pharmacy_id))
        current = cur.fetchone()
        current_state = current["state"] if current else None
        if current_state == target:
            return _assembly_projection(order_id, pharmacy_id, current)
        if (current_state, target) not in _ASSEMBLY_TRANSITIONS:
            raise ContractError("ASSEMBLY_STATE_CONFLICT", ASSEMBLY_ALREADY_DONE_MESSAGE, http_status=409)
        cur.execute("""INSERT INTO order_pharmacy_assembly
                           (order_id, pharmacy_id, state, assembled_at, updated_by)
                       VALUES (%s, %s, %s, CASE WHEN %s = 'assembled' THEN now() END, %s)
                       ON CONFLICT (order_id, pharmacy_id) DO UPDATE
                       SET state = EXCLUDED.state, assembled_at = EXCLUDED.assembled_at,
                           updated_by = EXCLUDED.updated_by
                       RETURNING state, started_at, assembled_at""",
                    (order["id"], pharmacy_id, target, target, actor))
        saved = cur.fetchone()
        details: dict[str, Any] = {"pharmacy_id": pharmacy_id, "from_state": current_state, "to_state": target}
        if target == "assembled" and order["status"] == "pending":
            cur.execute(f"""INSERT INTO order_item_pharmacy_answers (order_item_id, pharmacy_id, answer, answered_by)
                            SELECT oi.id, %s, 'available', %s
                            FROM order_items oi
                            JOIN orders o ON o.id = oi.order_id
                            LEFT JOIN order_item_pharmacy_answers mine
                                   ON mine.order_item_id = oi.id AND mine.pharmacy_id = %s
                            WHERE oi.order_id = %s AND {_ITEM_PHARMACY_SQL} = %s AND mine.answer IS NULL
                            ON CONFLICT (order_item_id, pharmacy_id) DO NOTHING
                            RETURNING order_item_id""",
                        (pharmacy_id, actor, pharmacy_id, order["id"], pharmacy_id))
            answered = sorted(int(row["order_item_id"]) for row in cur.fetchall())
            if answered:
                details["answered_available"] = answered
        _write_admin_audit(cur, actor_id=actor, action="pharmacy.order.assembly_marked",
                           resource_type="order", resource_id=order_id, request=current_request_id,
                           details=details)
        notification = (_order_assembled_notification(cur, order, order_id, pharmacy_id, current_request_id)
                        if target == "assembled" else None)
    result = _assembly_projection(order_id, pharmacy_id, saved)
    if notification:
        result["_notification"] = notification
    return result


def _order_assembled_notification(
    cur: Any, order: Any, order_id: str, pharmacy_id: int, current_request_id: str,
) -> dict[str, Any] | None:
    """Job 015: the owner/courier Telegram payload «Заказ собран» when this «Собран» completed the whole
    order's assembly (every assembly pharmacy is «Собран»; same rule as _require_assembly_complete), read
    in the marking transaction. Per pharmacy: the medicines (name and quantity) lying there; `missing` are
    the items their current pharmacy answered «Нет в наличии» (at «Ватан 2»: missing in both). Never the
    client name, phone, address, landmark or comment. None while another pharmacy still has to assemble."""
    cur.execute(_ORDER_ASSEMBLY_PARTS_SQL, (order["id"], order["id"]))
    parts = [dict(row) for row in cur.fetchall()]
    if not parts or any(row.get("state") != "assembled" for row in parts):
        return None
    cur.execute(f"""SELECT oi.id, {_ITEM_PHARMACY_SQL} AS pharmacy_id, oi.medicine_name, oi.quantity,
                           cur.answer
                    FROM order_items oi
                    JOIN orders o ON o.id = oi.order_id
                    LEFT JOIN order_item_pharmacy_answers cur
                           ON cur.order_item_id = oi.id AND cur.pharmacy_id = {_ITEM_PHARMACY_SQL}
                    WHERE oi.order_id = %s ORDER BY oi.id""", (order["id"],))
    by_pharmacy: dict[int, list[dict[str, Any]]] = {int(row["pharmacy_id"]): [] for row in parts}
    missing: list[dict[str, Any]] = []
    for item in cur.fetchall():
        entry = {"medicine_name": item.get("medicine_name"), "quantity": _decimal_text(item.get("quantity"))}
        if item.get("answer") == "unavailable":
            missing.append(entry)
        else:
            by_pharmacy.setdefault(int(item["pharmacy_id"]), []).append(entry)
    return {
        "notification_kind": "pharmacy_order_assembled",
        "admin_order_id": int(order["id"]),
        "order_id": order.get("public_id") or order_id,
        "order_reference": order.get("order_reference"),
        "pharmacy_id": pharmacy_id,
        "event_key": f"order:{int(order['id'])}:assembled:{current_request_id}",
        "parts": [{"pharmacy_id": key, "items": items} for key, items in sorted(by_pharmacy.items()) if items],
        "missing": missing,
        "client_total": _decimal_text(order.get("order_total")),
    }


def courier_earnings(query: dict[str, Any]) -> dict[str, Any]:
    """Courier earnings from delivered orders, grouped by Dushanbe calendar day."""
    if set(query) - {"limit", "cursor"}:
        raise ContractError("VALIDATION_ERROR", "Unknown earnings filter")
    limit = min(_limit(query), 60)
    cursor_date = None
    raw_cursor = query.get("cursor")
    if raw_cursor:
        try:
            cursor_date = datetime.strptime(str(raw_cursor), "%Y-%m-%d").date()
        except (TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "cursor is invalid") from exc
    with transaction() as cur:
        cur.execute(
            """
            WITH earned AS (
                SELECT o.delivery_courier_amount,
                       COALESCE(
                           (SELECT MAX(h.created_at) FROM order_status_history h
                            WHERE h.order_id = o.id AND h.to_status = 'delivered'),
                           o.delivery_updated_at,
                           CASE WHEN pg_typeof(o.created_at) = 'timestamp without time zone'::regtype
                                THEN o.created_at::timestamp AT TIME ZONE 'UTC'
                                ELSE o.created_at::timestamptz END
                       ) AS earned_at
                FROM orders o
                WHERE o.deleted_at IS NULL AND o.status = 'delivered'
            ), today AS (
                SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Dushanbe')::date AS day
            )
            SELECT COALESCE(SUM(delivery_courier_amount), 0) AS total,
                   COALESCE(SUM(delivery_courier_amount) FILTER (
                       WHERE (earned_at AT TIME ZONE 'Asia/Dushanbe')::date = today.day), 0) AS today,
                   COALESCE(SUM(delivery_courier_amount) FILTER (
                       WHERE (earned_at AT TIME ZONE 'Asia/Dushanbe')::date = today.day - 1), 0) AS yesterday
            FROM earned CROSS JOIN today
            """
        )
        totals = dict(cur.fetchone())
        params: list[Any] = []
        cursor_clause = ""
        if cursor_date:
            cursor_clause = "WHERE earned_day < %s"
            params.append(cursor_date)
        params.append(limit + 1)
        cur.execute(
            f"""
            WITH earned AS (
                SELECT (COALESCE(
                           (SELECT MAX(h.created_at) FROM order_status_history h
                            WHERE h.order_id = o.id AND h.to_status = 'delivered'),
                           o.delivery_updated_at,
                           CASE WHEN pg_typeof(o.created_at) = 'timestamp without time zone'::regtype
                                THEN o.created_at::timestamp AT TIME ZONE 'UTC'
                                ELSE o.created_at::timestamptz END
                       ) AT TIME ZONE 'Asia/Dushanbe')::date AS earned_day,
                       o.delivery_courier_amount, o.created_by_staff_account_id
                FROM orders o
                WHERE o.deleted_at IS NULL AND o.status = 'delivered'
            )
            SELECT earned_day AS date, COUNT(*) AS orders_count,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id = 3) AS courier_orders_count,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id IS NULL) AS website_orders_count,
                   COALESCE(SUM(delivery_courier_amount), 0) AS amount
            FROM earned
            {cursor_clause}
            GROUP BY earned_day
            ORDER BY earned_day DESC
            LIMIT %s
            """,
            tuple(params),
        )
        rows = [dict(row) for row in cur.fetchall()]
    has_more = len(rows) > limit
    rows = rows[:limit]
    return {
        "total": totals["total"], "today": totals["today"], "yesterday": totals["yesterday"],
        "daily": rows, "currency": "TJS",
        "page": {"next_cursor": rows[-1]["date"].isoformat() if has_more and rows else None,
                 "has_more": has_more},
    }


def update_medicine_image(
    medicine_id: int, payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    if set(payload) != {"image_url"}:
        raise ContractError("VALIDATION_ERROR", "image_url is required")
    image_url = _image_url(payload.get("image_url"))
    with transaction() as cur:
        cur.execute(
            """UPDATE medicines
               SET image_url = %s, updated_at = CURRENT_TIMESTAMP
               WHERE id = %s
               RETURNING id AS medicine_id, name AS medicine_name, image_url, updated_at""",
            (image_url, medicine_id),
        )
        row = cur.fetchone()
        if not row:
            raise ContractError("MEDICINE_NOT_FOUND", "Medicine was not found", http_status=404)
        _write_admin_audit(
            cur, actor_id=actor_id, action="medicine.image.updated",
            resource_type="medicine", resource_id=str(medicine_id), request=current_request_id,
            details={"has_image": image_url is not None},
        )
    return dict(row)


def update_courier_order_status(order_id: str, payload: dict[str, Any], current_request_id: str) -> dict[str, Any]:
    if set(payload) - {"status", "expected_current_status", "reason"} or not {
        "status", "expected_current_status"
    } <= set(payload):
        raise ContractError("VALIDATION_ERROR", "Invalid status update request")
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(f"""SELECT id, status, created_by_staff_account_id FROM orders
                        WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Order was not found", http_status=404)
        if order["status"] != payload["expected_current_status"]:
            raise ContractError("ORDER_STATUS_CONFLICT", "Order status changed", http_status=409)
        current, new, reason = validate_status_transition(
            order["status"], payload["status"], reason=payload.get("reason")
        )
        if current == "pending" and new == "confirmed" and order.get("created_by_staff_account_id") is None:
            # Rework 1: «Согласовано» waits for «Сборка сделана» from every pharmacy holding items.
            _require_assembly_complete(cur, order["id"])
        cur.execute("UPDATE orders SET status = %s WHERE id = %s", (new, order["id"]))
        cur.execute("""INSERT INTO order_status_history
            (order_id, from_status, to_status, actor_type, actor_id, reason)
            VALUES (%s, %s, %s, 'staff', 'courier:3', %s) RETURNING created_at""",
            (order["id"], current, new, reason))
        changed_at = cur.fetchone()["created_at"]
        _write_admin_audit(cur, actor_id="staff:3", action="courier.order.status_changed",
                           resource_type="order", resource_id=order_id, request=current_request_id,
                           details={"from_status": current, "to_status": new})
    return {"order_id": order_id, "status": new, "changed_at": changed_at}


def update_courier_order_checklist(order_id: str, payload: dict[str, Any], current_request_id: str) -> dict[str, Any]:
    """Courier ticks or unticks a manual checklist step in a website order. Idempotent."""
    if not isinstance(payload, dict) or set(payload) != {"step", "done"}:
        raise ContractError("VALIDATION_ERROR", "Укажите шаг и отметку")
    step, done = payload["step"], payload["done"]
    if isinstance(step, bool) or not isinstance(step, int) or not 1 <= step <= 7:
        raise ContractError("VALIDATION_ERROR", "Шаг должен быть числом от 1 до 7")
    if step == 3:
        raise ContractError("VALIDATION_ERROR", "Этот шаг отмечается ответом аптеки")
    if step not in COURIER_CHECKLIST_MANUAL_STEPS:
        raise ContractError("VALIDATION_ERROR", "Этот шаг отмечается сменой статуса заказа")
    if not isinstance(done, bool):
        raise ContractError("VALIDATION_ERROR", "Отметка должна быть true или false")
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(f"""SELECT id, status, created_by_staff_account_id
                        FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        if order["status"] == "cancelled":
            raise ContractError("ORDER_STATUS_CONFLICT", "Заказ отменён", http_status=409)
        if order["created_by_staff_account_id"] is not None:
            raise ContractError("CHECKLIST_NOT_AVAILABLE", "Чек-лист есть только у заказов с сайта", http_status=409)
        if done:
            # A legacy row under the same number is converted to v2; a repeated v2 tick is a no-op.
            cur.execute("""INSERT INTO order_courier_checklist (order_id, step, completed_by)
                           VALUES (%s, %s, %s)
                           ON CONFLICT (order_id, step) DO UPDATE
                           SET completed_by = EXCLUDED.completed_by, completed_at = now()
                           WHERE order_courier_checklist.completed_by <> EXCLUDED.completed_by
                           RETURNING step""",
                        (order["id"], step, COURIER_CHECKLIST_MARKER))
        elif step == 2:
            # New step 2 is also read from a legacy step-4 row; remove it so the untick sticks.
            cur.execute("""DELETE FROM order_courier_checklist
                           WHERE order_id = %s AND (step = %s OR (step = 4 AND completed_by <> %s))
                           RETURNING step""",
                        (order["id"], step, COURIER_CHECKLIST_MARKER))
        else:
            cur.execute("DELETE FROM order_courier_checklist WHERE order_id = %s AND step = %s RETURNING step",
                        (order["id"], step))
        changed = cur.fetchone() is not None
        if changed:
            _write_admin_audit(cur, actor_id="staff:3", action="courier.order.checklist_updated",
                               resource_type="order", resource_id=order_id, request=current_request_id,
                               details={"step": step, "done": done})
        cur.execute(f"""SELECT COALESCE({_COURIER_CHECKLIST_AGG_SQL}, ARRAY[]::integer[]) AS steps
                        FROM order_courier_checklist c WHERE c.order_id = %s""", (order["id"],))
        row = cur.fetchone()
    return {"order_id": order_id, "checklist_steps": _checklist_steps(row["steps"] if row else [])}


def list_orders(query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    clauses: list[str] = ["o.deleted_at IS NULL"]
    params: list[Any] = []
    status = query.get("status")
    if status:
        if status == "active":
            clauses.append("o.status IN ('pending', 'confirmed', 'delivering')")
        elif status not in STATUS_TRANSITIONS:
            raise ContractError("VALIDATION_ERROR", "status is invalid")
        else:
            clauses.append("o.status = %s")
            params.append(status)
    search = str(query.get("q") or "").strip()
    if search:
        if len(search) > 120:
            raise ContractError("VALIDATION_ERROR", "q is too long")
        pattern = f"%{search}%"
        search_clauses = [
            "COALESCE(o.order_reference, '') ILIKE %s",
            "COALESCE(o.public_id, '') ILIKE %s",
            "o.phone ILIKE %s",
            "o.customer_name ILIKE %s",
        ]
        search_params: list[Any] = [pattern, pattern, pattern, pattern]
        if search.isdigit():
            search_clauses.append("o.id = %s")
            search_params.append(int(search))
        clauses.append(f"({' OR '.join(search_clauses)})")
        params.extend(search_params)
    for key, operator in (("created_from", ">="), ("created_to", "<=")):
        raw = query.get(key)
        if raw:
            try:
                parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            except ValueError as exc:
                raise ContractError("VALIDATION_ERROR", f"{key} must be ISO 8601") from exc
            clauses.append(f"o.created_at {operator} %s")
            params.append(parsed)
    cursor = _decode_cursor(query.get("cursor"))
    if cursor:
        try:
            clauses.append("(o.created_at, o.id) < (%s, %s)")
            params.extend([datetime.fromisoformat(cursor["created_at"]), int(cursor["id"])])
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "cursor is invalid") from exc
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit + 1)
    with transaction() as cur:
        cur.execute(
            f"""
            SELECT o.id, o.public_id, o.order_reference, o.customer_name, o.phone,
                   o.address, o.items_subtotal, o.order_total, o.currency, o.status,
                   o.payment_method, o.payment_status, o.notes, o.created_at,
                   o.order_source, o.landmark, o.created_by_staff_account_id,
                   o.fulfillment_pharmacy_id,
                   o.delivery_courier_amount, o.delivery_owner_amount,
                   o.delivery_courier_amount + o.delivery_owner_amount AS delivery_fee,
                   o.source_collection, o.utm_source, o.utm_medium, o.utm_campaign, o.utm_content,
                   sa.username AS created_by_staff_username,
                   {assembled_sql("o")} AS stage_assembled
            FROM orders o
            LEFT JOIN staff_accounts sa ON sa.account_id = o.created_by_staff_account_id
            {where}
            ORDER BY o.created_at DESC, o.id DESC
            LIMIT %s
            """,
            tuple(params),
        )
        rows = [dict(row) for row in cur.fetchall()]
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor({"created_at": last["created_at"].isoformat(), "id": last["id"]})
    for row in rows:
        row["order_id"] = row.pop("public_id") or f"legacy_{row['id']}"
        row.pop("id")
        row["created_at"] = order_time_iso(row["created_at"])
        row["stage"] = order_stage(row["status"], row.pop("stage_assembled", False))
    return {"data": rows, "page": {"next_cursor": next_cursor, "has_more": has_more}}


DELIVERED_DAY_CTE = """
    WITH delivery_history AS (
        SELECT h.order_id, MAX(h.created_at) AS delivered_at
        FROM order_status_history h
        JOIN orders existing ON existing.id = h.order_id
        WHERE h.to_status = 'delivered' AND existing.status = 'delivered'
          AND existing.deleted_at IS NULL
        GROUP BY h.order_id
    ), eligible AS (
        SELECT o.id, o.public_id, o.order_reference, o.customer_name, o.phone,
               o.address, o.order_total, o.currency, o.created_at, o.order_source,
               o.created_by_staff_account_id, o.fulfillment_pharmacy_id,
               o.delivery_courier_amount, o.delivery_owner_amount,
               COALESCE(h.delivered_at,
                   CASE WHEN pg_typeof(o.created_at) = 'timestamp without time zone'::regtype
                        THEN o.created_at::timestamp AT TIME ZONE 'UTC'
                        ELSE o.created_at::timestamptz END) AS delivered_at
        FROM orders o
        LEFT JOIN delivery_history h ON h.order_id = o.id
        WHERE o.status = 'delivered' AND o.deleted_at IS NULL
    )
"""


_ORDER_CREATED_TZ = """CASE WHEN pg_typeof(o.created_at) = 'timestamp without time zone'::regtype
                          THEN o.created_at::timestamp AT TIME ZONE 'UTC'
                          ELSE o.created_at::timestamptz END"""


# Shared by orders_insights and orders_insights_drilldown so every overview card and
# its drill-down list use one definition. Change them here, never in a copy.
_INSIGHTS_PERIODS = {1, 7, 30, 90}

# Per delivered order: sales = item line totals (or order_total without items),
# base = pharmacy price x quantity with a missing pharmacy price counted as 0.
_ITEM_TOTALS_JOIN = """LEFT JOIN LATERAL (
                SELECT SUM(oi.line_total) AS sales, SUM(COALESCE(oi.base_unit_price, 0) * oi.quantity) AS base
                FROM order_items oi WHERE oi.order_id = e.id
            ) items ON true"""
_ITEM_SALES = "COALESCE(items.sales, e.order_total, 0)"
_ITEM_BASE = "COALESCE(items.base, 0)"

# «Заказали» / «Отменено»: orders created in the period (Dushanbe days), by status.
_ORDERED_STATUS = "o.status <> 'cancelled'"
_CANCELLED_STATUS = "o.status = 'cancelled'"
_CREATED_IN_PERIOD = f"o.deleted_at IS NULL AND {_ORDER_CREATED_TZ} >= %s"

# «Клиенты»: phones with a non-cancelled order created in the period, with the
# time of each phone's first ever order. One %s parameter: the period start.
_CLIENTS_PERIOD_CTE = f"""WITH period AS (
                            SELECT DISTINCT o.phone_normalized FROM orders o
                            WHERE o.deleted_at IS NULL AND o.status <> 'cancelled' AND o.phone_normalized IS NOT NULL
                              AND {_ORDER_CREATED_TZ} >= %s
                        ), first_seen AS (
                            SELECT o.phone_normalized, MIN({_ORDER_CREATED_TZ}) AS first_at
                            FROM orders o JOIN period p ON p.phone_normalized = o.phone_normalized
                            WHERE o.deleted_at IS NULL GROUP BY o.phone_normalized
                        )"""
_CLIENTS_SUMMARY_SELECT = """
                        SELECT COUNT(*) FILTER (WHERE first_at >= %s) AS new_clients,
                               COUNT(*) FILTER (WHERE first_at < %s) AS returning_clients
                        FROM first_seen"""


def _insights_period(query: dict[str, Any], allowed: set[str]) -> tuple[int, date, date, datetime]:
    """Validate keys and `days`; return (days, first_day, today, since) in Dushanbe days."""
    if set(query) - allowed:
        raise ContractError("VALIDATION_ERROR", "Неизвестный параметр")
    try:
        days = int(query.get("days") or 7)
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "days must be 1, 7, 30 or 90") from exc
    if days not in _INSIGHTS_PERIODS:
        raise ContractError("VALIDATION_ERROR", "days must be 1, 7, 30 or 90")
    zone = ZoneInfo("Asia/Dushanbe")
    today = datetime.now(zone).date()
    first_day = today - timedelta(days=days - 1)
    since = datetime.combine(first_day, time.min, tzinfo=zone)
    return days, first_day, today, since


def orders_insights(query: dict[str, Any]) -> dict[str, Any]:
    """Everything the admin orders overview needs in one call, in Dushanbe calendar days."""
    days, first_day, today, since = _insights_period(query, {"days"})
    with transaction() as cur:
        cur.execute("""SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                              COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
                              COUNT(*) FILTER (WHERE status = 'delivering') AS delivering
                       FROM orders WHERE deleted_at IS NULL""")
        live = {key: int(value or 0) for key, value in dict(cur.fetchone()).items()}
        cur.execute(f"""SELECT o.id, o.public_id, o.order_reference, o.customer_name, o.phone, o.address,
                               o.order_total, o.created_by_staff_account_id, o.fulfillment_pharmacy_id,
                               o.order_source, {_ORDER_CREATED_TZ} AS created_at
                        FROM orders o WHERE o.deleted_at IS NULL AND o.status = 'pending'
                        ORDER BY o.created_at DESC, o.id DESC LIMIT 12""")
        new_orders = [dict(row) for row in cur.fetchall()]
        cur.execute(f"""SELECT COUNT(*) FILTER (WHERE {_ORDERED_STATUS}) AS ordered_count,
                               COALESCE(SUM(o.order_total) FILTER (WHERE {_ORDERED_STATUS}), 0) AS ordered_sum,
                               COUNT(*) FILTER (WHERE {_ORDERED_STATUS} AND o.created_by_staff_account_id IS NULL)
                                   AS website_ordered_count,
                               COUNT(*) FILTER (WHERE {_CANCELLED_STATUS}) AS cancelled_count
                        FROM orders o WHERE {_CREATED_IN_PERIOD}""", (since,))
        ordered = dict(cur.fetchone())
        cur.execute(DELIVERED_DAY_CTE + f"""
            , delivered AS (
                SELECT e.id, e.created_by_staff_account_id, e.delivery_courier_amount, e.delivery_owner_amount,
                       (e.delivered_at AT TIME ZONE 'Asia/Dushanbe')::date AS day,
                       {_ITEM_SALES} AS sales, {_ITEM_BASE} AS base
                FROM eligible e
                {_ITEM_TOTALS_JOIN}
                WHERE e.delivered_at >= %s
            )
            SELECT day,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id IS NULL) AS website_orders,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id = 3) AS courier_orders,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id IN (1, 2)) AS pharmacy_orders,
                   COALESCE(SUM(sales) FILTER (WHERE created_by_staff_account_id IS NULL), 0) AS website_sales,
                   COALESCE(SUM(sales) FILTER (WHERE created_by_staff_account_id = 3), 0) AS courier_sales,
                   COALESCE(SUM(sales) FILTER (WHERE created_by_staff_account_id IN (1, 2)), 0) AS pharmacy_sales,
                   COALESCE(SUM(sales - base), 0) AS profit,
                   COALESCE(SUM(delivery_courier_amount), 0) AS courier_fee,
                   COALESCE(SUM(delivery_owner_amount), 0) AS owner_fee,
                   COUNT(*) FILTER (WHERE delivery_owner_amount > 0 AND delivery_courier_amount = 0) AS owner_delivered
            FROM delivered GROUP BY day ORDER BY day
        """, (since,))
        by_day = {row["day"]: dict(row) for row in cur.fetchall()}
        cur.execute(DELIVERED_DAY_CTE + """
            SELECT oi.medicine_name, SUM(oi.quantity) AS quantity, COALESCE(SUM(oi.line_total), 0) AS sales,
                   COUNT(DISTINCT oi.order_id) AS orders
            FROM eligible e JOIN order_items oi ON oi.order_id = e.id
            WHERE e.delivered_at >= %s
            GROUP BY oi.medicine_name ORDER BY sales DESC, orders DESC LIMIT 10
        """, (since,))
        top_medicines = [dict(row) for row in cur.fetchall()]
        cur.execute(f"""SELECT EXTRACT(HOUR FROM ({_ORDER_CREATED_TZ}) AT TIME ZONE 'Asia/Dushanbe')::int AS hour,
                               COUNT(*) AS orders
                        FROM orders o WHERE o.deleted_at IS NULL AND o.status <> 'cancelled'
                          AND {_ORDER_CREATED_TZ} >= %s
                        GROUP BY 1""", (since,))
        hours = {int(row["hour"]): int(row["orders"]) for row in cur.fetchall()}
        cur.execute(_CLIENTS_PERIOD_CTE + _CLIENTS_SUMMARY_SELECT, (since, since, since))
        clients = {key: int(value or 0) for key, value in dict(cur.fetchone()).items()}
        cur.execute(DELIVERED_DAY_CTE + f"""
            SELECT e.id, e.public_id, e.order_reference, e.customer_name, e.delivered_at,
                   e.created_by_staff_account_id, e.delivery_courier_amount, e.delivery_owner_amount,
                   {_ITEM_SALES} AS sales, {_ITEM_BASE} AS base
            FROM eligible e
            {_ITEM_TOTALS_JOIN}
            WHERE e.delivered_at >= %s
            ORDER BY e.delivered_at DESC, e.id DESC LIMIT 200
        """, (since,))
        delivered_orders = [dict(row) for row in cur.fetchall()]
    for row in delivered_orders:
        internal_id = row.pop("id")
        row["order_id"] = row.pop("public_id") or f"legacy_{internal_id}"
        row["delivered_at"] = order_time_iso(row["delivered_at"])
        row["profit"] = row["sales"] - row["base"]
        row["owner_total"] = row["profit"] + row["delivery_owner_amount"]
    daily = []
    for offset in range(days):
        day = first_day + timedelta(days=offset)
        row = by_day.get(day, {})
        daily.append({
            "date": day.isoformat(),
            **{key: int(row.get(key) or 0) for key in ("website_orders", "courier_orders", "pharmacy_orders", "owner_delivered")},
            **{key: row.get(key) or Decimal("0") for key in
               ("website_sales", "courier_sales", "pharmacy_sales", "profit", "courier_fee", "owner_fee")},
        })
    delivered_count = sum(d["website_orders"] + d["courier_orders"] + d["pharmacy_orders"] for d in daily)
    delivered_sum = sum((d["website_sales"] + d["courier_sales"] + d["pharmacy_sales"] for d in daily), Decimal("0"))
    for row in new_orders:
        internal_id = row.pop("id")
        row["order_id"] = row.pop("public_id") or f"legacy_{internal_id}"
        row["created_at"] = order_time_iso(row["created_at"])
    return {
        "period_days": days, "from": first_day.isoformat(), "to": today.isoformat(), "currency": "TJS",
        "live": {**live, "new_orders": new_orders},
        "totals": {
            "ordered_count": int(ordered["ordered_count"] or 0), "ordered_sum": ordered["ordered_sum"],
            "website_ordered_count": int(ordered["website_ordered_count"] or 0),
            "cancelled_count": int(ordered["cancelled_count"] or 0),
            "delivered_count": delivered_count, "delivered_sum": delivered_sum,
            "average_check": (delivered_sum / delivered_count).quantize(Decimal("0.01")) if delivered_count else Decimal("0"),
            "profit": sum((d["profit"] for d in daily), Decimal("0")),
            "courier_fee": sum((d["courier_fee"] for d in daily), Decimal("0")),
            "owner_fee": sum((d["owner_fee"] for d in daily), Decimal("0")),
            "owner_delivered": sum(d["owner_delivered"] for d in daily),
        },
        "daily": daily,
        "top_medicines": top_medicines,
        "hours": [{"hour": hour, "orders": hours.get(hour, 0)} for hour in range(24)],
        "clients": clients,
        "delivered_orders": delivered_orders,
    }

_DRILL_ORDER_METRICS = {"ordered", "cancelled", "delivered", "average_check", "profit"}
_DRILL_DELIVERED_METRICS = {"delivered", "average_check", "profit"}
_DRILL_METRICS = _DRILL_ORDER_METRICS | {"clients"}
_DRILL_DEFAULT_LIMIT = 50

# Each metric selects one fixed SQL fragment; request values never reach the SQL text.
_DRILL_CREATED_ROWS = {
    "ordered": f"""
        WITH drill AS (
            SELECT o.id, o.public_id, o.order_reference, o.customer_name, o.status,
                   {_ORDER_CREATED_TZ} AS created_at, NULL::timestamptz AS delivered_at,
                   o.created_by_staff_account_id, o.order_total,
                   o.delivery_courier_amount, o.delivery_owner_amount
            FROM orders o WHERE {_ORDERED_STATUS} AND {_CREATED_IN_PERIOD}
        )""",
    "cancelled": f"""
        WITH drill AS (
            SELECT o.id, o.public_id, o.order_reference, o.customer_name, o.status,
                   {_ORDER_CREATED_TZ} AS created_at, NULL::timestamptz AS delivered_at,
                   o.created_by_staff_account_id, o.order_total,
                   o.delivery_courier_amount, o.delivery_owner_amount
            FROM orders o WHERE {_CANCELLED_STATUS} AND {_CREATED_IN_PERIOD}
        )""",
}
_DRILL_DELIVERED_ROWS = DELIVERED_DAY_CTE + """
        , drill AS (
            SELECT e.id, e.public_id, e.order_reference, e.customer_name, 'delivered'::text AS status,
                   CASE WHEN pg_typeof(e.created_at) = 'timestamp without time zone'::regtype
                        THEN e.created_at::timestamp AT TIME ZONE 'UTC'
                        ELSE e.created_at::timestamptz END AS created_at,
                   e.delivered_at, e.created_by_staff_account_id, e.order_total,
                   e.delivery_courier_amount, e.delivery_owner_amount
            FROM eligible e WHERE e.delivered_at >= %s
        )"""
# Same sales/base formulas as orders_insights, applied to whichever row set was chosen.
_DRILL_PRICED = f"""
        , priced AS (
            SELECT e.*, {_ITEM_SALES} AS sales, {_ITEM_BASE} AS base,
                   {_ITEM_SALES} - {_ITEM_BASE} AS profit
            FROM drill e
            {_ITEM_TOTALS_JOIN}
        )"""
# metric -> (column summed for `summary.sum`, ORDER BY, keyset predicate, cursor keys)
_DRILL_ORDERING = {
    "ordered": ("order_total", "created_at DESC, id DESC", "(created_at, id) < (%s, %s)", ("created_at", "id")),
    "cancelled": ("order_total", "created_at DESC, id DESC", "(created_at, id) < (%s, %s)", ("created_at", "id")),
    "delivered": ("sales", "delivered_at DESC, id DESC", "(delivered_at, id) < (%s, %s)", ("delivered_at", "id")),
    "average_check": ("sales", "delivered_at DESC, id DESC", "(delivered_at, id) < (%s, %s)", ("delivered_at", "id")),
    "profit": ("sales", "profit ASC, id ASC", "(profit, id) > (%s, %s)", ("profit", "id")),
}
_DRILL_SUMMARY_COLUMNS = {
    "order_total": "COALESCE(SUM(order_total), 0)",
    "sales": "COALESCE(SUM(sales), 0)",
}
# One row per client phone. The tiebreaker is the internal id of the client's first
# order, so phone numbers never end up in a cursor (and so in URLs or access logs).
_DRILL_CLIENT_ROWS = _CLIENTS_PERIOD_CTE + f"""
                        , clients AS (
                            SELECT f.first_at, first_order.id AS first_order_id, latest.customer_name, latest.phone,
                                   (SELECT COUNT(*) FROM orders o
                                    WHERE o.phone_normalized = f.phone_normalized AND {_ORDERED_STATUS}
                                      AND {_CREATED_IN_PERIOD}) AS orders_in_period
                            FROM first_seen f
                            LEFT JOIN LATERAL (
                                SELECT o.id FROM orders o
                                WHERE o.phone_normalized = f.phone_normalized AND o.deleted_at IS NULL
                                ORDER BY {_ORDER_CREATED_TZ}, o.id LIMIT 1
                            ) first_order ON true
                            LEFT JOIN LATERAL (
                                SELECT o.customer_name, o.phone FROM orders o
                                WHERE o.phone_normalized = f.phone_normalized AND o.deleted_at IS NULL
                                ORDER BY {_ORDER_CREATED_TZ} DESC, o.id DESC LIMIT 1
                            ) latest ON true
                        )"""


def _drill_cursor(raw: Any, metric: str, since: datetime) -> tuple[Any, int] | None:
    """Decode and strictly validate a drill-down keyset cursor for this metric."""
    cursor = _decode_cursor(raw)
    if cursor is None:
        return None
    key = "first_order_at" if metric == "clients" else _DRILL_ORDERING[metric][3][0]
    try:
        if set(cursor) != {key, "id"} or type(cursor["id"]) is not int or cursor["id"] <= 0:
            raise ValueError()
        value = cursor[key]
        if not isinstance(value, str) or len(value) > 64:
            raise ValueError()
        if key == "profit":
            parsed: Any = Decimal(value)
            if not parsed.is_finite():
                raise ValueError()
        else:
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is None:
                raise ValueError()
            if key != "first_order_at" and parsed < since:
                raise ValueError()
    except (TypeError, ValueError, ArithmeticError) as exc:
        raise ContractError("VALIDATION_ERROR", "cursor is invalid") from exc
    return parsed, cursor["id"]


def orders_insights_drilldown(query: dict[str, Any]) -> dict[str, Any]:
    """The orders (or clients) behind one overview card, for the same period as orders_insights."""
    days, first_day, today, since = _insights_period(query, {"days", "metric", "cursor", "limit"})
    metric = query.get("metric")
    if metric not in _DRILL_METRICS:
        raise ContractError("VALIDATION_ERROR", "metric is invalid")
    try:
        limit = int(query.get("limit") or _DRILL_DEFAULT_LIMIT)
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "limit must be an integer") from exc
    if not 1 <= limit <= MAX_LIMIT:
        raise ContractError("VALIDATION_ERROR", f"limit must be between 1 and {MAX_LIMIT}")
    cursor = _drill_cursor(query.get("cursor"), metric, since)
    document: dict[str, Any] = {
        "metric": metric, "period_days": days, "from": first_day.isoformat(), "to": today.isoformat(),
        "currency": "TJS",
    }

    if metric == "clients":
        page_clause = "WHERE (first_at, first_order_id) < (%s, %s)" if cursor else ""
        with transaction() as cur:
            cur.execute(_CLIENTS_PERIOD_CTE + _CLIENTS_SUMMARY_SELECT, (since, since, since))
            summary = {key: int(value or 0) for key, value in dict(cur.fetchone()).items()}
            cur.execute(_DRILL_CLIENT_ROWS + f"""
                        SELECT first_at, first_order_id, customer_name, phone, orders_in_period
                        FROM clients {page_clause}
                        ORDER BY first_at DESC, first_order_id DESC LIMIT %s""",
                        (since, since, *(cursor or ()), limit + 1))
            rows = [dict(row) for row in cur.fetchall()]
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = None
        if has_more and rows:
            last = rows[-1]
            next_cursor = _encode_cursor({"first_order_at": last["first_at"].isoformat(), "id": last["first_order_id"]})
        data = [{
            "customer_name": row["customer_name"], "phone": row["phone"],
            "orders_in_period": int(row["orders_in_period"] or 0),
            "first_order_at": order_time_iso(row["first_at"]), "is_new": row["first_at"] >= since,
        } for row in rows]
        return {**document, "summary": summary, "data": data,
                "page": {"next_cursor": next_cursor, "has_more": has_more}}

    sum_column, order_by, keyset, cursor_keys = _DRILL_ORDERING[metric]
    delivered = metric in _DRILL_DELIVERED_METRICS
    rows_sql = (_DRILL_DELIVERED_ROWS if delivered else _DRILL_CREATED_ROWS[metric]) + _DRILL_PRICED
    page_clause = f"WHERE {keyset}" if cursor else ""
    with transaction() as cur:
        cur.execute(rows_sql + f"""
            SELECT COUNT(*) AS count, {_DRILL_SUMMARY_COLUMNS[sum_column]} AS sum,
                   COALESCE(SUM(profit), 0) AS profit
            FROM priced""", (since,))
        totals = dict(cur.fetchone())
        cur.execute(rows_sql + f"""
            SELECT * FROM priced {page_clause}
            ORDER BY {order_by} LIMIT %s""", (since, *(cursor or ()), limit + 1))
        rows = [dict(row) for row in cur.fetchall()]
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        position = last[cursor_keys[0]]
        next_cursor = _encode_cursor({
            cursor_keys[0]: str(position) if cursor_keys[0] == "profit" else position.isoformat(),
            "id": last["id"],
        })
    data = []
    for row in rows:
        internal_id = row["id"]
        item = {
            "order_id": row["public_id"] or f"legacy_{internal_id}",
            "order_reference": row["order_reference"], "customer_name": row["customer_name"],
            "status": row["status"], "created_at": order_time_iso(row["created_at"]),
            "created_by_staff_account_id": row["created_by_staff_account_id"],
            "order_total": row["order_total"], "sales": row["sales"], "base": row["base"],
            "profit": row["sales"] - row["base"],
            "delivery_courier_amount": row["delivery_courier_amount"],
            "delivery_owner_amount": row["delivery_owner_amount"],
        }
        if delivered:
            item["delivered_at"] = order_time_iso(row["delivered_at"])
        data.append(item)
    summary = {"count": int(totals["count"] or 0), "sum": totals["sum"], "profit": totals["profit"]}
    return {**document, "summary": summary, "data": data,
            "page": {"next_cursor": next_cursor, "has_more": has_more}}



def delivered_orders_by_day(query: dict[str, Any]) -> dict[str, Any]:
    """One Dushanbe calendar day, counted independently of the paginated list."""
    if set(query) - {"date", "limit", "cursor"}:
        raise ContractError("VALIDATION_ERROR", "Неизвестный параметр фильтра")
    raw_date = query.get("date")
    if raw_date is None:
        selected = datetime.now(ZoneInfo("Asia/Dushanbe")).date()
    elif isinstance(raw_date, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date):
        try:
            selected = date.fromisoformat(raw_date)
        except ValueError as exc:
            raise ContractError("VALIDATION_ERROR", "Неверная дата") from exc
    else:
        raise ContractError("VALIDATION_ERROR", "Неверная дата")
    if not 2020 <= selected.year <= 2100:
        raise ContractError("VALIDATION_ERROR", "Дата вне допустимого диапазона")
    start = datetime.combine(selected, time.min, tzinfo=ZoneInfo("Asia/Dushanbe"))
    end = start + timedelta(days=1)
    limit = min(_limit(query), 50)
    cursor = _decode_cursor(query.get("cursor"))
    page_clause = ""
    page_params: list[Any] = [start, end]
    if cursor:
        try:
            if set(cursor) != {"delivered_at", "id"} or type(cursor["id"]) is not int or cursor["id"] <= 0:
                raise ValueError()
            cursor_time = datetime.fromisoformat(cursor["delivered_at"])
            if cursor_time.tzinfo is None or not start <= cursor_time < end:
                raise ValueError()
        except (TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "Неверная страница") from exc
        page_clause = "AND (e.delivered_at, e.id) < (%s, %s)"
        page_params.extend([cursor_time, cursor["id"]])
    page_params.append(limit + 1)
    with transaction() as cur:
        cur.execute(DELIVERED_DAY_CTE + """
            SELECT COUNT(*) AS total,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id IS NULL) AS website,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id = 3) AS courier,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id IN (1, 2)) AS pharmacy,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id = 3 AND order_source = 'whatsapp') AS whatsapp,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id = 3 AND order_source = 'instagram') AS instagram,
                   COUNT(*) FILTER (WHERE created_by_staff_account_id = 3 AND order_source = 'phone') AS phone,
                   COUNT(*) FILTER (WHERE delivery_owner_amount > 0 AND delivery_courier_amount = 0) AS owner_delivered,
                   COALESCE(SUM(order_total), 0) AS total_sales,
                   COALESCE(SUM(order_total) FILTER (WHERE created_by_staff_account_id IS NULL), 0) AS website_sales,
                   COALESCE(SUM(order_total) FILTER (WHERE created_by_staff_account_id = 3), 0) AS courier_sales,
                   COALESCE(SUM(order_total) FILTER (WHERE created_by_staff_account_id IN (1, 2)), 0) AS pharmacy_sales,
                   COALESCE(SUM(delivery_courier_amount), 0) AS courier_fee,
                   COALESCE(SUM(delivery_owner_amount), 0) AS owner_fee
            FROM eligible WHERE delivered_at >= %s AND delivered_at < %s
        """, (start, end))
        summary = {key: value if key.endswith(("_sales", "_fee")) else int(value or 0)
                   for key, value in dict(cur.fetchone()).items()}
        cur.execute(DELIVERED_DAY_CTE + f"""
            SELECT e.*, sa.username AS created_by_staff_username
            FROM eligible e
            LEFT JOIN staff_accounts sa ON sa.account_id = e.created_by_staff_account_id
            WHERE e.delivered_at >= %s AND e.delivered_at < %s
            {page_clause}
            ORDER BY e.delivered_at DESC, e.id DESC LIMIT %s
        """, tuple(page_params))
        rows = [dict(row) for row in cur.fetchall()]
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor({"delivered_at": last["delivered_at"].isoformat(), "id": last["id"]})
    for row in rows:
        internal_id = row.pop("id")
        row["order_id"] = row.pop("public_id") or f"legacy_{internal_id}"
        row["created_at"] = order_time_iso(row["created_at"])
    return {"date": selected.isoformat(), "time_zone": "Asia/Dushanbe", "summary": summary,
            "data": rows, "page": {"next_cursor": next_cursor, "has_more": has_more}}


def get_order(order_id: str) -> dict[str, Any]:
    lookup, lookup_values = _order_lookup(order_id)
    qualified_lookup = "o.id = %s AND o.public_id IS NULL" if order_id.startswith("legacy_") else "o.public_id = %s"
    with transaction() as cur:
        cur.execute(
            f"""
            SELECT o.id, o.public_id, o.order_reference, o.customer_name, o.phone, o.address,
                   o.items_subtotal, o.order_total, o.currency, o.status, o.payment_method, o.edit_revision,
                   o.payment_status, o.notes, o.created_at, o.order_source, o.landmark,
                   o.created_by_staff_account_id, o.fulfillment_pharmacy_id,
                   o.delivery_courier_amount, o.delivery_owner_amount,
                   o.delivery_courier_amount + o.delivery_owner_amount AS delivery_fee,
                   o.source_collection, o.utm_source, o.utm_medium, o.utm_campaign, o.utm_content,
                   sa.username AS created_by_staff_username
            FROM orders o
            LEFT JOIN staff_accounts sa ON sa.account_id = o.created_by_staff_account_id
            WHERE {qualified_lookup} AND o.deleted_at IS NULL
            """,
            lookup_values,
        )
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Order was not found", http_status=404)
        internal_id = order["id"]
        cur.execute(
            """
            SELECT id AS order_item_id, medicine_id, medicine_name, base_unit_price, selling_unit_price,
                   quantity, line_total
            FROM order_items WHERE order_id = %s ORDER BY id ASC
            """,
            (internal_id,),
        )
        items = [dict(row) for row in cur.fetchall()]
        cur.execute(
            """
            SELECT id, from_status, to_status, actor_type, actor_id, reason, created_at
            FROM order_status_history WHERE order_id = %s ORDER BY id ASC
            """,
            (internal_id,),
        )
        history_rows = [dict(row) for row in cur.fetchall()]
        fulfillment_row = None
        if order["created_by_staff_account_id"] is None:
            # Job 013: one more read, the courier projection of this website order (checklist, answers,
            # assembly marks). Staff-created orders have no pharmacy answers or marks.
            cur.execute(f"{_COURIER_ORDER_SELECT} WHERE o.id = %s", (internal_id,))
            fulfillment_row = cur.fetchone()
        public_order_id = order["public_id"] or f"legacy_{internal_id}"
        audit_rows, audit_truncated = _order_audit_rows(
            cur, order, public_order_id, [str(item["order_item_id"]) for item in items])
    result = dict(order)
    result["order_id"] = public_order_id
    result.pop("public_id")
    result.pop("id")
    result["items"] = items
    result["status_history"] = [{key: value for key, value in row.items() if key != "id"} for row in history_rows]
    # Job 016: full history for the admin; whitelisted event keys only (shared.order_timeline).
    result["timeline"], result["timeline_truncated"] = build_timeline(
        created_at=order["created_at"], creator=creator_actor(order["created_by_staff_account_id"]),
        status_rows=history_rows, audit_rows=audit_rows,
        item_names={int(item["order_item_id"]): str(item["medicine_name"]) for item in items},
        source_truncated=audit_truncated,
    )
    result["created_at"] = order_time_iso(result["created_at"])
    result["fulfillment"] = _admin_fulfillment(fulfillment_row) if fulfillment_row else None
    result["stage"] = (result["fulfillment"]["stage"] if result["fulfillment"]
                       else order_stage(result["status"], False))
    return result


_AUDIT_TIMELINE_COLUMNS = "id, actor_id, action, resource_type, resource_id, details, created_at"


def _order_audit_rows(
    cur: Any, order: Any, public_order_id: str, item_ids: list[str],
) -> tuple[list[dict[str, Any]], bool]:
    """Job 016: audit rows of one order for the admin timeline, two bounded reads (newest first).

    1. The order itself and its current items (index admin_audit_log_resource_created).
    2. Items removed since: matched by the order id/reference stored in `details`, restricted to
       `order_item` rows written after the order was created. Not indexed; LIMIT keeps it bounded.
    """
    limit = TIMELINE_LIMIT + 1
    cur.execute(
        f"""SELECT {_AUDIT_TIMELINE_COLUMNS} FROM admin_audit_log
            WHERE (resource_type = 'order' AND resource_id = %s)
               OR (resource_type = 'order_item' AND resource_id = ANY(%s::text[]))
            ORDER BY created_at DESC, id DESC LIMIT %s""",
        (public_order_id, item_ids, limit),
    )
    current = [dict(row) for row in cur.fetchall()]
    reference = str(order.get("order_reference") or order.get("public_id") or order["id"])
    cur.execute(
        f"""SELECT {_AUDIT_TIMELINE_COLUMNS} FROM admin_audit_log
            WHERE resource_type = 'order_item' AND created_at >= %s
              AND NOT (resource_id = ANY(%s::text[]))
              AND (details->>'order_id' = %s OR details->>'order_reference' = %s
                   OR details->>'reference' = %s)
            ORDER BY created_at DESC, id DESC LIMIT %s""",
        (order["created_at"], item_ids, public_order_id, reference, reference, limit),
    )
    removed = [dict(row) for row in cur.fetchall()]
    return current + removed, len(current) >= limit or len(removed) >= limit


def _admin_fulfillment(row: Any) -> dict[str, Any]:
    """Read-only courier/pharmacy progress for the admin order card (job 013): the courier checklist,
    each pharmacy's answers and assembly marks, and the pharmacy-confirmed sum. No client data."""
    projected = _courier_order_row(dict(row))
    medicines = projected.get("medicines")
    if isinstance(medicines, str):
        medicines = json.loads(medicines)
    return {
        "stage": projected["stage"],
        "checklist_steps": projected["checklist_steps"],
        "assembly": projected["assembly"],
        "assembly_complete": projected["assembly_complete"],
        "pharmacy_answers_complete": projected["pharmacy_answers_complete"],
        "confirmed_total": projected["confirmed_total"],
        "unavailable_count": projected["unavailable_count"],
        "answered_count": projected["answered_count"],
        "item_count": projected["item_count"],
        "items": [{"order_item_id": int(item["order_item_id"]), "medicine_name": item.get("medicine_name"),
                   "pharmacy_id": int(item["pharmacy_id"]) if item.get("pharmacy_id") is not None else None,
                   "answers": item.get("answers") or []}
                  for item in (medicines or []) if isinstance(item, dict)],
    }


def _admin_edit_text(value: Any, field: str, minimum: int, maximum: int, *, nullable: bool = False) -> str | None:
    if nullable and (value is None or value == ""):
        return None
    if not isinstance(value, str):
        raise ContractError("VALIDATION_ERROR", f"{field} must be a string")
    normalized = value.strip()
    if not minimum <= len(normalized) <= maximum or "\x00" in normalized:
        raise ContractError("VALIDATION_ERROR", f"{field} has an invalid length")
    return normalized


def update_order_customer(order_id: str, payload: dict[str, Any], actor_id: str, current_request_id: str) -> dict[str, Any]:
    """Admin-only customer-data edit; deliberately excludes all time/status fields."""
    allowed = {"customer_name", "phone", "address", "landmark", "comment", "expected_revision"}
    if set(payload) != allowed or isinstance(payload.get("expected_revision"), bool):
        raise ContractError("VALIDATION_ERROR", "Invalid order edit request")
    try:
        revision = int(payload["expected_revision"])
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "expected_revision must be a positive integer") from exc
    if revision < 1:
        raise ContractError("VALIDATION_ERROR", "expected_revision must be a positive integer")
    customer_name = _admin_edit_text(payload["customer_name"], "customer_name", 2, 120)
    phone = normalize_phone(payload["phone"])
    address = _admin_edit_text(payload["address"], "address", 3, 500)
    landmark = _admin_edit_text(payload["landmark"], "landmark", 2, 300, nullable=True)
    comment = _admin_edit_text(payload["comment"], "comment", 1, 500, nullable=True)
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(f"""SELECT id, customer_name, phone, address, landmark, notes, edit_revision
                         FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Order was not found", http_status=404)
        if order["edit_revision"] != revision:
            raise ContractError("ORDER_EDIT_CONFLICT", "Заказ уже изменён. Обновите страницу.", http_status=409)
        cur.execute("""UPDATE orders SET customer_name=%s, phone=%s, phone_normalized=%s, address=%s,
                       landmark=%s, notes=%s, edit_revision=edit_revision + 1 WHERE id=%s
                       RETURNING edit_revision""", (customer_name, phone, phone, address, landmark, comment, order["id"]))
        new_revision = cur.fetchone()["edit_revision"]
        _write_admin_audit(cur, actor_id=actor_id, action="order.customer_updated", resource_type="order",
            resource_id=order_id, request=current_request_id,
            details={"previous": {"customer_name": order["customer_name"], "phone": order["phone"], "address": order["address"], "landmark": order["landmark"], "comment": order["notes"]},
                "current": {"customer_name": customer_name, "phone": phone, "address": address, "landmark": landmark, "comment": comment}, "revision": new_revision})
    return {"order_id": order_id, "edit_revision": new_revision}


def _courier_text(value: Any, label: str, minimum: int, maximum: int) -> str:
    if not isinstance(value, str):
        raise ContractError("VALIDATION_ERROR", f"Укажите {label}")
    text = " ".join(value.split())
    if not minimum <= len(text) <= maximum or "\x00" in text:
        raise ContractError("VALIDATION_ERROR",
                            f"Поле «{label}»: от {minimum} до {maximum} символов" if minimum else
                            f"Поле «{label}»: не длиннее {maximum} символов")
    return text


def update_courier_order_customer(order_id: str, payload: dict[str, Any], current_request_id: str) -> dict[str, Any]:
    """Courier fixes typos in an order they entered; allowed in every status, never in website orders."""
    fields = {"customer_name", "phone", "address", "landmark"}
    if not isinstance(payload, dict) or set(payload) != fields:
        raise ContractError("VALIDATION_ERROR", "Укажите имя, телефон, адрес и ориентир")
    customer_name = _courier_text(payload["customer_name"], "имя", 0, 120)
    try:
        phone = normalize_phone(payload["phone"])
    except ContractError as exc:
        raise ContractError("VALIDATION_ERROR", "Телефон должен содержать 9 цифр после +992") from exc
    address = _courier_text(payload["address"], "адрес", 3, 500)
    landmark = _courier_text(payload["landmark"], "ориентир", 2, 300)
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(f"""SELECT id, customer_name, phone, address, landmark, created_by_staff_account_id
                        FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        _require_courier_own_order(order)
        # Bumping edit_revision makes an admin form opened earlier refuse to overwrite this change.
        cur.execute("""UPDATE orders SET customer_name = %s, phone = %s, phone_normalized = %s,
                       address = %s, landmark = %s, edit_revision = edit_revision + 1 WHERE id = %s""",
                    (customer_name, phone, phone, address, landmark, order["id"]))
        previous = {key: order[key] for key in ("customer_name", "phone", "address", "landmark")}
        current = {"customer_name": customer_name, "phone": phone, "address": address, "landmark": landmark}
        _write_admin_audit(cur, actor_id="staff:3", action="courier.order.customer_updated",
                           resource_type="order", resource_id=order_id, request=current_request_id,
                           details={"previous": previous, "current": current})
    return {"order_id": order_id, **current}


def update_courier_order_item(
    order_id: str, order_item_id: int, payload: dict[str, Any] | None, current_request_id: str,
) -> dict[str, Any]:
    """Courier changes quantity/client price of one line, or removes it (payload None)."""
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    if payload is not None:
        if (not isinstance(payload, dict) or not payload
                or set(payload) - {"quantity", "unit_price"}):
            raise ContractError("VALIDATION_ERROR", "Укажите количество или цену")
        if "quantity" in payload:
            try:
                quantity = validate_order_quantity(payload["quantity"])
            except ContractError as exc:
                raise ContractError("VALIDATION_ERROR", "Количество: от 0,1 до 99, до двух знаков после запятой") from exc
        if "unit_price" in payload:
            unit_price = validate_unit_price(payload["unit_price"])
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(f"""SELECT id, status, items_subtotal, created_by_staff_account_id FROM orders
                        WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values)
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        if order["status"] == "cancelled":
            raise ContractError("ORDER_STATUS_CONFLICT", "Отменённый заказ нельзя изменить", http_status=409)
        _require_courier_own_order(order)
        cur.execute("""SELECT id, medicine_id, medicine_name, quantity, selling_unit_price, price
                       FROM order_items WHERE id = %s AND order_id = %s FOR UPDATE""",
                    (order_item_id, order["id"]))
        item = cur.fetchone()
        if not item:
            raise ContractError("ORDER_ITEM_NOT_FOUND", "Товар уже удалён из заказа", http_status=404)
        previous_price = Decimal(str(item["selling_unit_price"] if item["selling_unit_price"] is not None else item["price"]))
        if payload is None:
            cur.execute("DELETE FROM order_items WHERE id = %s AND order_id = %s", (item["id"], order["id"]))
        else:
            new_quantity = quantity if quantity is not None else Decimal(str(item["quantity"]))
            new_price = unit_price if unit_price is not None else previous_price
            cur.execute("""UPDATE order_items SET quantity = %s, selling_unit_price = %s, price = %s, line_total = %s
                           WHERE id = %s AND order_id = %s""",
                        (new_quantity, new_price, new_price, (new_quantity * new_price).quantize(Decimal("0.01")),
                         item["id"], order["id"]))
        cur.execute("SELECT COALESCE(SUM(line_total), 0) AS total FROM order_items WHERE order_id = %s", (order["id"],))
        total = cur.fetchone()["total"]
        if total > Decimal("99999999.99"):
            raise ContractError("VALIDATION_ERROR", "Сумма заказа слишком велика")
        cur.execute("UPDATE orders SET items_subtotal = %s, order_total = %s, total_price = %s WHERE id = %s",
                    (total, total, total, order["id"]))
        _write_admin_audit(
            cur, actor_id="staff:3",
            action="courier.order.item_removed" if payload is None else "courier.order.item_updated",
            resource_type="order_item", resource_id=str(item["id"]), request=current_request_id,
            details={"order_id": order_id, "medicine_id": item["medicine_id"], "medicine_name": item["medicine_name"],
                     "status": order["status"], "previous_quantity": str(item["quantity"]),
                     "previous_price": str(previous_price), "new_quantity": None if quantity is None else str(quantity),
                     "new_price": None if unit_price is None else str(unit_price),
                     "previous_subtotal": str(order["items_subtotal"]), "new_subtotal": str(total)},
        )
    return {"order_id": order_id, "order_item_id": item["id"], "removed": payload is None,
            "order_total": str(total), "currency": "TJS"}


def update_order_status(order_id: str, payload: dict[str, Any], actor_id: str) -> dict[str, Any]:
    allowed = {"status", "expected_current_status", "reason"}
    if set(payload) - allowed or not {"status", "expected_current_status"} <= set(payload):
        raise ContractError("VALIDATION_ERROR", "Invalid status update request")
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(f"SELECT id, status FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE", lookup_values)
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Order was not found", http_status=404)
        if order["status"] != payload["expected_current_status"]:
            raise ContractError("ORDER_STATUS_CONFLICT", "Order status changed", http_status=409)
        current, new, reason = validate_status_transition(
            order["status"], payload["status"], reason=payload.get("reason")
        )
        cur.execute("UPDATE orders SET status = %s WHERE id = %s", (new, order["id"]))
        cur.execute(
            """
            INSERT INTO order_status_history
                (order_id, from_status, to_status, actor_type, actor_id, reason)
            VALUES (%s, %s, %s, 'admin', %s, %s)
            RETURNING created_at
            """,
            (order["id"], current, new, actor_id, reason),
        )
        changed_at = cur.fetchone()["created_at"]
    return {"order_id": order_id, "status": new, "changed_at": changed_at}


def update_order_item_price(
    order_id: str,
    payload: dict[str, Any],
    actor_id: str,
    current_request_id: str,
) -> dict[str, Any]:
    price_keys = {"selling_unit_price", "base_unit_price"}
    if "order_item_id" not in payload or not set(payload) & price_keys or set(payload) - price_keys - {"order_item_id"}:
        raise ContractError("VALIDATION_ERROR", "order_item_id and a price are required")
    raw_item_id = payload.get("order_item_id")
    if isinstance(raw_item_id, bool):
        raise ContractError("VALIDATION_ERROR", "order_item_id must be an integer")
    try:
        order_item_id = int(raw_item_id)
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "order_item_id must be an integer") from exc
    if order_item_id <= 0:
        raise ContractError("VALIDATION_ERROR", "order_item_id must be a positive integer")

    def parse_price(field: str) -> Decimal:
        raw = payload.get(field)
        if isinstance(raw, bool):
            raise ContractError("VALIDATION_ERROR", f"{field} must be a positive number")
        try:
            value = Decimal(str(raw)).quantize(Decimal("0.01"))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", f"{field} must be a positive number") from exc
        if not value.is_finite() or value <= 0 or value > Decimal("10000000"):
            raise ContractError("VALIDATION_ERROR", f"{field} must be between 0.01 and 10000000")
        return value

    new_selling = parse_price("selling_unit_price") if "selling_unit_price" in payload else None
    new_base = parse_price("base_unit_price") if "base_unit_price" in payload else None

    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(
            f"""
            SELECT id, COALESCE(order_reference, public_id, id::text) AS reference
            FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE
            """,
            lookup_values,
        )
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Order was not found", http_status=404)
        cur.execute(
            """
            SELECT id, medicine_name, selling_unit_price, base_unit_price, quantity
            FROM order_items WHERE id = %s AND order_id = %s FOR UPDATE
            """,
            (order_item_id, order["id"]),
        )
        item = cur.fetchone()
        if not item:
            raise ContractError("ORDER_ITEM_NOT_FOUND", "Order item was not found", http_status=404)
        new_price = new_selling if new_selling is not None else item["selling_unit_price"]
        base_price = new_base if new_base is not None else item["base_unit_price"]
        line_total = (Decimal(str(new_price)) * item["quantity"]).quantize(Decimal("0.01"))
        cur.execute(
            "UPDATE order_items SET selling_unit_price = %s, base_unit_price = %s, line_total = %s WHERE id = %s",
            (new_price, base_price, line_total, item["id"]),
        )
        previous_base = item["base_unit_price"]
        if new_base is not None and (previous_base is None or Decimal(str(previous_base)) != new_base):
            _invalidate_pharmacy_answers(cur, order["id"], [item["id"]])
        cur.execute(
            "SELECT COALESCE(SUM(line_total), 0) AS items_subtotal FROM order_items WHERE order_id = %s",
            (order["id"],),
        )
        items_subtotal = cur.fetchone()["items_subtotal"]
        cur.execute(
            "UPDATE orders SET items_subtotal = %s, order_total = %s, total_price = %s WHERE id = %s",
            (items_subtotal, items_subtotal, items_subtotal, order["id"]),
        )
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="order.item_price_updated",
            resource_type="order_item",
            resource_id=str(order_item_id),
            request=current_request_id,
            details={
                "reference": str(order["reference"]),
                "medicine_name": str(item["medicine_name"]),
                "previous_unit_price": str(item["selling_unit_price"]),
                "new_unit_price": str(new_price),
                "previous_base_unit_price": str(item["base_unit_price"]),
                "new_base_unit_price": str(base_price),
                "quantity": str(item["quantity"]),
                "line_total": str(line_total),
                "order_total": str(items_subtotal),
            },
        )
    return {
        "order_id": order_id, "order_item_id": order_item_id,
        "selling_unit_price": new_price, "base_unit_price": base_price, "line_total": line_total,
        "items_subtotal": items_subtotal, "order_total": items_subtotal, "currency": "TJS",
    }


def adjust_admin_order_item(
    order_id: str, payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    """Set an exact quantity or remove one order line, including delivered/cancelled orders."""
    if (not isinstance(payload, dict) or set(payload) != {"order_item_id", "expected_quantity", "quantity"}
            or type(payload["order_item_id"]) is not int or payload["order_item_id"] <= 0):
        raise ContractError("VALIDATION_ERROR", "Проверьте позицию и количество")
    try:
        expected_quantity = validate_order_quantity(payload["expected_quantity"])
        quantity = Decimal("0") if str(payload["quantity"]) in {"0", "0.0", "0.00"} else validate_order_quantity(payload["quantity"])
    except ContractError as exc:
        raise ContractError("VALIDATION_ERROR", "Проверьте позицию и количество") from exc
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(
            f"""SELECT id, status, items_subtotal, COALESCE(order_reference, public_id, id::text) AS reference
                FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""", lookup_values,
        )
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        cur.execute(
            """SELECT id, medicine_id, medicine_name, quantity, selling_unit_price, price
               FROM order_items WHERE id = %s AND order_id = %s FOR UPDATE""",
            (payload["order_item_id"], order["id"]),
        )
        item = cur.fetchone()
        if not item:
            raise ContractError("ORDER_ITEM_NOT_FOUND", "Позиция не найдена", http_status=404)
        if Decimal(str(item["quantity"])) != expected_quantity:
            raise ContractError("ORDER_ITEM_CONFLICT", "Количество уже изменилось. Обновите заказ.", http_status=409)
        if quantity == 0:
            cur.execute("DELETE FROM order_items WHERE id = %s AND order_id = %s", (item["id"], order["id"]))
        else:
            cur.execute(
                """UPDATE order_items SET quantity = %s,
                   line_total = %s * COALESCE(selling_unit_price, price)
                   WHERE id = %s AND order_id = %s""",
                (quantity, quantity, item["id"], order["id"]),
            )
            if quantity != expected_quantity:
                _invalidate_pharmacy_answers(cur, order["id"], [item["id"]])
        cur.execute("SELECT COALESCE(SUM(line_total), 0) AS total FROM order_items WHERE order_id = %s", (order["id"],))
        total = cur.fetchone()["total"]
        if total > Decimal("99999999.99"):
            raise ContractError("VALIDATION_ERROR", "Сумма заказа слишком велика")
        cur.execute("UPDATE orders SET items_subtotal = %s, order_total = %s, total_price = %s WHERE id = %s",
                    (total, total, total, order["id"]))
        _write_admin_audit(
            cur, actor_id=actor_id, action="order.item_removed" if quantity == 0 else "order.item_quantity_set",
            resource_type="order_item", resource_id=str(item["id"]), request=current_request_id,
            details={"order_reference": str(order["reference"]), "medicine_id": item["medicine_id"],
                     "medicine_name": item["medicine_name"], "status": order["status"],
                     "previous_quantity": str(item["quantity"]), "new_quantity": str(quantity),
                     "previous_subtotal": str(order["items_subtotal"]), "new_subtotal": str(total)},
        )
    return {"order_id": order_id, "order_item_id": item["id"], "quantity": str(quantity),
            "removed": quantity == 0, "items_subtotal": total, "order_total": total, "currency": "TJS"}


def _delivery_amount(payload: dict[str, Any], field: str) -> Decimal:
    raw = payload.get(field)
    if isinstance(raw, bool):
        raise ContractError("VALIDATION_ERROR", f"{field} must be a non-negative number")
    try:
        value = Decimal(str(raw)).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", f"{field} must be a non-negative number") from exc
    if not value.is_finite() or value < 0 or value > Decimal("1000000"):
        raise ContractError("VALIDATION_ERROR", f"{field} must be between 0 and 1000000")
    return value


def update_order_delivery(
    order_id: str,
    payload: dict[str, Any],
    actor_id: str,
    current_request_id: str,
    *,
    courier: bool = False,
) -> dict[str, Any]:
    """Record who received the delivery fee. The courier may set only their own share."""

    expected = {"delivery_courier_amount"} if courier else {"delivery_courier_amount", "delivery_owner_amount"}
    if set(payload) != expected:
        raise ContractError("VALIDATION_ERROR", "Invalid delivery fee request")
    courier_amount = _delivery_amount(payload, "delivery_courier_amount")
    owner_amount = None if courier else _delivery_amount(payload, "delivery_owner_amount")
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(
            f"""SELECT id, status, delivery_courier_amount, delivery_owner_amount
                FROM orders WHERE {lookup} AND deleted_at IS NULL FOR UPDATE""",
            lookup_values,
        )
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Order was not found", http_status=404)
        if courier and order["status"] == "cancelled":
            raise ContractError("ORDER_STATUS_CONFLICT", "Cancelled order cannot be changed", http_status=409)
        if owner_amount is None:
            owner_amount = order["delivery_owner_amount"]
        cur.execute(
            """UPDATE orders SET delivery_courier_amount = %s, delivery_owner_amount = %s,
                      delivery_updated_at = CURRENT_TIMESTAMP, delivery_updated_by = %s
               WHERE id = %s""",
            (courier_amount, owner_amount, actor_id, order["id"]),
        )
        _write_admin_audit(
            cur, actor_id=actor_id, action="order.delivery_fee_updated",
            resource_type="order", resource_id=order_id, request=current_request_id,
            details={
                "previous_courier_amount": str(order["delivery_courier_amount"]),
                "previous_owner_amount": str(order["delivery_owner_amount"]),
                "courier_amount": str(courier_amount), "owner_amount": str(owner_amount),
            },
        )
    response = {
        "order_id": order_id, "delivery_courier_amount": courier_amount,
        "currency": "TJS",
    }
    if not courier:
        response["delivery_owner_amount"] = owner_amount
        response["delivery_fee"] = courier_amount + owner_amount
    return response


def delete_order(order_id: str, actor_id: str, current_request_id: str) -> dict[str, Any]:
    """Soft-delete an eligible order while preserving its items and history."""

    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(
            f"""
            SELECT id, status, deleted_at,
                   COALESCE(order_reference, public_id, id::text) AS reference
            FROM orders WHERE {lookup} FOR UPDATE
            """,
            lookup_values,
        )
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Заказ не найден", http_status=404)
        if order["deleted_at"] is not None:
            raise ContractError("ORDER_ALREADY_DELETED", "Заказ уже удалён", http_status=409)
        if order["status"] not in DELETABLE_ORDER_STATUSES:
            raise ContractError(
                "ORDER_DELETE_STATE_CONFLICT",
                "Можно удалить только новый, отменённый или доставленный заказ",
                http_status=409,
            )
        cur.execute(
            """
            UPDATE orders
            SET deleted_at = CURRENT_TIMESTAMP, deleted_by = %s
            WHERE id = %s AND deleted_at IS NULL
            RETURNING deleted_at
            """,
            (actor_id, order["id"]),
        )
        deleted = cur.fetchone()
        if not deleted:
            raise ContractError("ORDER_ALREADY_DELETED", "Заказ уже удалён", http_status=409)
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="order.soft_delete",
            resource_type="order",
            resource_id=order_id,
            request=current_request_id,
            details={"reference": str(order["reference"]), "status": order["status"]},
        )
    return {"order_id": order_id, "deleted": True, "deleted_at": deleted["deleted_at"]}


def list_categories(query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    cursor = _decode_cursor(query.get("cursor"))
    params: list[Any] = []
    cursor_filter = ""
    if cursor:
        try:
            cursor_filter = "WHERE (sort_order, id) > (%s, %s)"
            params.extend([int(cursor["sort_order"]), int(cursor["id"])])
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "cursor is invalid") from exc
    params.append(limit + 1)
    with transaction() as cur:
        cur.execute(
            f"""
            SELECT id, slug, name, icon, color, sort_order, is_active, created_at
            FROM categories {cursor_filter}
            ORDER BY sort_order ASC, id ASC LIMIT %s
            """,
            tuple(params),
        )
        rows = [dict(row) for row in cur.fetchall()]
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor({"sort_order": last["sort_order"], "id": last["id"]})
    return {"data": rows, "page": {"next_cursor": next_cursor, "has_more": has_more}}


def create_category(payload: dict[str, Any]) -> dict[str, Any]:
    allowed = {"slug", "name", "icon", "color", "sort_order"}
    if set(payload) - allowed or not {"slug", "name"} <= set(payload):
        raise ContractError("VALIDATION_ERROR", "Invalid category request")
    slug = str(payload["slug"]).strip()
    name = str(payload["name"]).strip()
    if not 2 <= len(slug) <= 80 or not SLUG_PATTERN.fullmatch(slug) or not 1 <= len(name) <= 255:
        raise ContractError("VALIDATION_ERROR", "Category slug or name is invalid")
    icon = payload.get("icon")
    color = payload.get("color")
    if icon is not None and (not isinstance(icon, str) or len(icon) > (2048 if icon.startswith("https://") else 50)):
        raise ContractError("VALIDATION_ERROR", "Category icon is invalid")
    if color is not None and color != "" and (not isinstance(color, str) or not COLOR_PATTERN.fullmatch(color)):
        raise ContractError("VALIDATION_ERROR", "Category color is invalid")
    try:
        sort_order = int(payload.get("sort_order", 0))
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "Category sort_order is invalid") from exc
    if isinstance(payload.get("sort_order"), bool) or not 0 <= sort_order <= 100_000:
        raise ContractError("VALIDATION_ERROR", "Category sort_order is invalid")
    with transaction() as cur:
        cur.execute(
            """
            INSERT INTO categories (slug, name, icon, color, sort_order)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, slug, name, icon, color, sort_order, is_active, created_at
            """,
            (slug, name, icon or None, color or None, sort_order),
        )
        return dict(cur.fetchone())


def update_category(category_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    allowed = {"name", "icon", "color", "sort_order", "is_active"}
    if not payload or set(payload) - allowed:
        raise ContractError("VALIDATION_ERROR", "Invalid category update")
    if "name" in payload and (not isinstance(payload["name"], str) or not 1 <= len(payload["name"].strip()) <= 255):
        raise ContractError("VALIDATION_ERROR", "Category name is invalid")
    if "icon" in payload and payload["icon"] is not None and (
        not isinstance(payload["icon"], str) or len(payload["icon"]) > (2048 if payload["icon"].startswith("https://") else 50)
    ):
        raise ContractError("VALIDATION_ERROR", "Category icon is invalid")
    if "color" in payload and payload["color"] is not None and payload["color"] != "" and (
        not isinstance(payload["color"], str) or not COLOR_PATTERN.fullmatch(payload["color"])
    ):
        raise ContractError("VALIDATION_ERROR", "Category color is invalid")
    if "sort_order" in payload and (
        isinstance(payload["sort_order"], bool)
        or not isinstance(payload["sort_order"], int)
        or not 0 <= payload["sort_order"] <= 100_000
    ):
        raise ContractError("VALIDATION_ERROR", "Category sort_order is invalid")
    if "is_active" in payload and not isinstance(payload["is_active"], bool):
        raise ContractError("VALIDATION_ERROR", "Category is_active is invalid")
    assignments: list[str] = []
    values: list[Any] = []
    for field in ("name", "icon", "color", "sort_order", "is_active"):
        if field in payload:
            assignments.append(f"{field} = %s")
            value = payload[field]
            if field == "name":
                value = value.strip()
            if field in {"icon", "color"} and value == "":
                value = None
            values.append(value)
    values.append(category_id)
    with transaction() as cur:
        cur.execute(
            f"""
            UPDATE categories SET {', '.join(assignments)} WHERE id = %s
            RETURNING id, slug, name, icon, color, sort_order, is_active, created_at
            """,
            tuple(values),
        )
        row = cur.fetchone()
        if not row:
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        return dict(row)


def delete_category(category_id: int, actor_id: str, current_request_id: str) -> dict[str, Any]:
    """Delete only an unused category; medicine records are never deleted."""

    with transaction() as cur:
        cur.execute(
            "SELECT id, slug, name FROM categories WHERE id = %s FOR UPDATE",
            (category_id,),
        )
        category = cur.fetchone()
        if not category:
            raise ContractError("CATEGORY_NOT_FOUND", "Категория не найдена", http_status=404)
        cur.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM category_medicines WHERE category_id = %s) AS medicine_links,
                (SELECT COUNT(*) FROM homepage_banners
                 WHERE COALESCE(link_url, '') = %s
                    OR COALESCE(link_url, '') LIKE %s) AS banner_links
            """,
            (category_id, f"/category/{category['slug']}", f"%/category/{category['slug']}%"),
        )
        references = cur.fetchone()
        medicine_links = int(references["medicine_links"] or 0)
        banner_links = int(references["banner_links"] or 0)
        if medicine_links or banner_links:
            raise ContractError(
                "CATEGORY_IN_USE",
                "Категория используется. Сначала удалите связи с товарами и баннерами",
                http_status=409,
                fields={"medicine_links": str(medicine_links), "banner_links": str(banner_links)},
            )
        cur.execute("DELETE FROM categories WHERE id = %s", (category_id,))
        if cur.rowcount == 0:
            raise ContractError("CATEGORY_NOT_FOUND", "Категория не найдена", http_status=404)
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="category.delete",
            resource_type="category",
            resource_id=str(category_id),
            request=current_request_id,
            details={"name": category["name"], "slug": category["slug"]},
        )
    return {"category_id": category_id, "deleted": True}


def put_category_medicine(category_id: int, medicine_id: int) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("SELECT 1 FROM categories WHERE id = %s", (category_id,))
        if not cur.fetchone():
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute("SELECT name FROM medicines WHERE id = %s", (medicine_id,))
        medicine = cur.fetchone()
        if not medicine:
            raise ContractError("MEDICINE_NOT_FOUND", "Medicine was not found", http_status=404)
        cur.execute(
            """
            INSERT INTO category_medicines (category_id, medicine_id, medicine_name)
            VALUES (%s, %s, %s) ON CONFLICT DO NOTHING
            """,
            (category_id, medicine_id, medicine["name"]),
        )
    return {"category_id": category_id, "medicine_id": medicine_id}


def list_category_medicines(category_id: int, query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    page = _page_number(query)
    search = str(query.get("q") or "").strip()
    if len(search) > 120:
        raise ContractError("VALIDATION_ERROR", "q is too long")
    availability = str(query.get("availability") or "all")
    if availability not in {"all", "in_stock", "out_of_stock"}:
        raise ContractError("VALIDATION_ERROR", "availability is invalid")
    clauses = ["cm.category_id = %s"]
    params: list[Any] = [category_id]
    if search:
        clauses.append("(m.name ILIKE %s ESCAPE '\\' OR COALESCE(m.source_sku, '') ILIKE %s ESCAPE '\\')")
        pattern = _literal_ilike_pattern(search)
        params.extend([pattern, pattern])
    if availability == "in_stock":
        clauses.append("m.in_stock IS TRUE")
    elif availability == "out_of_stock":
        clauses.append("m.in_stock IS NOT TRUE")
    where = " AND ".join(clauses)
    offset = (page - 1) * limit
    with transaction() as cur:
        cur.execute("SELECT 1 FROM categories WHERE id = %s", (category_id,))
        if not cur.fetchone():
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM category_medicines cm
            JOIN medicines m ON m.id = cm.medicine_id
            WHERE {where}
            """,
            tuple(params),
        )
        total = int(cur.fetchone()["count"])
        cur.execute(
            f"""
            SELECT m.id AS medicine_id, m.name AS medicine_name, m.country, m.vendor,
                   m.in_stock, m.updated_at
            FROM category_medicines cm
            JOIN medicines m ON m.id = cm.medicine_id
            WHERE {where}
            ORDER BY lower(m.name) ASC, m.id ASC
            LIMIT %s OFFSET %s
            """,
            tuple([*params, limit, offset]),
        )
        rows = [dict(row) for row in cur.fetchall()]
    return {
        "data": rows,
        "page": {
            "number": page,
            "size": limit,
            "total_items": total,
            "total_pages": max(1, (total + limit - 1) // limit),
        },
    }


def search_category_medicine_candidates(category_id: int, query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    page = _page_number(query)
    search = str(query.get("q") or "").strip()
    if not 2 <= len(search) <= 120:
        raise ContractError("VALIDATION_ERROR", "q must contain between 2 and 120 characters")
    pattern = _literal_ilike_pattern(search)
    params: list[Any]
    if search.isdigit():
        search_clause = "(m.id = %s OR m.name ILIKE %s ESCAPE '\\' OR COALESCE(m.source_sku, '') ILIKE %s ESCAPE '\\')"
        params = [int(search), pattern, pattern]
    else:
        search_clause = "(m.name ILIKE %s ESCAPE '\\' OR COALESCE(m.source_sku, '') ILIKE %s ESCAPE '\\')"
        params = [pattern, pattern]
    offset = (page - 1) * limit
    with transaction() as cur:
        cur.execute("SELECT 1 FROM categories WHERE id = %s", (category_id,))
        if not cur.fetchone():
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute(f"SELECT COUNT(*) AS count FROM medicines m WHERE {search_clause}", tuple(params))
        total = int(cur.fetchone()["count"])
        cur.execute(
            f"""
            SELECT m.id AS medicine_id, m.name AS medicine_name,
                   m.price AS base_unit_price,
                   vatan_selling_unit_price(m.price) AS selling_unit_price,
                   m.source_sku, m.country, m.vendor, m.in_stock, m.updated_at, m.image_url,
                   EXISTS (
                       SELECT 1 FROM category_medicines cm
                       WHERE cm.category_id = %s AND cm.medicine_id = m.id
                   ) AS already_present
            FROM medicines m
            WHERE {search_clause}
            ORDER BY lower(m.name) ASC, m.id ASC
            LIMIT %s OFFSET %s
            """,
            tuple([category_id, *params, limit, offset]),
        )
        rows = [dict(row) for row in cur.fetchall()]
    return {
        "data": rows,
        "page": {
            "number": page,
            "size": limit,
            "total_items": total,
            "total_pages": max(1, (total + limit - 1) // limit),
        },
    }


def preview_category_medicine_bulk_add(category_id: int, query: dict[str, Any]) -> dict[str, Any]:
    fragment = _medicine_name_fragment(query.get("fragment"))
    limit = _limit(query)
    page = _page_number(query)
    offset = (page - 1) * limit
    pattern = _literal_ilike_pattern(fragment)
    with transaction() as cur:
        cur.execute("SELECT 1 FROM categories WHERE id = %s", (category_id,))
        if not cur.fetchone():
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute(
            "SELECT COUNT(*) AS count FROM medicines m WHERE m.name ILIKE %s ESCAPE '\\'",
            (pattern,),
        )
        matched = int(cur.fetchone()["count"])
        cur.execute(
            """
            SELECT m.id AS medicine_id, m.name AS medicine_name, m.country, m.vendor,
                   m.in_stock, m.updated_at,
                   EXISTS (
                       SELECT 1 FROM category_medicines cm
                       WHERE cm.category_id = %s AND cm.medicine_id = m.id
                   ) AS already_present
            FROM medicines m
            WHERE m.name ILIKE %s ESCAPE '\\'
            ORDER BY lower(m.name) ASC, m.id ASC
            LIMIT %s OFFSET %s
            """,
            (category_id, pattern, limit, offset),
        )
        rows = [dict(row) for row in cur.fetchall()]
    return {
        "data": rows,
        "total": matched,
        "fragment": fragment,
        "page": {
            "number": page,
            "size": limit,
            "total_items": matched,
            "total_pages": max(1, (matched + limit - 1) // limit),
        },
    }


def bulk_add_category_medicines(
    category_id: int,
    payload: dict[str, Any],
    actor_id: str,
    current_request_id: str,
) -> dict[str, Any]:
    if set(payload) != {"fragment", "confirmed_count"}:
        raise ContractError("VALIDATION_ERROR", "fragment and confirmed_count are required")
    fragment = _medicine_name_fragment(payload.get("fragment"))
    confirmed_count = payload.get("confirmed_count")
    if isinstance(confirmed_count, bool) or not isinstance(confirmed_count, int) or confirmed_count < 0:
        raise ContractError("VALIDATION_ERROR", "confirmed_count must be a non-negative integer")
    pattern = _literal_ilike_pattern(fragment)
    with transaction() as cur:
        cur.execute("SELECT id FROM categories WHERE id = %s FOR UPDATE", (category_id,))
        if not cur.fetchone():
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute(
            """
            WITH matched AS MATERIALIZED (
                SELECT m.id AS medicine_id, m.name AS medicine_name
                FROM medicines m
                WHERE m.name ILIKE %s ESCAPE '\\'
            ),
            match_count AS (
                SELECT COUNT(*)::integer AS matched FROM matched
            ),
            inserted AS (
                INSERT INTO category_medicines (category_id, medicine_id, medicine_name)
                SELECT %s, matched.medicine_id, matched.medicine_name
                FROM matched CROSS JOIN match_count
                WHERE match_count.matched = %s
                ON CONFLICT DO NOTHING
                RETURNING medicine_id
            )
            SELECT match_count.matched, COUNT(inserted.medicine_id)::integer AS added
            FROM match_count LEFT JOIN inserted ON TRUE
            GROUP BY match_count.matched
            """,
            (pattern, category_id, confirmed_count),
        )
        counts = cur.fetchone()
        matched = int(counts["matched"])
        if matched != confirmed_count:
            raise ContractError(
                "BULK_PREVIEW_STALE",
                "The number of matching medicines changed. Preview the list again before adding",
                http_status=409,
                fields={"confirmed_count": str(confirmed_count), "matched": str(matched)},
            )
        added = int(counts["added"])
        result = {
            "category_id": category_id,
            "fragment": fragment,
            "matched": matched,
            "added": added,
            "already_present": matched - added,
        }
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="category.medicines.bulk_add",
            resource_type="category",
            resource_id=str(category_id),
            request=current_request_id,
            details={
                "fragment": fragment,
                "matched": matched,
                "added": added,
                "already_present": matched - added,
            },
        )
    return result


def batch_add_category_medicines(
    category_id: int, payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    medicine_ids = _id_batch(payload, "medicine_ids")
    with transaction() as cur:
        cur.execute("SELECT id FROM categories WHERE id = %s FOR UPDATE", (category_id,))
        if not cur.fetchone():
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute(
            """
            WITH requested AS (
                SELECT medicine_id, position
                FROM unnest(%s::bigint[]) WITH ORDINALITY AS selected(medicine_id, position)
            ),
            found AS MATERIALIZED (
                SELECT requested.medicine_id, requested.position, m.name
                FROM requested JOIN medicines m ON m.id = requested.medicine_id
            ),
            counts AS (
                SELECT (SELECT COUNT(*) FROM requested)::integer AS selected,
                       (SELECT COUNT(*) FROM found)::integer AS found
            ),
            inserted AS (
                INSERT INTO category_medicines (category_id, medicine_id, medicine_name)
                SELECT %s, found.medicine_id, found.name
                FROM found CROSS JOIN counts
                WHERE counts.selected = counts.found
                ORDER BY found.position
                ON CONFLICT DO NOTHING
                RETURNING medicine_id
            )
            SELECT counts.selected, counts.found, COUNT(inserted.medicine_id)::integer AS added
            FROM counts LEFT JOIN inserted ON TRUE
            GROUP BY counts.selected, counts.found
            """,
            (medicine_ids, category_id),
        )
        counts = cur.fetchone()
        selected = int(counts["selected"])
        found = int(counts["found"])
        if selected != found:
            raise ContractError(
                "MEDICINE_SELECTION_CHANGED",
                "One or more selected medicines no longer exist; refresh before adding",
                http_status=409,
            )
        added = int(counts["added"])
        result = {
            "category_id": category_id,
            "selected": selected,
            "added": added,
            "already_present": selected - added,
        }
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="category.medicines.batch_add",
            resource_type="category",
            resource_id=str(category_id),
            request=current_request_id,
            details={**result, "medicine_ids": medicine_ids},
        )
    return result


def batch_remove_category_medicines(
    category_id: int, payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    medicine_ids = _id_batch(payload, "medicine_ids")
    with transaction() as cur:
        cur.execute("SELECT id FROM categories WHERE id = %s FOR UPDATE", (category_id,))
        if not cur.fetchone():
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute(
            """
            DELETE FROM category_medicines
            WHERE category_id = %s AND medicine_id = ANY(%s::bigint[])
            RETURNING medicine_id
            """,
            (category_id, medicine_ids),
        )
        removed_ids = [int(row["medicine_id"]) for row in cur.fetchall()]
        result = {
            "category_id": category_id,
            "selected": len(medicine_ids),
            "removed": len(removed_ids),
            "already_absent": len(medicine_ids) - len(removed_ids),
        }
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="category.medicines.batch_remove",
            resource_type="category",
            resource_id=str(category_id),
            request=current_request_id,
            details={**result, "medicine_ids": medicine_ids},
        )
    return result


def reorder_categories(payload: dict[str, Any], actor_id: str, current_request_id: str) -> dict[str, Any]:
    category_ids = _id_batch(payload, "category_ids")
    with transaction() as cur:
        cur.execute("SELECT id FROM categories FOR UPDATE")
        existing = {int(row["id"]) for row in cur.fetchall()}
        if existing != set(category_ids):
            raise ContractError("CATEGORIES_CHANGED", "Categories changed; refresh before reordering", http_status=409)
        cur.execute(
            """
            UPDATE categories AS category
            SET sort_order = ordered.position * 10
            FROM unnest(%s::bigint[]) WITH ORDINALITY AS ordered(category_id, position)
            WHERE category.id = ordered.category_id
            """,
            (category_ids,),
        )
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="categories.reorder",
            resource_type="categories",
            resource_id="all",
            request=current_request_id,
            details={"category_ids": category_ids},
        )
    return {"category_ids": category_ids}


def delete_category_medicine(category_id: int, medicine_id: int) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            "DELETE FROM category_medicines WHERE category_id = %s AND medicine_id = %s",
            (category_id, medicine_id),
        )
        if cur.rowcount == 0:
            raise ContractError("CATEGORY_MEDICINE_NOT_FOUND", "Category medicine link was not found", http_status=404)
    return {"category_id": category_id, "medicine_id": medicine_id, "deleted": True}


def list_homepage_banners() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            f"""
            SELECT {BANNER_SELECT_COLUMNS}
            FROM homepage_banners
            ORDER BY CASE slot
                WHEN 'left' THEN 1 WHEN 'center' THEN 2
                WHEN 'right_top' THEN 3 WHEN 'right_bottom' THEN 4 ELSE 5 END
            """
        )
        return {"data": [dict(row) for row in cur.fetchall()]}


def update_homepage_banner(
    slot: str,
    payload: dict[str, Any],
    actor_id: str,
    current_request_id: str,
) -> dict[str, Any]:
    allowed_slots = {"left", "center", "right_top", "right_bottom", "mobile"}
    optional_text = {"title": 120, "subtitle": 240, "cta_text": 80, "alt_text": 200}
    enum_fields = {
        "fit_mode": {"cover", "contain"},
        "overlay_type": {"solid", "gradient"},
        "overlay_direction": {"to_right", "to_left", "to_top", "to_bottom"},
        "text_align": {"left", "center", "right"},
        "content_vertical": {"top", "center", "bottom"},
        "contain_background": {"color", "blur"},
    }
    integer_fields = {
        "object_position_x": (0, 100),
        "object_position_y": (0, 100),
        "image_width": (1, 20_000),
        "image_height": (1, 20_000),
        "overlay_opacity": (0, 100),
        "title_size": (14, 64),
        "subtitle_size": (10, 40),
        "content_max_width": (30, 100),
        "image_scale": (50, 300),
        "title_x": (0, 100), "title_y": (0, 92), "title_width": (15, 100), "title_scale": (50, 200),
        "subtitle_x": (0, 100), "subtitle_y": (0, 92), "subtitle_width": (15, 100), "subtitle_scale": (50, 200),
        "cta_x": (0, 100), "cta_y": (0, 92), "cta_width": (15, 100), "cta_scale": (50, 200),
        "mobile_image_x": (0, 100), "mobile_image_y": (0, 100), "mobile_image_scale": (50, 300),
        "mobile_title_x": (0, 100), "mobile_title_y": (0, 92), "mobile_title_width": (15, 100), "mobile_title_scale": (50, 200),
        "mobile_subtitle_x": (0, 100), "mobile_subtitle_y": (0, 92), "mobile_subtitle_width": (15, 100), "mobile_subtitle_scale": (50, 200),
        "mobile_cta_x": (0, 100), "mobile_cta_y": (0, 92), "mobile_cta_width": (15, 100), "mobile_cta_scale": (50, 200),
    }
    allowed = set(optional_text) | set(enum_fields) | set(integer_fields) | {
        "image_url", "link_url", "is_active", "overlay_enabled", "overlay_color", "text_color",
        "contain_background_color", "mobile_override",
    }
    if slot not in allowed_slots:
        raise ContractError("BANNER_NOT_FOUND", "Banner was not found", http_status=404)
    if not payload or set(payload) - allowed:
        raise ContractError("VALIDATION_ERROR", "Invalid banner update")
    for field, maximum in optional_text.items():
        if field in payload and payload[field] is not None and (
            not isinstance(payload[field], str) or len(payload[field].strip()) > maximum
        ):
            raise ContractError("VALIDATION_ERROR", f"Banner {field} is invalid")
    image_url = payload.get("image_url")
    if "image_url" in payload and image_url is not None and image_url != "" and (
        not isinstance(image_url, str) or len(image_url) > 2000 or not image_url.startswith("https://")
    ):
        raise ContractError("VALIDATION_ERROR", "Banner image URL must use HTTPS")
    link_url = payload.get("link_url")
    if "link_url" in payload and link_url is not None and link_url != "" and (
        not isinstance(link_url, str) or len(link_url) > 2000
        or not (link_url.startswith("https://") or (link_url.startswith("/") and not link_url.startswith("//")))
    ):
        raise ContractError("VALIDATION_ERROR", "Banner link URL is invalid")
    if "is_active" in payload and not isinstance(payload["is_active"], bool):
        raise ContractError("VALIDATION_ERROR", "Banner is_active is invalid")
    if "overlay_enabled" in payload and not isinstance(payload["overlay_enabled"], bool):
        raise ContractError("VALIDATION_ERROR", "Banner overlay_enabled is invalid")
    if "mobile_override" in payload and not isinstance(payload["mobile_override"], bool):
        raise ContractError("VALIDATION_ERROR", "Banner mobile_override is invalid")
    for field in ("overlay_color", "text_color", "contain_background_color"):
        if field in payload and (not isinstance(payload[field], str) or not COLOR_PATTERN.fullmatch(payload[field])):
            raise ContractError("VALIDATION_ERROR", f"Banner {field} is invalid")
    for field, choices in enum_fields.items():
        if field in payload and payload[field] not in choices:
            raise ContractError("VALIDATION_ERROR", f"Banner {field} is invalid")
    for field, (minimum, maximum) in integer_fields.items():
        value = payload.get(field)
        if field in payload and value is not None and (
            isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum
        ):
            raise ContractError("VALIDATION_ERROR", f"Banner {field} is invalid")
        if field in {"image_width", "image_height"}:
            continue
        if field in payload and value is None:
            raise ContractError("VALIDATION_ERROR", f"Banner {field} is invalid")

    normalized: dict[str, Any] = {}
    nullable_string_fields = set(optional_text) | {"image_url", "link_url"}
    for field, raw_value in payload.items():
        value = raw_value.strip() if isinstance(raw_value, str) else raw_value
        if field in nullable_string_fields and value == "":
            value = None
        normalized[field] = value

    assignments = []
    values = []
    for field in (
        "title", "subtitle", "image_url", "link_url", "is_active", "cta_text", "alt_text",
        "fit_mode", "object_position_x", "object_position_y", "image_width", "image_height",
        "overlay_enabled", "overlay_color", "overlay_opacity", "overlay_type", "overlay_direction",
        "text_color", "text_align", "content_vertical", "title_size", "subtitle_size", "content_max_width",
        "image_scale", "contain_background", "contain_background_color",
        "title_x", "title_y", "title_width", "title_scale",
        "subtitle_x", "subtitle_y", "subtitle_width", "subtitle_scale",
        "cta_x", "cta_y", "cta_width", "cta_scale",
        "mobile_override", "mobile_image_x", "mobile_image_y", "mobile_image_scale",
        "mobile_title_x", "mobile_title_y", "mobile_title_width", "mobile_title_scale",
        "mobile_subtitle_x", "mobile_subtitle_y", "mobile_subtitle_width", "mobile_subtitle_scale",
        "mobile_cta_x", "mobile_cta_y", "mobile_cta_width", "mobile_cta_scale",
    ):
        if field in normalized:
            assignments.append(f"{field} = %s")
            values.append(normalized[field])
    with transaction() as cur:
        cur.execute(f"SELECT {BANNER_SELECT_COLUMNS} FROM homepage_banners WHERE slot = %s FOR UPDATE", (slot,))
        existing = cur.fetchone()
        if not existing:
            raise ContractError("BANNER_NOT_FOUND", "Banner was not found", http_status=404)
        effective_image_url = normalized.get("image_url", existing["image_url"])
        effective_is_active = normalized.get("is_active", bool(existing["is_active"]))
        if effective_is_active and not effective_image_url:
            raise ContractError(
                "BANNER_IMAGE_REQUIRED",
                "An active banner must have an image",
                http_status=409,
            )
        for prefix in ("title", "subtitle", "cta", "mobile_title", "mobile_subtitle", "mobile_cta"):
            effective_x = normalized.get(f"{prefix}_x", existing[f"{prefix}_x"])
            effective_width = normalized.get(f"{prefix}_width", existing[f"{prefix}_width"])
            if effective_x + effective_width > 100:
                raise ContractError("VALIDATION_ERROR", f"Banner {prefix} exceeds canvas width")
        values.append(slot)
        cur.execute(
            f"""
            UPDATE homepage_banners
            SET {', '.join(assignments)}, updated_at = CURRENT_TIMESTAMP
            WHERE slot = %s
            RETURNING {BANNER_SELECT_COLUMNS}
            """,
            tuple(values),
        )
        row = cur.fetchone()
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="homepage_banner.updated",
            resource_type="homepage_banner",
            resource_id=slot,
            request=current_request_id,
            details={"changed_fields": sorted(normalized), "is_active": bool(row["is_active"])},
        )
        return dict(row)


def _featured_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "medicine_id": row["medicine_id"],
        "medicine_name": row["medicine_name"],
        "base_unit_price": row["base_unit_price"],
        "selling_unit_price": int(row.get("selling_unit_price") or calculate_selling_unit_price(row["base_unit_price"])),
        "country": row["country"] or None,
        "vendor": row["vendor"] or None,
        "in_stock": bool(row["in_stock"]),
        "image_url": row["image_url"],
        "sort_order": int(row["sort_order"] or 0),
        "updated_at": row["updated_at"],
    }


def list_featured_products() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT m.id AS medicine_id, m.name AS medicine_name,
                   m.price AS base_unit_price,
                   vatan_selling_unit_price(m.price) AS selling_unit_price,
                   m.country, m.vendor, m.in_stock,
                   fp.image_url, COALESCE(fp.sort_order, 0) AS sort_order,
                   fp.updated_at
            FROM featured_products fp
            JOIN medicines m ON m.id = fp.medicine_id
            ORDER BY COALESCE(fp.sort_order, 0) ASC, fp.id ASC
            LIMIT 100
            """
        )
        return {"data": [_featured_response(dict(row)) for row in cur.fetchall()]}


def _featured_values(payload: dict[str, Any], *, creating: bool) -> tuple[str | None, int]:
    allowed = {"medicine_id", "image_url", "sort_order"} if creating else {"image_url", "sort_order"}
    if not payload or set(payload) - allowed:
        raise ContractError("VALIDATION_ERROR", "Invalid featured product update")
    image_url = payload.get("image_url")
    if image_url == "":
        image_url = None
    if image_url is not None and (
        not isinstance(image_url, str) or len(image_url) > 2000 or not image_url.startswith("https://")
    ):
        raise ContractError("VALIDATION_ERROR", "Featured product image URL must use HTTPS")
    sort_order = payload.get("sort_order", 0)
    if isinstance(sort_order, bool) or not isinstance(sort_order, int) or not 0 <= sort_order <= 100_000:
        raise ContractError("VALIDATION_ERROR", "Featured product sort_order is invalid")
    return image_url.strip() if isinstance(image_url, str) else None, sort_order


def create_featured_product(payload: dict[str, Any]) -> dict[str, Any]:
    medicine_id = _positive_int(payload.get("medicine_id"), "medicine_id")
    image_url, sort_order = _featured_values(payload, creating=True)
    with transaction() as cur:
        cur.execute("SELECT name FROM medicines WHERE id = %s", (medicine_id,))
        medicine = cur.fetchone()
        if not medicine:
            raise ContractError("MEDICINE_NOT_FOUND", "Medicine was not found", http_status=404)
        cur.execute(
            """
            INSERT INTO featured_products (medicine_id, medicine_name, image_url, sort_order, updated_at)
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (medicine_id) WHERE medicine_id IS NOT NULL
            DO UPDATE SET medicine_name = EXCLUDED.medicine_name,
                          image_url = EXCLUDED.image_url,
                          sort_order = EXCLUDED.sort_order,
                          updated_at = CURRENT_TIMESTAMP
            """,
            (medicine_id, medicine["name"], image_url, sort_order),
        )
    return get_featured_product(medicine_id)


def get_featured_product(medicine_id: int) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT m.id AS medicine_id, m.name AS medicine_name,
                   m.price AS base_unit_price,
                   vatan_selling_unit_price(m.price) AS selling_unit_price,
                   m.country, m.vendor, m.in_stock,
                   fp.image_url, COALESCE(fp.sort_order, 0) AS sort_order,
                   fp.updated_at
            FROM featured_products fp
            JOIN medicines m ON m.id = fp.medicine_id
            WHERE fp.medicine_id = %s
            """,
            (medicine_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ContractError("FEATURED_PRODUCT_NOT_FOUND", "Featured product was not found", http_status=404)
    return _featured_response(dict(row))


def update_featured_product(medicine_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    image_url, sort_order = _featured_values(payload, creating=False)
    with transaction() as cur:
        cur.execute(
            """
            UPDATE featured_products
            SET image_url = %s, sort_order = %s, updated_at = CURRENT_TIMESTAMP
            WHERE medicine_id = %s
            """,
            (image_url, sort_order, medicine_id),
        )
        if cur.rowcount == 0:
            raise ContractError("FEATURED_PRODUCT_NOT_FOUND", "Featured product was not found", http_status=404)
    return get_featured_product(medicine_id)


def delete_featured_product(medicine_id: int) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("DELETE FROM featured_products WHERE medicine_id = %s", (medicine_id,))
        if cur.rowcount == 0:
            raise ContractError("FEATURED_PRODUCT_NOT_FOUND", "Featured product was not found", http_status=404)
    return {"medicine_id": medicine_id, "deleted": True}


def _carousel_product_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "medicine_id": row["medicine_id"],
        "medicine_name": row["medicine_name"],
        "base_unit_price": row["base_unit_price"],
        "selling_unit_price": int(row.get("selling_unit_price") or calculate_selling_unit_price(row["base_unit_price"])),
        "country": row["country"] or None,
        "vendor": row["vendor"] or None,
        "in_stock": bool(row["in_stock"]),
        "image_url": row["image_url"],
        "sort_order": int(row["item_sort_order"] or 0),
        "updated_at": row["item_updated_at"],
    }


def list_product_carousels() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT pc.id, pc.slug, pc.title, pc.is_active, pc.sort_order,
                   pc.created_at, pc.updated_at, COUNT(pci.id)::integer AS product_count
            FROM product_carousels pc
            LEFT JOIN product_carousel_items pci ON pci.carousel_id = pc.id
            GROUP BY pc.id
            ORDER BY pc.sort_order ASC, pc.id ASC
            LIMIT 100
            """
        )
        carousel_rows = [dict(row) for row in cur.fetchall()]
    return {
        "data": [
            {
                "id": row["id"],
                "slug": row["slug"],
                "title": row["title"],
                "is_active": bool(row["is_active"]),
                "sort_order": int(row["sort_order"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "product_count": int(row["product_count"]),
            }
            for row in carousel_rows
        ]
    }


def list_product_carousel_items(carousel_id: int, query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    page = _page_number(query)
    search = str(query.get("q") or "").strip()
    if len(search) > 120:
        raise ContractError("VALIDATION_ERROR", "q is too long")
    params: list[Any] = [carousel_id]
    search_clause = ""
    if search:
        pattern = _literal_ilike_pattern(search)
        search_clause = "AND (m.name ILIKE %s ESCAPE '\\' OR COALESCE(m.source_sku, '') ILIKE %s ESCAPE '\\')"
        params.extend([pattern, pattern])
    offset = (page - 1) * limit
    with transaction() as cur:
        cur.execute("SELECT 1 FROM product_carousels WHERE id = %s", (carousel_id,))
        if not cur.fetchone():
            raise ContractError("CAROUSEL_NOT_FOUND", "Carousel was not found", http_status=404)
        cur.execute(
            f"""
            SELECT COUNT(*) AS count
            FROM product_carousel_items pci
            JOIN medicines m ON m.id = pci.medicine_id
            WHERE pci.carousel_id = %s {search_clause}
            """,
            tuple(params),
        )
        total = int(cur.fetchone()["count"])
        cur.execute(
            f"""
            SELECT pci.carousel_id, m.id AS medicine_id, m.name AS medicine_name,
                   m.price AS base_unit_price,
                   vatan_selling_unit_price(m.price) AS selling_unit_price,
                   m.country, m.vendor, m.in_stock,
                   m.image_url, pci.sort_order AS item_sort_order,
                   pci.updated_at AS item_updated_at
            FROM product_carousel_items pci
            JOIN medicines m ON m.id = pci.medicine_id
            WHERE pci.carousel_id = %s {search_clause}
            ORDER BY pci.sort_order ASC, pci.id ASC
            LIMIT %s OFFSET %s
            """,
            tuple([*params, limit, offset]),
        )
        rows = [_carousel_product_response(dict(row)) for row in cur.fetchall()]
    return {
        "data": rows,
        "page": {
            "number": page,
            "size": limit,
            "total_items": total,
            "total_pages": max(1, (total + limit - 1) // limit),
        },
    }


def search_product_carousel_candidates(carousel_id: int, query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    page = _page_number(query)
    search = str(query.get("q") or "").strip()
    if not 2 <= len(search) <= 120:
        raise ContractError("VALIDATION_ERROR", "q must contain between 2 and 120 characters")
    pattern = _literal_ilike_pattern(search)
    if search.isdigit():
        clause = "(m.id = %s OR m.name ILIKE %s ESCAPE '\\' OR COALESCE(m.source_sku, '') ILIKE %s ESCAPE '\\')"
        params: list[Any] = [int(search), pattern, pattern]
    else:
        clause = "(m.name ILIKE %s ESCAPE '\\' OR COALESCE(m.source_sku, '') ILIKE %s ESCAPE '\\')"
        params = [pattern, pattern]
    offset = (page - 1) * limit
    with transaction() as cur:
        cur.execute("SELECT 1 FROM product_carousels WHERE id = %s", (carousel_id,))
        if not cur.fetchone():
            raise ContractError("CAROUSEL_NOT_FOUND", "Carousel was not found", http_status=404)
        cur.execute(f"SELECT COUNT(*) AS count FROM medicines m WHERE {clause}", tuple(params))
        total = int(cur.fetchone()["count"])
        cur.execute(
            f"""
            SELECT m.id AS medicine_id, m.name AS medicine_name, m.price AS base_unit_price,
                   vatan_selling_unit_price(m.price) AS selling_unit_price,
                   m.source_sku, m.country, m.vendor, m.in_stock, m.updated_at, m.image_url,
                   EXISTS (
                       SELECT 1 FROM product_carousel_items pci
                       WHERE pci.carousel_id = %s AND pci.medicine_id = m.id
                   ) AS already_present
            FROM medicines m
            WHERE {clause}
            ORDER BY lower(m.name) ASC, m.id ASC
            LIMIT %s OFFSET %s
            """,
            tuple([carousel_id, *params, limit, offset]),
        )
        rows = [dict(row) for row in cur.fetchall()]
    return {
        "data": rows,
        "page": {
            "number": page,
            "size": limit,
            "total_items": total,
            "total_pages": max(1, (total + limit - 1) // limit),
        },
    }


def _carousel_values(payload: dict[str, Any], *, creating: bool) -> dict[str, Any]:
    allowed = {"slug", "title", "is_active", "sort_order"} if creating else {"title", "is_active", "sort_order"}
    if not payload or set(payload) - allowed:
        raise ContractError("VALIDATION_ERROR", "Invalid carousel update")
    values: dict[str, Any] = {}
    if creating:
        slug = payload.get("slug")
        if not isinstance(slug, str) or not SLUG_PATTERN.fullmatch(slug) or len(slug) > 80:
            raise ContractError("VALIDATION_ERROR", "slug must contain lowercase letters, numbers and hyphens")
        values["slug"] = slug
    if creating or "title" in payload:
        title = payload.get("title")
        if not isinstance(title, str) or not 2 <= len(title.strip()) <= 120:
            raise ContractError("VALIDATION_ERROR", "title must contain between 2 and 120 characters")
        values["title"] = title.strip()
    if creating or "is_active" in payload:
        active = payload.get("is_active", True)
        if not isinstance(active, bool):
            raise ContractError("VALIDATION_ERROR", "is_active must be a boolean")
        values["is_active"] = active
    if creating or "sort_order" in payload:
        values["sort_order"] = _sort_order(payload.get("sort_order", 0))
    return values


def create_product_carousel(payload: dict[str, Any]) -> dict[str, Any]:
    values = _carousel_values(payload, creating=True)
    with transaction() as cur:
        cur.execute(
            """
            INSERT INTO product_carousels (slug, title, is_active, sort_order)
            VALUES (%s, %s, %s, %s)
            RETURNING id, slug, title, is_active, sort_order, created_at, updated_at
            """,
            (values["slug"], values["title"], values["is_active"], values["sort_order"]),
        )
        row = dict(cur.fetchone())
    row["product_count"] = 0
    return row


def update_product_carousel(carousel_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    values = _carousel_values(payload, creating=False)
    assignments = [f"{field} = %s" for field in values]
    params = [*values.values(), carousel_id]
    with transaction() as cur:
        cur.execute(
            f"""
            UPDATE product_carousels
            SET {', '.join(assignments)}, updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            RETURNING id, slug, title, is_active, sort_order, created_at, updated_at
            """,
            tuple(params),
        )
        row = cur.fetchone()
        if row:
            cur.execute("SELECT COUNT(*) AS count FROM product_carousel_items WHERE carousel_id = %s", (carousel_id,))
            product_count = int(cur.fetchone()["count"])
    if not row:
        raise ContractError("CAROUSEL_NOT_FOUND", "Carousel was not found", http_status=404)
    result = dict(row)
    result["product_count"] = product_count
    return result


def delete_product_carousel(carousel_id: int) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute("DELETE FROM product_carousels WHERE id = %s", (carousel_id,))
        if cur.rowcount == 0:
            raise ContractError("CAROUSEL_NOT_FOUND", "Carousel was not found", http_status=404)
    return {"carousel_id": carousel_id, "deleted": True}


def add_product_carousel_item(carousel_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    if set(payload) - {"medicine_id", "sort_order"} or "medicine_id" not in payload:
        raise ContractError("VALIDATION_ERROR", "Invalid carousel product")
    medicine_id = _positive_int(payload.get("medicine_id"), "medicine_id")
    sort_order = _sort_order(payload.get("sort_order", 0))
    with transaction() as cur:
        cur.execute("SELECT 1 FROM product_carousels WHERE id = %s", (carousel_id,))
        if not cur.fetchone():
            raise ContractError("CAROUSEL_NOT_FOUND", "Carousel was not found", http_status=404)
        cur.execute("SELECT 1 FROM medicines WHERE id = %s", (medicine_id,))
        if not cur.fetchone():
            raise ContractError("MEDICINE_NOT_FOUND", "Medicine was not found", http_status=404)
        cur.execute(
            """
            INSERT INTO product_carousel_items (carousel_id, medicine_id, sort_order)
            VALUES (%s, %s, %s)
            ON CONFLICT (carousel_id, medicine_id) DO NOTHING
            """,
            (carousel_id, medicine_id, sort_order),
        )
        if cur.rowcount == 0:
            raise ContractError("DUPLICATE_PRODUCT", "Product is already in this carousel", http_status=409)
    return {"carousel_id": carousel_id, "medicine_id": medicine_id, "sort_order": sort_order}


def batch_add_product_carousel_items(
    carousel_id: int, payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    medicine_ids = _id_batch(payload, "medicine_ids")
    with transaction() as cur:
        cur.execute("SELECT id FROM product_carousels WHERE id = %s FOR UPDATE", (carousel_id,))
        if not cur.fetchone():
            raise ContractError("CAROUSEL_NOT_FOUND", "Carousel was not found", http_status=404)
        cur.execute(
            """
            WITH requested AS (
                SELECT medicine_id, position
                FROM unnest(%s::bigint[]) WITH ORDINALITY AS selected(medicine_id, position)
            ),
            found AS MATERIALIZED (
                SELECT requested.medicine_id, requested.position
                FROM requested JOIN medicines m ON m.id = requested.medicine_id
            ),
            counts AS (
                SELECT (SELECT COUNT(*) FROM requested)::integer AS selected,
                       (SELECT COUNT(*) FROM found)::integer AS found
            ),
            current_order AS (
                SELECT COALESCE(MAX(sort_order), 0)::integer AS maximum
                FROM product_carousel_items WHERE carousel_id = %s
            ),
            inserted AS (
                INSERT INTO product_carousel_items (carousel_id, medicine_id, sort_order)
                SELECT %s, found.medicine_id, current_order.maximum + found.position
                FROM found CROSS JOIN counts CROSS JOIN current_order
                WHERE counts.selected = counts.found
                  AND current_order.maximum + counts.selected <= 100000
                ORDER BY found.position
                ON CONFLICT (carousel_id, medicine_id) DO NOTHING
                RETURNING medicine_id
            )
            SELECT counts.selected, counts.found, current_order.maximum,
                   COUNT(inserted.medicine_id)::integer AS added
            FROM counts CROSS JOIN current_order LEFT JOIN inserted ON TRUE
            GROUP BY counts.selected, counts.found, current_order.maximum
            """,
            (medicine_ids, carousel_id, carousel_id),
        )
        counts = cur.fetchone()
        selected = int(counts["selected"])
        found = int(counts["found"])
        if selected != found:
            raise ContractError(
                "MEDICINE_SELECTION_CHANGED",
                "One or more selected medicines no longer exist; refresh before adding",
                http_status=409,
            )
        if int(counts["maximum"]) + selected > 100000:
            raise ContractError("CAROUSEL_ORDER_LIMIT", "Carousel order limit was reached", http_status=409)
        added = int(counts["added"])
        result = {
            "carousel_id": carousel_id,
            "selected": selected,
            "added": added,
            "already_present": selected - added,
        }
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="carousel.products.batch_add",
            resource_type="product_carousel",
            resource_id=str(carousel_id),
            request=current_request_id,
            details={**result, "medicine_ids": medicine_ids},
        )
    return result


def batch_remove_product_carousel_items(
    carousel_id: int, payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    medicine_ids = _id_batch(payload, "medicine_ids")
    with transaction() as cur:
        cur.execute("SELECT id FROM product_carousels WHERE id = %s FOR UPDATE", (carousel_id,))
        if not cur.fetchone():
            raise ContractError("CAROUSEL_NOT_FOUND", "Carousel was not found", http_status=404)
        cur.execute(
            """
            DELETE FROM product_carousel_items
            WHERE carousel_id = %s AND medicine_id = ANY(%s::bigint[])
            RETURNING medicine_id
            """,
            (carousel_id, medicine_ids),
        )
        removed_ids = [int(row["medicine_id"]) for row in cur.fetchall()]
        result = {
            "carousel_id": carousel_id,
            "selected": len(medicine_ids),
            "removed": len(removed_ids),
            "already_absent": len(medicine_ids) - len(removed_ids),
        }
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="carousel.products.batch_remove",
            resource_type="product_carousel",
            resource_id=str(carousel_id),
            request=current_request_id,
            details={**result, "medicine_ids": medicine_ids},
        )
    return result


def update_product_carousel_item(carousel_id: int, medicine_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    if not payload or set(payload) - {"sort_order", "image_url"}:
        raise ContractError("VALIDATION_ERROR", "Invalid carousel product update")
    sort_order = _sort_order(payload["sort_order"]) if "sort_order" in payload else None
    image_url = _image_url(payload.get("image_url")) if "image_url" in payload else None
    with transaction() as cur:
        if "image_url" in payload:
            cur.execute("UPDATE medicines SET image_url = %s WHERE id = %s", (image_url, medicine_id))
            if cur.rowcount == 0:
                raise ContractError("MEDICINE_NOT_FOUND", "Medicine was not found", http_status=404)
        if sort_order is not None:
            cur.execute(
                """
                UPDATE product_carousel_items
                SET sort_order = %s, updated_at = CURRENT_TIMESTAMP
                WHERE carousel_id = %s AND medicine_id = %s
                """,
                (sort_order, carousel_id, medicine_id),
            )
            item_exists = cur.rowcount > 0
        else:
            cur.execute(
                "SELECT 1 FROM product_carousel_items WHERE carousel_id = %s AND medicine_id = %s",
                (carousel_id, medicine_id),
            )
            item_exists = cur.fetchone() is not None
        if not item_exists:
            raise ContractError("CAROUSEL_PRODUCT_NOT_FOUND", "Carousel product was not found", http_status=404)
    return {"carousel_id": carousel_id, "medicine_id": medicine_id, "sort_order": sort_order, "image_url": image_url}


def delete_product_carousel_item(carousel_id: int, medicine_id: int) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            "DELETE FROM product_carousel_items WHERE carousel_id = %s AND medicine_id = %s",
            (carousel_id, medicine_id),
        )
        if cur.rowcount == 0:
            raise ContractError("CAROUSEL_PRODUCT_NOT_FOUND", "Carousel product was not found", http_status=404)
    return {"carousel_id": carousel_id, "medicine_id": medicine_id, "deleted": True}


def reorder_product_carousel_items(carousel_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    if set(payload) != {"medicine_ids"} or not isinstance(payload["medicine_ids"], list):
        raise ContractError("VALIDATION_ERROR", "medicine_ids must be an array")
    medicine_ids = payload["medicine_ids"]
    if len(medicine_ids) > 100 or any(
        isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in medicine_ids
    ) or len(set(medicine_ids)) != len(medicine_ids):
        raise ContractError("VALIDATION_ERROR", "medicine_ids must contain unique positive integers")
    with transaction() as cur:
        cur.execute(
            """
            SELECT medicine_id FROM product_carousel_items
            WHERE carousel_id = %s FOR UPDATE
            """,
            (carousel_id,),
        )
        existing = {int(row["medicine_id"]) for row in cur.fetchall()}
        if existing != set(medicine_ids):
            raise ContractError(
                "CAROUSEL_CHANGED",
                "Carousel contents changed; refresh before reordering",
                http_status=409,
            )
        if medicine_ids:
            cur.execute(
                """
                UPDATE product_carousel_items AS item
                SET sort_order = ordered.position * 10,
                    updated_at = CURRENT_TIMESTAMP
                FROM unnest(%s::bigint[]) WITH ORDINALITY AS ordered(medicine_id, position)
                WHERE item.carousel_id = %s AND item.medicine_id = ordered.medicine_id
                """,
                (medicine_ids, carousel_id),
            )
    return {"carousel_id": carousel_id, "medicine_ids": medicine_ids}


def reorder_product_carousel_page(
    carousel_id: int, payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    medicine_ids = _id_batch(payload, "medicine_ids")
    with transaction() as cur:
        cur.execute(
            """
            SELECT medicine_id, sort_order
            FROM product_carousel_items
            WHERE carousel_id = %s AND medicine_id = ANY(%s::bigint[])
            ORDER BY sort_order ASC, id ASC
            FOR UPDATE
            """,
            (carousel_id, medicine_ids),
        )
        existing_rows = cur.fetchall()
        if len(existing_rows) != len(medicine_ids):
            raise ContractError("CAROUSEL_CHANGED", "Carousel contents changed; refresh before reordering", http_status=409)
        sort_orders = [int(row["sort_order"]) for row in existing_rows]
        cur.execute(
            """
            UPDATE product_carousel_items AS item
            SET sort_order = ordered.sort_order,
                updated_at = CURRENT_TIMESTAMP
            FROM unnest(%s::bigint[], %s::integer[]) AS ordered(medicine_id, sort_order)
            WHERE item.carousel_id = %s AND item.medicine_id = ordered.medicine_id
            """,
            (medicine_ids, sort_orders, carousel_id),
        )
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="carousel.products.reorder_page",
            resource_type="product_carousel",
            resource_id=str(carousel_id),
            request=current_request_id,
            details={"medicine_ids": medicine_ids},
        )
    return {"carousel_id": carousel_id, "medicine_ids": medicine_ids}


def reorder_product_carousels(
    payload: dict[str, Any], actor_id: str, current_request_id: str,
) -> dict[str, Any]:
    carousel_ids = _id_batch(payload, "carousel_ids")
    with transaction() as cur:
        cur.execute("SELECT id FROM product_carousels FOR UPDATE")
        existing = {int(row["id"]) for row in cur.fetchall()}
        if existing != set(carousel_ids):
            raise ContractError("CAROUSELS_CHANGED", "Carousels changed; refresh before reordering", http_status=409)
        cur.execute(
            """
            UPDATE product_carousels AS carousel
            SET sort_order = ordered.position * 10,
                updated_at = CURRENT_TIMESTAMP
            FROM unnest(%s::bigint[]) WITH ORDINALITY AS ordered(carousel_id, position)
            WHERE carousel.id = ordered.carousel_id
            """,
            (carousel_ids,),
        )
        _write_admin_audit(
            cur,
            actor_id=actor_id,
            action="product_carousels.reorder",
            resource_type="product_carousels",
            resource_id="all",
            request=current_request_id,
            details={"carousel_ids": carousel_ids},
        )
    return {"carousel_ids": carousel_ids}


def list_syncs(query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    with transaction() as cur:
        cur.execute(
            """
            SELECT sync_id, source_id, status, expected_row_count, received_row_count,
                   inserted_count, updated_count, in_stock_count, out_of_stock_count,
                   conflict_count, error_code, source_updated_at, created_at,
                   started_at, completed_at
            FROM catalog_syncs ORDER BY created_at DESC, sync_id DESC LIMIT %s
            """,
            (limit,),
        )
        rows = [dict(row) for row in cur.fetchall()]
        cur.execute(
            """
            SELECT id, sync_id::text AS direct_sync_id,
                   sync_time AT TIME ZONE 'UTC' AS sync_time,
                   upserted_count, in_stock_count, out_of_stock_count
            FROM sync_logs ORDER BY id DESC LIMIT %s
            """,
            (limit,),
        )
        for legacy in cur.fetchall():
            rows.append({
                "sync_id": legacy["direct_sync_id"] or f"legacy_{legacy['id']}",
                "source_id": "direct-dbf-agent" if legacy["direct_sync_id"] else "legacy-agent",
                "status": "succeeded",
                "expected_row_count": legacy["upserted_count"] or 0,
                "received_row_count": legacy["upserted_count"] or 0,
                "inserted_count": 0,
                "updated_count": legacy["upserted_count"] or 0,
                "in_stock_count": legacy["in_stock_count"] or 0,
                "out_of_stock_count": legacy["out_of_stock_count"] or 0,
                "conflict_count": 0,
                "error_code": None,
                "source_updated_at": legacy["sync_time"],
                "created_at": legacy["sync_time"],
                "started_at": legacy["sync_time"],
                "completed_at": legacy["sync_time"],
            })
    rows.sort(key=lambda row: row["created_at"].isoformat(), reverse=True)
    rows = rows[:limit]
    return {"data": rows, "page": {"next_cursor": None, "has_more": len(rows) == limit}}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    current_request_id = request_id()
    try:
        # Staff calls never inherit the admin service identity. Only these exact
        # read routes are reachable, with a current DB-backed employee session.
        staff_path = str(event.get("path") or "")
        staff_method = str(event.get("httpMethod") or "").upper()
        if staff_path.startswith("/v1/staff/"):
            staff_accounts.require_service(event)
            if staff_method == "POST" and staff_path == "/v1/staff/login":
                return success(staff_accounts.login(_body(event)), request=current_request_id)
            if staff_method == "GET" and staff_path == "/v1/staff/session":
                return success(staff_accounts.session_account(event), request=current_request_id)
            if staff_method == "GET" and staff_path in {"/v1/staff/medicines", "/v1/staff/catalog/stats"}:
                staff_accounts.session_account(event, catalog=True)
                if staff_path == "/v1/staff/medicines":
                    return success_document(list_medicines(event.get("queryStringParameters") or {}), request=current_request_id)
                return success(catalog_stats(), request=current_request_id)
            if staff_method == "GET" and staff_path == "/v1/staff/order-medicines":
                staff_accounts.session_account(event, courier=True)
                return success_document(
                    search_staff_order_medicines(event.get("queryStringParameters") or {}),
                    request=current_request_id,
                )
            if staff_method == "GET" and staff_path == "/v1/staff/orders":
                account = staff_accounts.session_account(event)
                query = event.get("queryStringParameters") or {}
                if account["account_id"] == 3:
                    return success_document(list_courier_orders(query), request=current_request_id)
                return success_document(
                    list_pharmacy_preparation_orders(query, account["account_id"]), request=current_request_id,
                )
            if staff_method == "GET" and staff_path == "/v1/staff/earnings":
                staff_accounts.session_account(event, courier=True)
                return success(courier_earnings(event.get("queryStringParameters") or {}), request=current_request_id)
            if staff_method == "POST" and staff_path == "/v1/staff/orders":
                account = staff_accounts.session_account(event, courier=True)
                headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
                result, status_code, notification = create_staff_order(
                    _body(event), str(headers.get("idempotency-key") or ""), account, current_request_id,
                )
                payload = {**result, "_notification": notification} if notification else result
                return success(payload, status_code=status_code, request=current_request_id)
            answers_match = re.fullmatch(
                r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/pharmacy-answers", staff_path)
            if staff_method == "POST" and answers_match:
                account = staff_accounts.session_account(event, pharmacy=True)
                # The result may carry `_notification` (job 013); the Next.js route strips it before the browser.
                return success(answer_pharmacy_order_items(answers_match.group(1), _body(event),
                    account["account_id"], current_request_id), request=current_request_id)
            collect_match = re.fullmatch(
                r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/assembly/items", staff_path)
            if staff_method == "POST" and collect_match:
                account = staff_accounts.session_account(event, pharmacy=True)
                return success(collect_pharmacy_order_item(collect_match.group(1), _body(event),
                    account["account_id"], current_request_id), request=current_request_id)
            assembly_match = re.fullmatch(
                r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/assembly", staff_path)
            if staff_method == "POST" and assembly_match:
                account = staff_accounts.session_account(event, pharmacy=True)
                return success(mark_pharmacy_assembly(assembly_match.group(1), _body(event),
                    account["account_id"], current_request_id), request=current_request_id)
            items_match = re.fullmatch(r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/items", staff_path)
            if staff_method == "POST" and items_match:
                staff_accounts.session_account(event, courier=True)
                headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
                return success(add_courier_order_items(items_match.group(1), _body(event),
                    str(headers.get("idempotency-key") or ""), current_request_id), request=current_request_id)
            manual_match = re.fullmatch(r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/manual-items", staff_path)
            if staff_method == "POST" and manual_match:
                staff_accounts.session_account(event, courier=True)
                headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
                return success(add_manual_order_items(manual_match.group(1), _body(event),
                    str(headers.get("idempotency-key") or ""), current_request_id, "staff:3"), request=current_request_id)
            order_match = re.fullmatch(r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)", staff_path)
            if staff_method == "GET" and order_match:
                staff_accounts.session_account(event, courier=True)
                return success(get_courier_order(order_match.group(1)), request=current_request_id)
            item_match = re.fullmatch(
                r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/items/([1-9][0-9]{0,17})", staff_path)
            if staff_method in {"PATCH", "DELETE"} and item_match:
                staff_accounts.session_account(event, courier=True)
                return success(update_courier_order_item(
                    item_match.group(1), int(item_match.group(2)),
                    _body(event) if staff_method == "PATCH" else None, current_request_id,
                ), request=current_request_id)
            customer_match = re.fullmatch(r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/customer", staff_path)
            if staff_method == "PATCH" and customer_match:
                staff_accounts.session_account(event, courier=True)
                return success(update_courier_order_customer(customer_match.group(1), _body(event),
                    current_request_id), request=current_request_id)
            checklist_match = re.fullmatch(
                r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/checklist", staff_path)
            if staff_method == "PATCH" and checklist_match:
                staff_accounts.session_account(event, courier=True)
                return success(update_courier_order_checklist(checklist_match.group(1), _body(event),
                    current_request_id), request=current_request_id)
            status_match = re.fullmatch(r"/v1/staff/orders/(ord_[0-9a-f]{32}|legacy_[1-9][0-9]*)/status", staff_path)
            if staff_method == "PATCH" and status_match:
                staff_accounts.session_account(event, courier=True)
                courier_payload = _body(event)
                if set(courier_payload) == {"delivery_courier_amount"}:
                    return success(update_order_delivery(
                        status_match.group(1), courier_payload, "staff:3", current_request_id, courier=True,
                    ), request=current_request_id)
                return success(update_courier_order_status(
                    status_match.group(1), courier_payload, current_request_id,
                ), request=current_request_id)
            raise ContractError("ROUTE_NOT_FOUND", "Route was not found", http_status=404)
        if staff_method == "POST" and staff_path == "/v1/admin/order-notification-deliveries/claim":
            require_notification_claim_identity(event)
            return success(claim_order_notification(_body(event)), request=current_request_id)
        actor_id = require_admin_identity(event)
        method = str(event.get("httpMethod") or "").upper()
        path = str(event.get("path") or "")
        query = event.get("queryStringParameters") or {}
        parts = [part for part in path.strip("/").split("/") if part]
        tail = parts[parts.index("admin") + 1:] if "admin" in parts else []
        if method == "GET" and tail == ["staff"]:
            return success(staff_accounts.list_accounts(), request=current_request_id)
        if method == "PATCH" and len(tail) == 2 and tail[0] == "staff":
            return success(staff_accounts.update_account(_positive_int(tail[1], "account_id"),
                _body(event), actor_id, current_request_id, _write_admin_audit), request=current_request_id)
        if method == "GET" and tail == ["dashboard"]:
            return success(dashboard_summary(query), request=current_request_id)
        if method == "GET" and tail == ["order-notification-settings"]:
            return success(get_order_notification_settings(), request=current_request_id)
        if method == "POST" and tail == ["order-notification-preview"]:
            return success(preview_order_notifications(_body(event)), request=current_request_id)
        if method == "PATCH" and tail == ["order-notification-settings"]:
            return success(update_order_notification_settings(_body(event), actor_id, current_request_id), request=current_request_id)
        if method == "GET" and tail == ["pricing-settings"]:
            return success(get_pricing_settings(), request=current_request_id)
        if method == "PATCH" and tail == ["pricing-settings"]:
            return success(
                update_pricing_settings(_body(event), actor_id, current_request_id),
                request=current_request_id,
            )
        if method == "GET" and tail == ["contact-settings"]:
            return success(get_contact_settings(), request=current_request_id)
        if method == "PATCH" and tail == ["contact-settings"]:
            return success(
                update_contact_settings(_body(event), actor_id, current_request_id),
                request=current_request_id,
            )
        if method == "GET" and tail == ["catalog", "stats"]:
            return success(catalog_stats(), request=current_request_id)
        if method == "GET" and tail == ["medicines"]:
            return success_document(list_medicines(query), request=current_request_id)
        if method == "GET" and tail == ["order-medicines"]:
            return success_document(search_staff_order_medicines(query), request=current_request_id)
        if method == "PATCH" and len(tail) == 3 and tail[0] == "medicines" and tail[2] == "image":
            return success(
                update_medicine_image(
                    _positive_int(tail[1], "medicine_id"), _body(event), actor_id, current_request_id,
                ),
                request=current_request_id,
            )
        if method == "GET" and tail == ["medicines", "out-of-stock-export"]:
            return success(export_out_of_stock_medicines(), request=current_request_id)
        if method == "GET" and tail == ["medicines", "available-export"]:
            return success(export_available_medicines(event, query), request=current_request_id)
        if method == "GET" and tail == ["medicine-duplicates"]:
            return success_document(list_medicine_duplicates(query), request=current_request_id)
        if method == "GET" and path.endswith("/admin/orders"):
            return success_document(list_orders(query), request=current_request_id)
        if method == "GET" and tail == ["orders", "insights"]:
            return success(orders_insights(query), request=current_request_id)
        if method == "GET" and tail == ["orders", "insights", "orders"]:
            return success_document(orders_insights_drilldown(query), request=current_request_id)
        if method == "GET" and tail == ["orders", "delivered-day"]:
            return success_document(delivered_orders_by_day(query), request=current_request_id)
        if method == "GET" and len(tail) == 2 and tail[0] == "orders":
            return success(get_order(tail[1]), request=current_request_id)
        if method == "PATCH" and len(tail) == 2 and tail[0] == "orders":
            return success(update_order_customer(tail[1], _body(event), actor_id, current_request_id), request=current_request_id)
        if method == "POST" and len(tail) == 3 and tail[0] == "orders" and tail[2] == "items":
            if not re.fullmatch(r"ord_[0-9a-f]{32}|legacy_[1-9][0-9]*", tail[1]):
                raise ContractError("VALIDATION_ERROR", "Неверный номер заказа")
            headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
            return success(add_courier_order_items(tail[1], _body(event),
                str(headers.get("idempotency-key") or ""), current_request_id, actor_id,
                allow_cancelled=True), request=current_request_id)
        if method == "POST" and len(tail) == 3 and tail[0] == "orders" and tail[2] == "manual-items":
            if not re.fullmatch(r"ord_[0-9a-f]{32}|legacy_[1-9][0-9]*", tail[1]):
                raise ContractError("VALIDATION_ERROR", "Неверный номер заказа")
            headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
            return success(add_manual_order_items(tail[1], _body(event),
                str(headers.get("idempotency-key") or ""), current_request_id, actor_id,
                allow_cancelled=True), request=current_request_id)
        if method == "PATCH" and len(tail) == 3 and tail[0] == "orders" and tail[2] == "item-adjustments":
            if not re.fullmatch(r"ord_[0-9a-f]{32}|legacy_[1-9][0-9]*", tail[1]):
                raise ContractError("VALIDATION_ERROR", "Неверный номер заказа")
            return success(adjust_admin_order_item(tail[1], _body(event), actor_id, current_request_id),
                           request=current_request_id)
        if method == "PATCH" and len(tail) == 3 and tail[0] == "orders" and tail[2] == "status":
            payload = _body(event)
            if "order_item_id" in payload:
                result = update_order_item_price(tail[1], payload, actor_id, current_request_id)
            elif "delivery_courier_amount" in payload:
                result = update_order_delivery(tail[1], payload, actor_id, current_request_id)
            else:
                result = update_order_status(tail[1], payload, actor_id)
            return success(result, request=current_request_id)
        if method == "DELETE" and len(tail) == 2 and tail[0] == "orders":
            return success(delete_order(tail[1], actor_id, current_request_id), request=current_request_id)
        if method == "GET" and path.endswith("/admin/categories"):
            return success_document(list_categories(query), request=current_request_id)
        if method == "POST" and path.endswith("/admin/categories"):
            return success(create_category(_body(event)), status_code=201, request=current_request_id)
        if method == "PATCH" and tail == ["categories", "reorder"]:
            return success(reorder_categories(_body(event), actor_id, current_request_id), request=current_request_id)
        if method == "PATCH" and len(tail) == 2 and tail[0] == "categories":
            return success(update_category(_positive_int(tail[1], "category_id"), _body(event)), request=current_request_id)
        if method == "DELETE" and len(tail) == 2 and tail[0] == "categories":
            return success(
                delete_category(_positive_int(tail[1], "category_id"), actor_id, current_request_id),
                request=current_request_id,
            )
        if method == "GET" and len(tail) == 3 and tail[0] == "categories" and tail[2] == "medicines":
            category_id = _positive_int(tail[1], "category_id")
            return success_document(list_category_medicines(category_id, query), request=current_request_id)
        if method == "GET" and len(tail) == 4 and tail[0] == "categories" and tail[2:] == ["medicines", "candidates"]:
            category_id = _positive_int(tail[1], "category_id")
            return success_document(search_category_medicine_candidates(category_id, query), request=current_request_id)
        if method in {"POST", "DELETE"} and len(tail) == 4 and tail[0] == "categories" and tail[2:] == ["medicines", "batch"]:
            category_id = _positive_int(tail[1], "category_id")
            result = (
                batch_add_category_medicines(category_id, _body(event), actor_id, current_request_id)
                if method == "POST"
                else batch_remove_category_medicines(category_id, _body(event), actor_id, current_request_id)
            )
            return success(result, request=current_request_id)
        if method == "GET" and len(tail) == 4 and tail[0] == "categories" and tail[2:] == ["medicines", "bulk-preview"]:
            category_id = _positive_int(tail[1], "category_id")
            return success_document(
                preview_category_medicine_bulk_add(category_id, query),
                request=current_request_id,
            )
        if method == "POST" and len(tail) == 4 and tail[0] == "categories" and tail[2:] == ["medicines", "bulk-add"]:
            category_id = _positive_int(tail[1], "category_id")
            return success(
                bulk_add_category_medicines(category_id, _body(event), actor_id, current_request_id),
                request=current_request_id,
            )
        if method in {"PUT", "DELETE"} and len(tail) == 4 and tail[0] == "categories" and tail[2] == "medicines":
            category_id = _positive_int(tail[1], "category_id")
            medicine_id = _positive_int(tail[3], "medicine_id")
            result = put_category_medicine(category_id, medicine_id) if method == "PUT" else delete_category_medicine(category_id, medicine_id)
            return success(result, request=current_request_id)
        if method == "GET" and path.endswith("/admin/catalog-syncs"):
            return success_document(list_syncs(query), request=current_request_id)
        if method == "GET" and tail == ["homepage-banners"]:
            return success_document(list_homepage_banners(), request=current_request_id)
        if method == "POST" and tail == ["media", "images"]:
            return success(
                upload_media_image(_body(event), actor_id, current_request_id),
                status_code=201,
                request=current_request_id,
            )
        if method == "PATCH" and len(tail) == 2 and tail[0] == "homepage-banners":
            return success(
                update_homepage_banner(tail[1], _body(event), actor_id, current_request_id),
                request=current_request_id,
            )
        if method == "GET" and tail == ["featured-products"]:
            return success_document(list_featured_products(), request=current_request_id)
        if method == "POST" and tail == ["featured-products"]:
            return success(create_featured_product(_body(event)), status_code=201, request=current_request_id)
        if method in {"PATCH", "DELETE"} and len(tail) == 2 and tail[0] == "featured-products":
            medicine_id = _positive_int(tail[1], "medicine_id")
            result = update_featured_product(medicine_id, _body(event)) if method == "PATCH" else delete_featured_product(medicine_id)
            return success(result, request=current_request_id)
        if method == "GET" and tail == ["collections"]:
            return success(collection_admin.list_collections(), request=current_request_id)
        if method == "POST" and tail == ["collections"]:
            return success(
                collection_admin.create_collection(_body(event), actor_id, current_request_id, _write_admin_audit),
                status_code=201, request=current_request_id,
            )
        if method == "POST" and tail == ["collections", "resolve-products"]:
            return success(collection_admin.resolve_products(_body(event)), request=current_request_id)
        if method == "GET" and tail == ["collection-stats"]:
            return success(collection_admin.collection_stats(query), request=current_request_id)
        if method == "POST" and tail == ["collection-stats", "reset"]:
            return success(
                collection_admin.reset_collection_stats(
                    _body(event), actor_id, current_request_id, _write_admin_audit,
                ),
                request=current_request_id,
            )
        if method in {"PATCH", "DELETE"} and len(tail) == 2 and tail[0] == "collections":
            collection_id = _positive_int(tail[1], "collection_id")
            result = (
                collection_admin.update_collection(collection_id, _body(event), actor_id, current_request_id, _write_admin_audit)
                if method == "PATCH"
                else collection_admin.delete_collection(collection_id, actor_id, current_request_id, _write_admin_audit)
            )
            return success(result, request=current_request_id)
        if method == "GET" and tail == ["product-carousels"]:
            return success_document(list_product_carousels(), request=current_request_id)
        if method == "POST" and tail == ["product-carousels"]:
            return success(create_product_carousel(_body(event)), status_code=201, request=current_request_id)
        if method == "PATCH" and tail == ["product-carousels", "reorder"]:
            return success(
                reorder_product_carousels(_body(event), actor_id, current_request_id),
                request=current_request_id,
            )
        if len(tail) == 2 and tail[0] == "product-carousels" and method in {"PATCH", "DELETE"}:
            carousel_id = _positive_int(tail[1], "carousel_id")
            result = update_product_carousel(carousel_id, _body(event)) if method == "PATCH" else delete_product_carousel(carousel_id)
            return success(result, request=current_request_id)
        if len(tail) == 3 and tail[0] == "product-carousels" and tail[2] == "products" and method == "POST":
            carousel_id = _positive_int(tail[1], "carousel_id")
            return success(add_product_carousel_item(carousel_id, _body(event)), status_code=201, request=current_request_id)
        if len(tail) == 3 and tail[0] == "product-carousels" and tail[2] == "products" and method == "GET":
            carousel_id = _positive_int(tail[1], "carousel_id")
            return success_document(list_product_carousel_items(carousel_id, query), request=current_request_id)
        if len(tail) == 3 and tail[0] == "product-carousels" and tail[2] == "candidates" and method == "GET":
            carousel_id = _positive_int(tail[1], "carousel_id")
            return success_document(search_product_carousel_candidates(carousel_id, query), request=current_request_id)
        if len(tail) == 4 and tail[0] == "product-carousels" and tail[2:] == ["products", "batch"] and method in {"POST", "DELETE"}:
            carousel_id = _positive_int(tail[1], "carousel_id")
            result = (
                batch_add_product_carousel_items(carousel_id, _body(event), actor_id, current_request_id)
                if method == "POST"
                else batch_remove_product_carousel_items(carousel_id, _body(event), actor_id, current_request_id)
            )
            return success(result, request=current_request_id)
        if len(tail) == 4 and tail[0] == "product-carousels" and tail[2:] == ["products", "reorder-page"] and method == "PATCH":
            carousel_id = _positive_int(tail[1], "carousel_id")
            return success(
                reorder_product_carousel_page(carousel_id, _body(event), actor_id, current_request_id),
                request=current_request_id,
            )
        if len(tail) == 4 and tail[0] == "product-carousels" and tail[2:] == ["products", "reorder"] and method == "PATCH":
            carousel_id = _positive_int(tail[1], "carousel_id")
            return success(reorder_product_carousel_items(carousel_id, _body(event)), request=current_request_id)
        if len(tail) == 4 and tail[0] == "product-carousels" and tail[2] == "products" and method in {"PATCH", "DELETE"}:
            carousel_id = _positive_int(tail[1], "carousel_id")
            medicine_id = _positive_int(tail[3], "medicine_id")
            result = (update_product_carousel_item(carousel_id, medicine_id, _body(event))
                      if method == "PATCH" else delete_product_carousel_item(carousel_id, medicine_id))
            return success(result, request=current_request_id)
        raise ContractError("ROUTE_NOT_FOUND", "Route was not found", http_status=404)
    except ContractError as exc:
        return error_response(exc, request=current_request_id)
    except psycopg2.IntegrityError:
        return error_response(ContractError("CONFLICT", "Resource conflicts with existing data", http_status=409), request=current_request_id)
    except psycopg2.Error as exc:
        LOGGER.error("Admin API database error request_id=%s pgcode=%s", current_request_id, exc.pgcode)
        return error_response(ContractError("INTERNAL_ERROR", "Internal server error", http_status=500), request=current_request_id)
    except Exception:
        LOGGER.error("Admin API unexpected error request_id=%s", current_request_id)
        return error_response(ContractError("INTERNAL_ERROR", "Internal server error", http_status=500), request=current_request_id)
