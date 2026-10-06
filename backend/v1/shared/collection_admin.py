"""Admin operations for marketing collections and their statistics."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Callable

from .contract import ContractError
from .database import transaction
from .marketing import clean_text, parse_product_ids, validate_collection_slug

AuditWriter = Callable[..., None]
STATS_TIME_ZONE = "Asia/Dushanbe"
NO_MEDIUM = ""


def _product_directory(cur: Any, product_ids: list[int]) -> dict[int, dict[str, Any]]:
    if not product_ids:
        return {}
    cur.execute("SELECT id, name, in_stock FROM medicines WHERE id = ANY(%s)", (product_ids,))
    return {row["id"]: {"id": row["id"], "name": row["name"], "in_stock": bool(row["in_stock"])} for row in cur.fetchall()}


def _collection_response(row: dict[str, Any], directory: dict[int, dict[str, Any]]) -> dict[str, Any]:
    product_ids = list(row["product_ids"] or [])
    return {
        "id": int(row["id"]),
        "slug": row["slug"],
        "title": row["title"],
        "description": row["description"] or "",
        "product_ids": product_ids,
        "products": [directory.get(pid) or {"id": pid, "name": None, "in_stock": False} for pid in product_ids],
        "is_active": bool(row["is_active"]),
        "created_at": row["created_at"].isoformat(),
    }


def list_collections() -> list[dict[str, Any]]:
    with transaction() as cur:
        cur.execute(
            "SELECT id, slug, title, description, product_ids, is_active, created_at "
            "FROM collections ORDER BY created_at DESC, id DESC LIMIT 500"
        )
        rows = [dict(row) for row in cur.fetchall()]
        directory = _product_directory(cur, sorted({pid for row in rows for pid in row["product_ids"] or []}))
    return [_collection_response(row, directory) for row in rows]


def resolve_products(payload: dict[str, Any]) -> dict[str, Any]:
    product_ids = parse_product_ids(payload.get("product_ids"))
    with transaction() as cur:
        directory = _product_directory(cur, product_ids)
    return {
        "products": [directory[pid] for pid in product_ids if pid in directory],
        "missing_ids": [pid for pid in product_ids if pid not in directory],
    }


def _values(payload: dict[str, Any], *, creating: bool) -> dict[str, Any]:
    allowed = {"slug", "title", "description", "product_ids", "is_active"}
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={field: "field is not allowed" for field in unknown},
        )
    values: dict[str, Any] = {}
    if creating or "slug" in payload:
        values["slug"] = validate_collection_slug(payload.get("slug"))
    if creating or "title" in payload:
        title = clean_text(payload.get("title"), 160)
        if title is None or len(title) < 2:
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"title": "must contain 2 to 160 characters"})
        values["title"] = title
    if "description" in payload or creating:
        description = payload.get("description") or ""
        if not isinstance(description, str) or len(description.strip()) > 1000:
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"description": "must contain at most 1000 characters"})
        values["description"] = description.strip()
    if creating or "product_ids" in payload:
        values["product_ids"] = parse_product_ids(payload.get("product_ids", []))
    if "is_active" in payload or creating:
        is_active = payload.get("is_active", True)
        if not isinstance(is_active, bool):
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"is_active": "must be a boolean"})
        values["is_active"] = is_active
    if not values:
        raise ContractError("VALIDATION_ERROR", "No collection fields were supplied")
    return values


def _require_existing_products(cur: Any, product_ids: list[int]) -> None:
    directory = _product_directory(cur, product_ids)
    missing = [pid for pid in product_ids if pid not in directory]
    if missing:
        raise ContractError(
            "PRODUCTS_NOT_FOUND",
            "Товары не найдены в каталоге: " + ", ".join(str(pid) for pid in missing),
            http_status=422,
            fields={"product_ids": "unknown products: " + ", ".join(str(pid) for pid in missing)},
        )


def _require_free_slug(cur: Any, slug: str, own_id: int | None) -> None:
    cur.execute("SELECT id FROM collections WHERE slug = %s AND id IS DISTINCT FROM %s", (slug, own_id))
    if cur.fetchone():
        raise ContractError("COLLECTION_SLUG_TAKEN", "Подборка с таким slug уже существует", http_status=409)


def _fetch(cur: Any, collection_id: int) -> dict[str, Any]:
    cur.execute(
        "SELECT id, slug, title, description, product_ids, is_active, created_at FROM collections WHERE id = %s",
        (collection_id,),
    )
    row = cur.fetchone()
    if not row:
        raise ContractError("COLLECTION_NOT_FOUND", "Collection was not found", http_status=404)
    return dict(row)


def create_collection(payload: dict[str, Any], actor_id: str, current_request_id: str, audit: AuditWriter) -> dict[str, Any]:
    values = _values(payload, creating=True)
    with transaction() as cur:
        _require_free_slug(cur, values["slug"], None)
        _require_existing_products(cur, values["product_ids"])
        cur.execute(
            """
            INSERT INTO collections (slug, title, description, product_ids, is_active)
            VALUES (%s, %s, %s, %s, %s) RETURNING id
            """,
            (values["slug"], values["title"], values["description"], values["product_ids"], values["is_active"]),
        )
        collection_id = int(cur.fetchone()["id"])
        audit(cur, actor_id=actor_id, action="collection.create", resource_type="collection",
              resource_id=str(collection_id), request=current_request_id, details={"slug": values["slug"]})
        row = _fetch(cur, collection_id)
        directory = _product_directory(cur, row["product_ids"] or [])
    return _collection_response(row, directory)


def update_collection(
    collection_id: int, payload: dict[str, Any], actor_id: str, current_request_id: str, audit: AuditWriter,
) -> dict[str, Any]:
    values = _values(payload, creating=False)
    with transaction() as cur:
        _fetch(cur, collection_id)
        if "slug" in values:
            _require_free_slug(cur, values["slug"], collection_id)
        if "product_ids" in values:
            _require_existing_products(cur, values["product_ids"])
        assignments = ", ".join(f"{column} = %s" for column in values)
        cur.execute(
            f"UPDATE collections SET {assignments}, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (*values.values(), collection_id),
        )
        audit(cur, actor_id=actor_id, action="collection.update", resource_type="collection",
              resource_id=str(collection_id), request=current_request_id, details={"fields": sorted(values)})
        row = _fetch(cur, collection_id)
        directory = _product_directory(cur, row["product_ids"] or [])
    return _collection_response(row, directory)


def delete_collection(collection_id: int, actor_id: str, current_request_id: str, audit: AuditWriter) -> dict[str, Any]:
    with transaction() as cur:
        row = _fetch(cur, collection_id)
        cur.execute("DELETE FROM collections WHERE id = %s", (collection_id,))
        audit(cur, actor_id=actor_id, action="collection.delete", resource_type="collection",
              resource_id=str(collection_id), request=current_request_id, details={"slug": row["slug"]})
    return {"collection_id": collection_id, "deleted": True}


# ---------------------------------------------------------------- statistics

def _parse_day(value: Any, field: str) -> date | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise ContractError("VALIDATION_ERROR", f"{field} must be YYYY-MM-DD") from exc


def _range_clause(column: str, start: date | None, end: date | None) -> tuple[str, list[Any]]:
    """Calendar days are interpreted in Dushanbe time; `end` is inclusive."""

    clauses: list[str] = []
    params: list[Any] = []
    if start:
        clauses.append(f"{column} >= (%s::timestamp AT TIME ZONE '{STATS_TIME_ZONE}')")
        params.append(start.isoformat())
    if end:
        clauses.append(f"{column} < (%s::timestamp AT TIME ZONE '{STATS_TIME_ZONE}')")
        params.append((end + timedelta(days=1)).isoformat())
    return "".join(f" AND {clause}" for clause in clauses), params


def _empty_totals() -> dict[str, Any]:
    return {"views": 0, "unique_visitors": 0, "product_opens": 0, "add_to_carts": 0, "orders": 0, "orders_total": 0}


def _event_totals(row: dict[str, Any]) -> dict[str, int]:
    return {
        "views": int(row["views"]), "unique_visitors": int(row["unique_visitors"]),
        "product_opens": int(row["product_opens"]), "add_to_carts": int(row["add_to_carts"]),
    }


def collection_stats(query: dict[str, Any]) -> dict[str, Any]:
    start = _parse_day(query.get("from"), "from")
    end = _parse_day(query.get("to"), "to")
    if start and end and start > end:
        raise ContractError("VALIDATION_ERROR", "from must not be after to")
    slug_filter = validate_collection_slug(query["slug"]) if query.get("slug") else None
    event_range, event_params = _range_clause("created_at", start, end)
    order_range, order_params = _range_clause("o.created_at", start, end)

    with transaction() as cur:
        cur.execute(
            f"""
            SELECT collection_slug, COALESCE(utm_medium, '') AS medium,
                   COUNT(*) FILTER (WHERE event_type = 'view') AS views,
                   COUNT(DISTINCT visitor_id) FILTER (WHERE event_type = 'view') AS unique_visitors,
                   COUNT(*) FILTER (WHERE event_type = 'product_open') AS product_opens,
                   COUNT(*) FILTER (WHERE event_type = 'add_to_cart') AS add_to_carts
            FROM collection_events
            WHERE TRUE {event_range}
            GROUP BY collection_slug, COALESCE(utm_medium, '')
            """,
            tuple(event_params),
        )
        event_rows = [dict(row) for row in cur.fetchall()]
        # Unique visitors per collection cannot be summed over mediums, so count them separately.
        cur.execute(
            f"""
            SELECT collection_slug, COUNT(DISTINCT visitor_id) AS unique_visitors
            FROM collection_events WHERE event_type = 'view' {event_range}
            GROUP BY collection_slug
            """,
            tuple(event_params),
        )
        unique_by_slug = {row["collection_slug"]: int(row["unique_visitors"]) for row in cur.fetchall()}
        cur.execute(
            f"""
            SELECT o.source_collection AS collection_slug, COALESCE(o.utm_medium, '') AS medium,
                   COUNT(*) AS orders, COALESCE(SUM(o.order_total), 0) AS orders_total
            FROM orders o
            WHERE o.source_collection IS NOT NULL AND o.deleted_at IS NULL AND o.status <> 'cancelled'
              {order_range}
            GROUP BY o.source_collection, COALESCE(o.utm_medium, '')
            """,
            tuple(order_params),
        )
        order_rows = [dict(row) for row in cur.fetchall()]
        cur.execute("SELECT slug, title, is_active FROM collections")
        known = {row["slug"]: dict(row) for row in cur.fetchall()}

        collections: dict[str, dict[str, Any]] = {}

        def entry(slug: str) -> dict[str, Any]:
            if slug not in collections:
                meta = known.get(slug)
                collections[slug] = {
                    "slug": slug,
                    "title": meta["title"] if meta else slug,
                    "is_active": bool(meta["is_active"]) if meta else False,
                    "deleted": meta is None,
                    **_empty_totals(),
                    "by_medium": {},
                }
            return collections[slug]

        for slug in known:
            entry(slug)
        for row in event_rows:
            item = entry(row["collection_slug"])
            totals = _event_totals(row)
            medium = item["by_medium"].setdefault(row["medium"], _empty_totals())
            for key in ("views", "product_opens", "add_to_carts"):
                item[key] += totals[key]
                medium[key] += totals[key]
            medium["unique_visitors"] = totals["unique_visitors"]
        for slug, unique in unique_by_slug.items():
            entry(slug)["unique_visitors"] = unique
        for row in order_rows:
            item = entry(row["collection_slug"])
            medium = item["by_medium"].setdefault(row["medium"], _empty_totals())
            for target in (item, medium):
                target["orders"] += int(row["orders"])
                target["orders_total"] += int(row["orders_total"])

        cur.execute(
            f"""
            SELECT COALESCE(o.utm_content, '') AS utm_content, COALESCE(o.utm_source, '') AS utm_source,
                   COALESCE(o.utm_medium, '') AS utm_medium, COALESCE(o.utm_campaign, '') AS utm_campaign,
                   COUNT(*) AS orders, COALESCE(SUM(o.order_total), 0) AS orders_total
            FROM orders o
            WHERE o.source_collection IS NULL AND o.deleted_at IS NULL AND o.status <> 'cancelled'
              AND (o.utm_source IS NOT NULL OR o.utm_medium IS NOT NULL
                   OR o.utm_campaign IS NOT NULL OR o.utm_content IS NOT NULL)
              {order_range}
            GROUP BY 1, 2, 3, 4
            ORDER BY COUNT(*) DESC, 1
            LIMIT 200
            """,
            tuple(order_params),
        )
        utm_orders = [
            {**{key: row[key] for key in ("utm_content", "utm_source", "utm_medium", "utm_campaign")},
             "orders": int(row["orders"]), "orders_total": int(row["orders_total"])}
            for row in cur.fetchall()
        ]

        products: list[dict[str, Any]] | None = None
        if slug_filter:
            cur.execute(
                f"""
                SELECT product_id,
                       COUNT(*) FILTER (WHERE event_type = 'product_open') AS product_opens,
                       COUNT(*) FILTER (WHERE event_type = 'add_to_cart') AS add_to_carts
                FROM collection_events
                WHERE collection_slug = %s AND product_id IS NOT NULL {event_range}
                GROUP BY product_id
                """,
                (slug_filter, *event_params),
            )
            product_events = {row["product_id"]: dict(row) for row in cur.fetchall()}
            cur.execute(
                f"""
                SELECT oi.medicine_id, COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.line_total), 0) AS orders_total
                FROM orders o JOIN order_items oi ON oi.order_id = o.id
                WHERE o.source_collection = %s AND o.deleted_at IS NULL AND o.status <> 'cancelled'
                  {order_range}
                GROUP BY oi.medicine_id
                """,
                (slug_filter, *order_params),
            )
            product_orders = {row["medicine_id"]: dict(row) for row in cur.fetchall()}
            cur.execute("SELECT product_ids FROM collections WHERE slug = %s", (slug_filter,))
            current = cur.fetchone()
            ordered_ids = list(current["product_ids"] or []) if current else []
            extra = sorted((set(product_events) | set(product_orders)) - set(ordered_ids))
            all_ids = ordered_ids + extra
            directory = _product_directory(cur, [pid for pid in all_ids if pid])
            products = [
                {
                    "product_id": pid,
                    "name": (directory.get(pid) or {}).get("name"),
                    "in_collection": pid in ordered_ids,
                    "product_opens": int((product_events.get(pid) or {}).get("product_opens", 0)),
                    "add_to_carts": int((product_events.get(pid) or {}).get("add_to_carts", 0)),
                    "orders": int((product_orders.get(pid) or {}).get("orders", 0)),
                    "orders_total": int((product_orders.get(pid) or {}).get("orders_total", 0)),
                }
                for pid in all_ids if pid
            ]

    result_collections = []
    for item in sorted(collections.values(), key=lambda value: (-value["views"], value["slug"])):
        item = {**item, "by_medium": [
            {"medium": medium or None, **totals}
            for medium, totals in sorted(item["by_medium"].items(), key=lambda pair: (-pair[1]["views"], pair[0]))
        ]}
        result_collections.append(item)
    response: dict[str, Any] = {
        "from": start.isoformat() if start else None,
        "to": end.isoformat() if end else None,
        "time_zone": STATS_TIME_ZONE,
        "collections": result_collections,
        "utm_orders": utm_orders,
    }
    if products is not None:
        response["slug"] = slug_filter
        response["products"] = products
    return response
