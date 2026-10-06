"""Validation helpers for marketing collections, click events and order attribution.

Pure functions: no network or database I/O.
"""

from __future__ import annotations

import re
from typing import Any

from .contract import ContractError

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
VISITOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,64}$")
EVENT_TYPES = frozenset({"view", "product_open", "add_to_cart"})
UTM_FIELDS = ("utm_source", "utm_medium", "utm_campaign", "utm_content")
MAX_COLLECTION_PRODUCTS = 50

# Preview crawlers and bots. Instagram/Facebook open links themselves when they are sent in Direct.
BOT_USER_AGENT_MARKERS = (
    "facebookexternalhit", "meta-externalagent", "meta-externalfetcher", "facebot",
    "bot", "crawler", "spider", "preview",
)

_CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")


def is_bot_user_agent(user_agent: Any) -> bool:
    """A missing user agent is never a real browser."""

    if not isinstance(user_agent, str) or not user_agent.strip():
        return True
    lowered = user_agent.lower()
    return any(marker in lowered for marker in BOT_USER_AGENT_MARKERS)


def clean_text(value: Any, maximum: int) -> str | None:
    """Trim, strip control characters and truncate optional free text. Empty becomes None."""

    if not isinstance(value, str):
        return None
    cleaned = _CONTROL_CHARACTERS.sub("", value).strip()[:maximum]
    return cleaned or None


def normalize_utm(payload: Any) -> dict[str, str | None]:
    source = payload if isinstance(payload, dict) else {}
    return {field: clean_text(source.get(field), 100) for field in UTM_FIELDS}


def normalize_attribution(value: Any) -> dict[str, str | None] | None:
    """Order attribution as supplied by the Next.js server from the first-touch cookie.

    Returns None when there is nothing to store. Values are untrusted and only used as labels.
    """

    if value is None:
        return None
    if not isinstance(value, dict):
        raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"attribution": "must be an object"})
    unknown = sorted(set(value) - {"source_collection", *UTM_FIELDS})
    if unknown:
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={f"attribution.{field}": "field is not allowed" for field in unknown},
        )
    collection = clean_text(value.get("source_collection"), 80)
    if collection is not None and not SLUG_PATTERN.match(collection):
        collection = None
    result: dict[str, str | None] = {"source_collection": collection, **normalize_utm(value)}
    return result if any(result.values()) else None


def validate_collection_slug(value: Any, field: str = "slug") -> str:
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 80 or not SLUG_PATTERN.match(value.strip()):
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={field: "must be lowercase latin letters, digits and hyphens"},
        )
    return value.strip()


def validate_collection_event(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ContractError("VALIDATION_ERROR", "Request body must be a JSON object")
    allowed = {"collection_slug", "event_type", "product_id", "visitor_id", "referrer", "user_agent", *UTM_FIELDS}
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={field: "field is not allowed" for field in unknown},
        )
    event_type = payload.get("event_type")
    if event_type not in EVENT_TYPES:
        raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"event_type": "is invalid"})
    visitor_id = payload.get("visitor_id")
    if not isinstance(visitor_id, str) or not VISITOR_ID_PATTERN.match(visitor_id):
        raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"visitor_id": "is invalid"})
    product_id = payload.get("product_id")
    if event_type == "view":
        if product_id is not None:
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"product_id": "must be empty for view"})
    elif isinstance(product_id, bool) or not isinstance(product_id, int) or product_id <= 0:
        raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"product_id": "must be a positive integer"})
    return {
        "collection_slug": validate_collection_slug(payload.get("collection_slug"), "collection_slug"),
        "event_type": event_type,
        "product_id": product_id,
        "visitor_id": visitor_id,
        "referrer": clean_text(payload.get("referrer"), 500),
        "user_agent": payload.get("user_agent") if isinstance(payload.get("user_agent"), str) else "",
        **normalize_utm(payload),
    }


def parse_product_ids(value: Any) -> list[int]:
    """Accept a list of positive integers (admin form sends it already split)."""

    if not isinstance(value, list):
        raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"product_ids": "must be an array"})
    if len(value) > MAX_COLLECTION_PRODUCTS:
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={"product_ids": f"must contain at most {MAX_COLLECTION_PRODUCTS} products"},
        )
    ids: list[int] = []
    for item in value:
        if isinstance(item, bool) or not isinstance(item, int) or item <= 0 or item > 2_147_483_647:
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"product_ids": "must contain positive integers"})
        if item in ids:
            raise ContractError("VALIDATION_ERROR", "Request validation failed", fields={"product_ids": f"product {item} is listed twice"})
        ids.append(item)
    return ids
