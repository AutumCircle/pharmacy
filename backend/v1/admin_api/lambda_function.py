"""Authenticated Pharmacy Vatan admin API v1 Lambda handler."""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import boto3
import psycopg2

from backend.v1.shared.contract import (
    ContractError,
    STATUS_TRANSITIONS,
    calculate_selling_unit_price,
    validate_status_transition,
)
from backend.v1.shared.authorization import require_admin_identity
from backend.v1.shared.database import transaction
from backend.v1.shared.responses import error_response, request_id, success, success_document
from backend.v1.shared.xlsx_export import build_out_of_stock_workbook


DEFAULT_LIMIT = 20
MAX_LIMIT = 100
MAX_EXPORT_ROWS = 25_000
DELETABLE_ORDER_STATUSES = frozenset({"pending", "cancelled"})
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
    if content_type not in MEDIA_IMAGE_TYPES or scope not in {"banners", "products"} or not isinstance(encoded, str):
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
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                COALESCE(SUM(COALESCE(items_subtotal, total_price, 0)) FILTER (
                    WHERE status = 'delivered'
                      AND created_at >= CURRENT_TIMESTAMP - (%s * INTERVAL '1 day')
                ), 0) AS sales_total
            FROM orders
            WHERE deleted_at IS NULL
            """,
            (days,),
        )
        row = dict(cur.fetchone())
    counts = {status: int(row[status] or 0) for status in STATUS_TRANSITIONS}
    return {
        "period_days": days,
        "order_counts": counts,
        "new_orders": counts["pending"],
        "active_orders": counts["pending"] + counts["confirmed"] + counts["delivering"],
        "sales_total": row["sales_total"],
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


def _order_lookup(order_id: str) -> tuple[str, tuple[Any, ...]]:
    if order_id.startswith("legacy_"):
        legacy_id = _positive_int(order_id.removeprefix("legacy_"), "order_id")
        return "id = %s AND public_id IS NULL", (legacy_id,)
    return "public_id = %s", (order_id,)


def list_orders(query: dict[str, Any]) -> dict[str, Any]:
    limit = _limit(query)
    clauses: list[str] = ["o.deleted_at IS NULL"]
    params: list[Any] = []
    status = query.get("status")
    if status:
        if status not in STATUS_TRANSITIONS:
            raise ContractError("VALIDATION_ERROR", "status is invalid")
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
                   o.payment_method, o.payment_status, o.notes, o.created_at
            FROM orders o
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
    return {"data": rows, "page": {"next_cursor": next_cursor, "has_more": has_more}}


def get_order(order_id: str) -> dict[str, Any]:
    lookup, lookup_values = _order_lookup(order_id)
    with transaction() as cur:
        cur.execute(
            f"""
            SELECT id, public_id, order_reference, customer_name, phone, address,
                   items_subtotal, order_total, currency, status, payment_method,
                   payment_status, notes, created_at
            FROM orders WHERE {lookup} AND deleted_at IS NULL
            """,
            lookup_values,
        )
        order = cur.fetchone()
        if not order:
            raise ContractError("ORDER_NOT_FOUND", "Order was not found", http_status=404)
        internal_id = order["id"]
        cur.execute(
            """
            SELECT medicine_id, medicine_name, base_unit_price, selling_unit_price,
                   quantity, line_total
            FROM order_items WHERE order_id = %s ORDER BY id ASC
            """,
            (internal_id,),
        )
        items = [dict(row) for row in cur.fetchall()]
        cur.execute(
            """
            SELECT from_status, to_status, actor_type, actor_id, reason, created_at
            FROM order_status_history WHERE order_id = %s ORDER BY id ASC
            """,
            (internal_id,),
        )
        history = [dict(row) for row in cur.fetchall()]
    result = dict(order)
    result["order_id"] = result.pop("public_id") or f"legacy_{result['id']}"
    result.pop("id")
    result["items"] = items
    result["status_history"] = history
    return result


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
                "Можно удалить только новый или отменённый заказ",
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
    if icon is not None and (not isinstance(icon, str) or len(icon) > 50):
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
        not isinstance(payload["icon"], str) or len(payload["icon"]) > 50
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
    cursor = _decode_cursor(query.get("cursor"))
    after_id = 0
    if cursor:
        try:
            after_id = int(cursor["medicine_id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "cursor is invalid") from exc
    with transaction() as cur:
        cur.execute("SELECT 1 FROM categories WHERE id = %s", (category_id,))
        if not cur.fetchone():
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute(
            """
            SELECT m.id AS medicine_id, m.name AS medicine_name, m.country, m.vendor,
                   m.in_stock, m.updated_at
            FROM category_medicines cm
            JOIN medicines m ON m.id = cm.medicine_id
            WHERE cm.category_id = %s AND m.id > %s
            ORDER BY m.id ASC LIMIT %s
            """,
            (category_id, after_id, limit + 1),
        )
        rows = [dict(row) for row in cur.fetchall()]
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _encode_cursor({"medicine_id": rows[-1]["medicine_id"]}) if has_more and rows else None
    return {"data": rows, "page": {"next_cursor": next_cursor, "has_more": has_more}}


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
            """
            SELECT slot, title, subtitle, image_url, link_url, is_active, updated_at
            FROM homepage_banners
            ORDER BY CASE slot
                WHEN 'left' THEN 1 WHEN 'center' THEN 2
                WHEN 'right_top' THEN 3 ELSE 4 END
            """
        )
        return {"data": [dict(row) for row in cur.fetchall()]}


def update_homepage_banner(slot: str, payload: dict[str, Any]) -> dict[str, Any]:
    allowed_slots = {"left", "center", "right_top", "right_bottom"}
    allowed = {"title", "subtitle", "image_url", "link_url", "is_active"}
    if slot not in allowed_slots:
        raise ContractError("BANNER_NOT_FOUND", "Banner was not found", http_status=404)
    if not payload or set(payload) - allowed:
        raise ContractError("VALIDATION_ERROR", "Invalid banner update")
    if "title" in payload and (
        not isinstance(payload["title"], str) or not 1 <= len(payload["title"].strip()) <= 120
    ):
        raise ContractError("VALIDATION_ERROR", "Banner title is invalid")
    if "subtitle" in payload and payload["subtitle"] is not None and (
        not isinstance(payload["subtitle"], str) or len(payload["subtitle"].strip()) > 240
    ):
        raise ContractError("VALIDATION_ERROR", "Banner subtitle is invalid")
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
    assignments = []
    values = []
    for field in ("title", "subtitle", "image_url", "link_url", "is_active"):
        if field in payload:
            value = payload[field]
            if isinstance(value, str):
                value = value.strip()
            if field in {"subtitle", "image_url", "link_url"} and value == "":
                value = None
            assignments.append(f"{field} = %s")
            values.append(value)
    values.append(slot)
    with transaction() as cur:
        cur.execute(
            f"""
            UPDATE homepage_banners
            SET {', '.join(assignments)}, updated_at = CURRENT_TIMESTAMP
            WHERE slot = %s
            RETURNING slot, title, subtitle, image_url, link_url, is_active, updated_at
            """,
            tuple(values),
        )
        row = cur.fetchone()
        if not row:
            raise ContractError("BANNER_NOT_FOUND", "Banner was not found", http_status=404)
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
            SELECT id, slug, title, is_active, sort_order, created_at, updated_at
            FROM product_carousels
            ORDER BY sort_order ASC, id ASC
            LIMIT 100
            """
        )
        carousel_rows = [dict(row) for row in cur.fetchall()]
        if not carousel_rows:
            return {"data": []}
        carousel_ids = [row["id"] for row in carousel_rows]
        cur.execute(
            """
            SELECT pci.carousel_id, m.id AS medicine_id, m.name AS medicine_name,
                   m.price AS base_unit_price,
                   vatan_selling_unit_price(m.price) AS selling_unit_price,
                   m.country, m.vendor, m.in_stock,
                   m.image_url, pci.sort_order AS item_sort_order,
                   pci.updated_at AS item_updated_at
            FROM product_carousel_items pci
            JOIN medicines m ON m.id = pci.medicine_id
            WHERE pci.carousel_id = ANY(%s)
            ORDER BY pci.carousel_id ASC, pci.sort_order ASC, pci.id ASC
            """,
            (carousel_ids,),
        )
        items: dict[int, list[dict[str, Any]]] = {}
        for row in cur.fetchall():
            raw = dict(row)
            items.setdefault(raw["carousel_id"], []).append(_carousel_product_response(raw))
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
                "products": items.get(row["id"], []),
            }
            for row in carousel_rows
        ]
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
    row["products"] = []
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
    if not row:
        raise ContractError("CAROUSEL_NOT_FOUND", "Carousel was not found", http_status=404)
    result = dict(row)
    result["products"] = []
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
        actor_id = require_admin_identity(event)
        method = str(event.get("httpMethod") or "").upper()
        path = str(event.get("path") or "")
        query = event.get("queryStringParameters") or {}
        parts = [part for part in path.strip("/").split("/") if part]
        tail = parts[parts.index("admin") + 1:] if "admin" in parts else []
        if method == "GET" and tail == ["dashboard"]:
            return success(dashboard_summary(query), request=current_request_id)
        if method == "GET" and tail == ["pricing-settings"]:
            return success(get_pricing_settings(), request=current_request_id)
        if method == "PATCH" and tail == ["pricing-settings"]:
            return success(
                update_pricing_settings(_body(event), actor_id, current_request_id),
                request=current_request_id,
            )
        if method == "GET" and tail == ["catalog", "stats"]:
            return success(catalog_stats(), request=current_request_id)
        if method == "GET" and tail == ["medicines"]:
            return success_document(list_medicines(query), request=current_request_id)
        if method == "GET" and tail == ["medicines", "out-of-stock-export"]:
            return success(export_out_of_stock_medicines(), request=current_request_id)
        if method == "GET" and tail == ["medicine-duplicates"]:
            return success_document(list_medicine_duplicates(query), request=current_request_id)
        if method == "GET" and path.endswith("/admin/orders"):
            return success_document(list_orders(query), request=current_request_id)
        if method == "GET" and len(tail) == 2 and tail[0] == "orders":
            return success(get_order(tail[1]), request=current_request_id)
        if method == "PATCH" and len(tail) == 3 and tail[0] == "orders" and tail[2] == "status":
            return success(update_order_status(tail[1], _body(event), actor_id), request=current_request_id)
        if method == "DELETE" and len(tail) == 2 and tail[0] == "orders":
            return success(delete_order(tail[1], actor_id, current_request_id), request=current_request_id)
        if method == "GET" and path.endswith("/admin/categories"):
            return success_document(list_categories(query), request=current_request_id)
        if method == "POST" and path.endswith("/admin/categories"):
            return success(create_category(_body(event)), status_code=201, request=current_request_id)
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
            return success(update_homepage_banner(tail[1], _body(event)), request=current_request_id)
        if method == "GET" and tail == ["featured-products"]:
            return success_document(list_featured_products(), request=current_request_id)
        if method == "POST" and tail == ["featured-products"]:
            return success(create_featured_product(_body(event)), status_code=201, request=current_request_id)
        if method in {"PATCH", "DELETE"} and len(tail) == 2 and tail[0] == "featured-products":
            medicine_id = _positive_int(tail[1], "medicine_id")
            result = update_featured_product(medicine_id, _body(event)) if method == "PATCH" else delete_featured_product(medicine_id)
            return success(result, request=current_request_id)
        if method == "GET" and tail == ["product-carousels"]:
            return success_document(list_product_carousels(), request=current_request_id)
        if method == "POST" and tail == ["product-carousels"]:
            return success(create_product_carousel(_body(event)), status_code=201, request=current_request_id)
        if len(tail) == 2 and tail[0] == "product-carousels" and method in {"PATCH", "DELETE"}:
            carousel_id = _positive_int(tail[1], "carousel_id")
            result = update_product_carousel(carousel_id, _body(event)) if method == "PATCH" else delete_product_carousel(carousel_id)
            return success(result, request=current_request_id)
        if len(tail) == 3 and tail[0] == "product-carousels" and tail[2] == "products" and method == "POST":
            carousel_id = _positive_int(tail[1], "carousel_id")
            return success(add_product_carousel_item(carousel_id, _body(event)), status_code=201, request=current_request_id)
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
        LOGGER.exception("Admin API database error request_id=%s pgcode=%s", current_request_id, exc.pgcode)
        return error_response(ContractError("INTERNAL_ERROR", "Internal server error", http_status=500), request=current_request_id)
    except Exception:
        LOGGER.exception("Admin API unexpected error request_id=%s", current_request_id)
        return error_response(ContractError("INTERNAL_ERROR", "Internal server error", http_status=500), request=current_request_id)
