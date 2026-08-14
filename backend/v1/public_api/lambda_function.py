"""Public API v1 Lambda handler.

Deploy only after db/migrations/0001_api_v1_foundation.sql has been reviewed
and applied to a non-production database.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from decimal import Decimal
from typing import Any
from uuid import uuid4

import psycopg2

from backend.v1.shared.contract import (
    ContractError,
    calculate_selling_unit_price,
    normalize_phone,
    validate_create_order_request,
    validate_idempotency_key,
)
from backend.v1.shared.database import transaction
from backend.v1.shared.responses import error_response, request_id, success, success_document


MAX_PAGE_SIZE = 100
DEFAULT_PAGE_SIZE = 20
MINIMUM_ORDER_SUBTOTAL = 50


def _body(event: dict[str, Any]) -> dict[str, Any]:
    body = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")
    if isinstance(body, str):
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError as exc:
            raise ContractError("VALIDATION_ERROR", "Malformed JSON request body") from exc
    else:
        parsed = body
    if not isinstance(parsed, dict):
        raise ContractError("VALIDATION_ERROR", "Request body must be a JSON object")
    return parsed


def _headers(event: dict[str, Any]) -> dict[str, str]:
    raw = event.get("headers") or {}
    return {str(key).lower(): str(value) for key, value in raw.items() if value is not None}


def _page_size(query: dict[str, Any]) -> int:
    raw = query.get("limit") or DEFAULT_PAGE_SIZE
    try:
        limit = int(raw)
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"limit": "must be an integer"}) from exc
    if not 1 <= limit <= MAX_PAGE_SIZE:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"limit": f"must be between 1 and {MAX_PAGE_SIZE}"},
        )
    return limit


def _encode_cursor(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return base64.urlsafe_b64encode(encoded).decode("ascii")


def _decode_cursor(value: str | None) -> dict[str, Any] | None:
    if not value:
        return None
    try:
        return json.loads(base64.urlsafe_b64decode(value.encode("ascii")).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"cursor": "is invalid"},
        ) from exc


def _medicine_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "medicine_id": row["id"],
        "medicine_name": row["name"],
        "selling_unit_price": int(row.get("selling_unit_price") or calculate_selling_unit_price(row["price"])),
        "currency": "TJS",
        "country": row["country"] or None,
        "vendor": row["vendor"] or None,
        "in_stock": bool(row["in_stock"]),
        "catalog_updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
        "image_url": row.get("image_url"),
    }


def search_medicines(query: dict[str, Any]) -> dict[str, Any]:
    q = query.get("q")
    if not isinstance(q, str) or not 2 <= len(q.strip()) <= 120:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"q": "must contain between 2 and 120 characters"},
        )
    q = " ".join(q.split()).casefold()
    tokens = list(dict.fromkeys(re.findall(r"[^\W_]+", q, flags=re.UNICODE)))[:12]
    if not tokens:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"q": "must contain searchable letters or numbers"},
        )
    limit = _page_size(query)
    cursor = _decode_cursor(query.get("cursor"))
    offset = 0
    if cursor:
        offset = cursor.get("offset")
        if not isinstance(offset, int) or offset < 0 or offset > 100_000:
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"cursor": "is invalid"})

    params: list[Any] = [q, tokens]
    params.extend([limit + 1, offset])

    with transaction() as cur:
        cur.execute(
            f"""
            WITH search_input AS (
                SELECT %s::text AS q, %s::text[] AS tokens
            ),
            ranked AS MATERIALIZED (
                SELECT m.id, m.name, m.price, m.country, m.vendor, m.in_stock,
                       m.updated_at, m.image_url,
                       vatan_selling_unit_price(m.price) AS selling_unit_price,
                       ROUND((
                           CASE
                               WHEN lower(m.name) = input.q THEN 10000
                               WHEN lower(m.name) LIKE input.q || '%%' THEN 8000
                               WHEN lower(m.name) LIKE '%%' || input.q || '%%' THEN 7000
                               ELSE 0
                           END
                           + 700 * (
                               SELECT COUNT(*)
                               FROM unnest(input.tokens) AS token
                               WHERE lower(m.name) LIKE '%%' || token || '%%'
                           )
                           + 100 * COALESCE((
                               SELECT SUM(
                                   CASE
                                       WHEN lower(m.name) LIKE '%%' || token || '%%' THEN 1.0
                                       WHEN length(token) >= 3 THEN word_similarity(token, lower(m.name))
                                       ELSE 0.0
                                   END
                               )
                               FROM unnest(input.tokens) AS token
                           ), 0)
                           + 200 * similarity(lower(m.name), input.q)
                       )::numeric, 6) AS relevance
                FROM medicines AS m
                CROSS JOIN search_input AS input
                WHERE m.in_stock IS TRUE
                  AND (
                      m.name ILIKE '%%' || input.q || '%%'
                      OR m.name %% input.q
                      OR EXISTS (
                          SELECT 1
                          FROM unnest(input.tokens) AS token
                          WHERE m.name ILIKE '%%' || token || '%%'
                             OR (length(token) >= 3 AND word_similarity(token, m.name) >= 0.30)
                      )
                  )
            )
            SELECT id, name, price, country, vendor, in_stock, updated_at, image_url,
                   selling_unit_price, relevance
            FROM ranked
            ORDER BY relevance DESC, name ASC, id ASC
            LIMIT %s
            OFFSET %s
            """,
            tuple(params),
        )
        rows = [dict(row) for row in cur.fetchall()]

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _encode_cursor({"offset": offset + limit}) if has_more else None
    previous_cursor = _encode_cursor({"offset": max(0, offset - limit)}) if offset > 0 else None
    return {
        "data": [_medicine_response(row) for row in rows],
        "page": {
            "next_cursor": next_cursor,
            "previous_cursor": previous_cursor,
            "has_more": has_more,
        },
    }


def get_medicine(medicine_id: str) -> dict[str, Any]:
    try:
        parsed_id = int(medicine_id)
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "Medicine ID must be a positive integer") from exc
    if parsed_id <= 0:
        raise ContractError("VALIDATION_ERROR", "Medicine ID must be a positive integer")
    with transaction() as cur:
        cur.execute(
            """
            SELECT id, name, price, country, vendor, in_stock, updated_at, image_url,
                   vatan_selling_unit_price(price) AS selling_unit_price
            FROM medicines
            WHERE id = %s AND in_stock IS TRUE
            """,
            (parsed_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ContractError("MEDICINE_NOT_FOUND", "Medicine was not found", http_status=404)
    return _medicine_response(dict(row))


def list_homepage_banners() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT slot, title, subtitle, image_url, link_url
            FROM homepage_banners
            WHERE is_active IS TRUE
            ORDER BY CASE slot
                WHEN 'left' THEN 1 WHEN 'center' THEN 2
                WHEN 'right_top' THEN 3 ELSE 4 END
            """
        )
        return {"banners": [dict(row) for row in cur.fetchall()]}


def list_featured_products() -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT m.id, m.name, m.price, m.country, m.vendor, m.in_stock, m.updated_at,
                   vatan_selling_unit_price(m.price) AS selling_unit_price,
                   fp.image_url, COALESCE(fp.sort_order, 0) AS sort_order
            FROM featured_products fp
            JOIN medicines m ON m.id = fp.medicine_id
            WHERE m.in_stock IS TRUE
            ORDER BY COALESCE(fp.sort_order, 0) ASC, fp.id ASC
            LIMIT 30
            """
        )
        products = []
        for raw_row in cur.fetchall():
            row = dict(raw_row)
            product = _medicine_response(row)
            product["image_url"] = row["image_url"]
            product["sort_order"] = int(row["sort_order"])
            products.append(product)
        return {"products": products}


def list_product_carousels() -> dict[str, Any]:
    """Return active carousel sections and their in-stock products in one query."""
    with transaction() as cur:
        cur.execute(
            """
            SELECT pc.id, pc.slug, pc.title, pc.sort_order
            FROM product_carousels pc
            WHERE pc.is_active IS TRUE
            ORDER BY pc.sort_order ASC, pc.id ASC
            LIMIT 20
            """
        )
        carousel_rows = [dict(row) for row in cur.fetchall()]
        if not carousel_rows:
            return {"carousels": []}
        carousel_ids = [row["id"] for row in carousel_rows]
        cur.execute(
            """
            SELECT ranked.carousel_id, ranked.id, ranked.name, ranked.price,
                   ranked.country, ranked.vendor, ranked.in_stock, ranked.updated_at,
                   ranked.image_url, ranked.selling_unit_price, ranked.item_sort_order
            FROM (
                SELECT pci.carousel_id, m.id, m.name, m.price, m.country, m.vendor,
                       m.in_stock, m.updated_at, m.image_url,
                       vatan_selling_unit_price(m.price) AS selling_unit_price,
                       pci.sort_order AS item_sort_order,
                       ROW_NUMBER() OVER (
                           PARTITION BY pci.carousel_id
                           ORDER BY pci.sort_order ASC, pci.id ASC
                       ) AS position
                FROM product_carousel_items pci
                JOIN medicines m ON m.id = pci.medicine_id
                WHERE pci.carousel_id = ANY(%s) AND m.in_stock IS TRUE
            ) AS ranked
            WHERE ranked.position <= 30
            ORDER BY ranked.carousel_id ASC, ranked.item_sort_order ASC, ranked.id ASC
            """,
            (carousel_ids,),
        )
        products_by_carousel: dict[int, list[dict[str, Any]]] = {}
        for raw_row in cur.fetchall():
            row = dict(raw_row)
            product = _medicine_response(row)
            product["sort_order"] = int(row["item_sort_order"] or 0)
            products_by_carousel.setdefault(row["carousel_id"], []).append(product)
    return {
        "carousels": [
            {
                "slug": row["slug"],
                "title": row["title"],
                "sort_order": int(row["sort_order"]),
                "products": products_by_carousel.get(row["id"], []),
            }
            for row in carousel_rows
        ]
    }


def resolve_medicines(payload: dict[str, Any]) -> dict[str, Any]:
    if set(payload) != {"medicine_ids"} or not isinstance(payload["medicine_ids"], list):
        raise ContractError("VALIDATION_ERROR", "medicine_ids must be an array")
    medicine_ids = payload["medicine_ids"]
    if not 1 <= len(medicine_ids) <= 50 or any(
        isinstance(value, bool) or not isinstance(value, int) or value <= 0 for value in medicine_ids
    ):
        raise ContractError("VALIDATION_ERROR", "medicine_ids must contain 1 to 50 positive integers")
    if len(set(medicine_ids)) != len(medicine_ids):
        raise ContractError("VALIDATION_ERROR", "medicine_ids must be unique")
    with transaction() as cur:
        cur.execute(
            """
            SELECT id, name, price, country, vendor, in_stock, updated_at, image_url,
                   vatan_selling_unit_price(price) AS selling_unit_price
            FROM medicines
            WHERE id = ANY(%s)
            ORDER BY id ASC
            """,
            (medicine_ids,),
        )
        rows = [dict(row) for row in cur.fetchall()]
    found_ids = {row["id"] for row in rows}
    return {
        "medicines": [_medicine_response(row) for row in rows],
        "missing_medicine_ids": [medicine_id for medicine_id in medicine_ids if medicine_id not in found_ids],
    }


def _order_response(order: dict[str, Any], items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "order_id": order["public_id"],
        "order_reference": order["order_reference"],
        "status": order["status"],
        "payment_method": "cash_on_delivery",
        "payment_status": "unpaid",
        "currency": "TJS",
        "items": items,
        "items_subtotal": int(order["items_subtotal"]),
        "order_total": int(order["order_total"]),
        "created_at": order["created_at"].isoformat(),
    }


def create_order(payload: dict[str, Any], idempotency_key: str) -> tuple[dict[str, Any], int]:
    request = validate_create_order_request(payload)
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
        reservation = cur.fetchone()
        if not reservation:
            cur.execute(
                """
                SELECT request_hash, response_status, response_body
                FROM order_idempotency
                WHERE idempotency_key = %s
                FOR UPDATE
                """,
                (normalized_key,),
            )
            existing = cur.fetchone()
            if not existing or existing["request_hash"] != request_hash:
                raise ContractError("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different request", http_status=409)
            if existing["response_body"] is None:
                raise ContractError("IDEMPOTENCY_IN_PROGRESS", "Order request is still being processed", http_status=409)
            return existing["response_body"], int(existing["response_status"])

        medicine_ids = [item["medicine_id"] for item in request["items"]]
        cur.execute(
            """
            SELECT id, name, price, in_stock,
                   vatan_selling_unit_price(price) AS selling_unit_price
            FROM medicines
            WHERE id = ANY(%s)
            FOR UPDATE
            """,
            (medicine_ids,),
        )
        medicines = {row["id"]: dict(row) for row in cur.fetchall()}
        missing = [medicine_id for medicine_id in medicine_ids if medicine_id not in medicines]
        if missing:
            raise ContractError("MEDICINE_NOT_FOUND", "One or more medicines were not found", http_status=404)
        unavailable = [medicine_id for medicine_id in medicine_ids if not medicines[medicine_id]["in_stock"]]
        if unavailable:
            raise ContractError("ORDER_ITEMS_UNAVAILABLE", "One or more medicines are unavailable", http_status=409)

        order_items: list[dict[str, Any]] = []
        subtotal = 0
        for item in request["items"]:
            medicine = medicines[item["medicine_id"]]
            selling_price = int(medicine["selling_unit_price"])
            line_total = selling_price * item["quantity"]
            subtotal += line_total
            order_items.append({
                "medicine_id": medicine["id"],
                "medicine_name": medicine["name"],
                "quantity": item["quantity"],
                "base_unit_price": Decimal(str(medicine["price"])),
                "selling_unit_price": selling_price,
                "line_total": line_total,
            })

        if subtotal < MINIMUM_ORDER_SUBTOTAL:
            raise ContractError("MINIMUM_ORDER_NOT_REACHED", "Order subtotal is below 50 TJS", http_status=422)

        public_id = f"ord_{uuid4().hex}"
        cur.execute(
            """
            INSERT INTO orders (
                user_id, customer_name, phone, phone_normalized, address, notes,
                total_price, items_subtotal, order_total, public_id, status,
                payment_method, payment_status, currency
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending',
                    'cash_on_delivery', 'unpaid', 'TJS')
            RETURNING id, public_id, status, items_subtotal, order_total, created_at
            """,
            (
                None, request["customer_name"], request["phone"], request["phone"], request["address"], request["comment"],
                subtotal, subtotal, subtotal, public_id,
            ),
        )
        order = dict(cur.fetchone())
        order_reference = f"{request['phone'][-4:]}-{order['id']:03d}"
        cur.execute("UPDATE orders SET order_reference = %s WHERE id = %s", (order_reference, order["id"]))
        order["order_reference"] = order_reference

        response_items: list[dict[str, Any]] = []
        for item in order_items:
            cur.execute(
                """
                INSERT INTO order_items (
                    order_id, medicine_id, medicine_name, price, quantity,
                    base_unit_price, selling_unit_price, line_total
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    order["id"], item["medicine_id"], item["medicine_name"], item["selling_unit_price"], item["quantity"],
                    item["base_unit_price"], item["selling_unit_price"], item["line_total"],
                ),
            )
            response_items.append({key: item[key] for key in ("medicine_id", "medicine_name", "quantity", "selling_unit_price", "line_total")})

        cur.execute(
            """
            INSERT INTO order_status_history (order_id, from_status, to_status, actor_type)
            VALUES (%s, NULL, 'pending', 'customer')
            """,
            (order["id"],),
        )
        response = _order_response(order, response_items)
        cur.execute(
            """
            UPDATE order_idempotency
            SET order_id = %s, response_status = 201, response_body = %s::jsonb,
                completed_at = CURRENT_TIMESTAMP
            WHERE idempotency_key = %s
            """,
            (order["id"], json.dumps(response), normalized_key),
        )
        return response, 201


def list_categories(query: dict[str, Any]) -> dict[str, Any]:
    limit = _page_size(query)
    cursor = _decode_cursor(query.get("cursor"))
    params: list[Any] = []
    cursor_filter = ""
    if cursor:
        try:
            cursor_filter = "AND (sort_order, id) > (%s, %s)"
            params.extend([int(cursor["sort_order"]), int(cursor["id"])])
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"cursor": "is invalid"}) from exc
    params.append(limit + 1)
    with transaction() as cur:
        cur.execute(
            f"""
            SELECT id, slug, name, icon, color, sort_order
            FROM categories
            WHERE is_active IS TRUE {cursor_filter}
            ORDER BY sort_order ASC, id ASC
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
        next_cursor = _encode_cursor({"sort_order": last["sort_order"], "id": last["id"]})
    return {
        "data": [
            {key: row[key] for key in ("id", "slug", "name", "icon", "color")}
            for row in rows
        ],
        "page": {"next_cursor": next_cursor, "has_more": has_more},
    }


def category_medicines(slug: str, query: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(slug, str) or not slug.strip():
        raise ContractError("VALIDATION_ERROR", "Category slug is required")
    limit = _page_size(query)
    cursor = _decode_cursor(query.get("cursor"))
    cursor_filter = ""
    cursor_values: list[Any] = []
    if cursor:
        try:
            cursor_filter = "AND (m.name, m.id) > (%s, %s)"
            cursor_values = [str(cursor["name"]), int(cursor["id"])]
        except (KeyError, TypeError, ValueError) as exc:
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"cursor": "is invalid"}) from exc
    with transaction() as cur:
        cur.execute(
            "SELECT id, slug, name, icon, color FROM categories WHERE slug = %s AND is_active IS TRUE",
            (slug.strip(),),
        )
        category = cur.fetchone()
        if not category:
            raise ContractError("CATEGORY_NOT_FOUND", "Category was not found", http_status=404)
        cur.execute(
            """
            SELECT m.id, m.name, m.price, m.country, m.vendor, m.in_stock, m.updated_at, m.image_url,
                   vatan_selling_unit_price(m.price) AS selling_unit_price
            FROM category_medicines cm
            JOIN medicines m ON m.id = cm.medicine_id
            WHERE cm.category_id = %s AND m.in_stock IS TRUE {cursor_filter}
            ORDER BY m.name ASC, m.id ASC
            LIMIT %s
            """.format(cursor_filter=cursor_filter),
            (category["id"], *cursor_values, limit + 1),
        )
        medicines = [dict(row) for row in cur.fetchall()]
    has_more = len(medicines) > limit
    medicines = medicines[:limit]
    next_cursor = None
    if has_more and medicines:
        last = medicines[-1]
        next_cursor = _encode_cursor({"name": last["name"], "id": last["id"]})
    return {
        "data": {
            "id": category["id"], "slug": category["slug"], "name": category["name"],
            "icon": category["icon"], "color": category["color"],
            "medicines": [_medicine_response(row) for row in medicines],
        },
        "page": {"next_cursor": next_cursor, "has_more": has_more},
    }


def track_orders(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != {"phone"}:
        raise ContractError("VALIDATION_ERROR", "Only phone is accepted for order tracking")
    phone = normalize_phone(payload["phone"])
    with transaction() as cur:
        cur.execute(
            """
            SELECT id, public_id, order_reference, status, items_subtotal, order_total, created_at
            FROM orders
            WHERE phone_normalized = %s AND public_id IS NOT NULL AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC
            LIMIT 20
            """,
            (phone,),
        )
        orders = [dict(row) for row in cur.fetchall()]
        if not orders:
            return {"data": []}
        cur.execute(
            """
            SELECT order_id, medicine_id, medicine_name, selling_unit_price, quantity, line_total
            FROM order_items WHERE order_id = ANY(%s) ORDER BY id ASC
            """,
            ([row["id"] for row in orders],),
        )
        items_by_order: dict[int, list[dict[str, Any]]] = {}
        for row in cur.fetchall():
            item = dict(row)
            items_by_order.setdefault(item["order_id"], []).append({
                "medicine_id": item["medicine_id"], "medicine_name": item["medicine_name"],
                "selling_unit_price": item["selling_unit_price"], "quantity": item["quantity"],
                "line_total": item["line_total"],
            })
    return {"data": [_order_response(order, items_by_order.get(order["id"], [])) for order in orders]}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    current_request_id = request_id()
    method = event.get("httpMethod", "").upper()
    path = event.get("path", "")
    query = event.get("queryStringParameters") or {}
    parts = [part for part in path.strip("/").split("/") if part]
    tail = parts[parts.index("public") + 1:] if "public" in parts else []
    try:
        if method == "GET" and path.endswith("/public/medicines/search"):
            page = search_medicines(query)
            return success_document(page, request=current_request_id)
        if method == "POST" and path.endswith("/public/medicines/resolve"):
            return success(resolve_medicines(_body(event)), request=current_request_id)
        if method == "GET" and path.endswith("/public/homepage-banners"):
            return success(list_homepage_banners(), request=current_request_id)
        if method == "GET" and path.endswith("/public/featured-products"):
            return success(list_featured_products(), request=current_request_id)
        if method == "GET" and path.endswith("/public/product-carousels"):
            return success(list_product_carousels(), request=current_request_id)
        if method == "GET" and path.endswith("/public/categories"):
            return success_document(list_categories(query), request=current_request_id)
        if method == "GET" and len(tail) == 3 and tail[0] == "categories" and tail[2] == "medicines":
            return success_document(category_medicines(tail[1], query), request=current_request_id)
        if method == "GET" and len(tail) == 2 and tail[0] == "medicines":
            return success(get_medicine(tail[1]), request=current_request_id)
        if method == "POST" and path.endswith("/public/orders/track"):
            return success_document(track_orders(_body(event)), request=current_request_id)
        if method == "POST" and path.endswith("/public/orders"):
            headers = _headers(event)
            response, status_code = create_order(_body(event), headers.get("idempotency-key", ""))
            return success(response, status_code=status_code, request=current_request_id)
        raise ContractError("ROUTE_NOT_FOUND", "Route was not found", http_status=404)
    except ContractError as exc:
        return error_response(exc, request=current_request_id)
    except psycopg2.Error:
        return error_response(ContractError("INTERNAL_ERROR", "Internal server error", http_status=500), request=current_request_id)
    except Exception:
        return error_response(ContractError("INTERNAL_ERROR", "Internal server error", http_status=500), request=current_request_id)
