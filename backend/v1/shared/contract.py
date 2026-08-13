"""Pure, testable business rules shared by API v1 Lambda handlers.

This module intentionally performs no network or database I/O. Lambda handlers
will validate untrusted input here before opening a database transaction.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_CEILING
from typing import Any
from uuid import UUID


class ContractError(ValueError):
    """A safe API error that can be returned without exposing internals."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        http_status: int = 400,
        fields: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.fields = fields or {}


ORDER_FIELDS = {"customer_name", "phone", "address", "comment", "items"}
ORDER_ITEM_FIELDS = {"medicine_id", "quantity"}
STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending": frozenset({"confirmed", "cancelled"}),
    "confirmed": frozenset({"delivering", "cancelled"}),
    "delivering": frozenset({"delivered"}),
    "delivered": frozenset(),
    "cancelled": frozenset(),
}


def _is_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _required_text(
    value: Any,
    field: str,
    *,
    minimum: int,
    maximum: int,
) -> str:
    if not isinstance(value, str):
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={field: "must be a string"},
        )
    normalized = value.strip()
    if not minimum <= len(normalized) <= maximum:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={field: f"must contain between {minimum} and {maximum} characters"},
        )
    return normalized


def normalize_phone(value: Any) -> str:
    """Normalize a Tajik local or +992 phone to E.164."""

    if not isinstance(value, str):
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"phone": "must be a string"},
        )

    allowed_separators = " \t\r\n()+-./"
    if any(character not in "0123456789" and character not in allowed_separators for character in value):
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"phone": "contains unsupported characters"},
        )
    digits = "".join(character for character in value if character in "0123456789")
    local = digits[3:] if len(digits) == 12 and digits.startswith("992") else digits

    if len(local) != 9 or not local.isdigit():
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"phone": "must be 9 local digits or a +992 E.164 number"},
        )
    return f"+992{local}"


def calculate_selling_unit_price(base_unit_price: Any) -> int:
    """Return ceil(base price * 1.05) as an integer TJS amount."""

    try:
        base = Decimal(str(base_unit_price))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ContractError(
            "CATALOG_PRICE_INVALID",
            "Catalog price is invalid",
            http_status=409,
        ) from exc

    if not base.is_finite() or base <= 0:
        raise ContractError(
            "CATALOG_PRICE_INVALID",
            "Catalog price is invalid",
            http_status=409,
        )

    return int((base * Decimal("1.05")).quantize(Decimal("1"), rounding=ROUND_CEILING))


def validate_idempotency_key(value: Any) -> str:
    if not isinstance(value, str):
        raise ContractError(
            "VALIDATION_ERROR",
            "A valid UUID Idempotency-Key header is required",
            fields={"Idempotency-Key": "must be a UUID"},
        )
    try:
        parsed = UUID(value)
    except (ValueError, AttributeError) as exc:
        raise ContractError(
            "VALIDATION_ERROR",
            "A valid UUID Idempotency-Key header is required",
            fields={"Idempotency-Key": "must be a UUID"},
        ) from exc
    return str(parsed)


def validate_create_order_request(payload: Any) -> dict[str, Any]:
    """Validate and normalize the only fields accepted by create order."""

    if not isinstance(payload, dict):
        raise ContractError("VALIDATION_ERROR", "Request body must be a JSON object")

    unknown_fields = sorted(set(payload) - ORDER_FIELDS)
    if unknown_fields:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={field: "field is not allowed" for field in unknown_fields},
        )

    customer_name = _required_text(payload.get("customer_name"), "customer_name", minimum=2, maximum=120)
    phone = normalize_phone(payload.get("phone"))
    address = _required_text(payload.get("address"), "address", minimum=5, maximum=500)

    comment_value = payload.get("comment")
    if comment_value is None:
        comment = None
    elif isinstance(comment_value, str) and len(comment_value.strip()) <= 500:
        comment = comment_value.strip() or None
    else:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"comment": "must be a string with at most 500 characters"},
        )

    items = payload.get("items")
    if not isinstance(items, list) or not 1 <= len(items) <= 50:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={"items": "must contain between 1 and 50 items"},
        )

    normalized_items: list[dict[str, int]] = []
    seen_medicine_ids: set[int] = set()
    for index, item in enumerate(items):
        prefix = f"items[{index}]"
        if not isinstance(item, dict):
            raise ContractError(
                "VALIDATION_ERROR",
                "Request validation failed",
                fields={prefix: "must be an object"},
            )

        unknown_item_fields = sorted(set(item) - ORDER_ITEM_FIELDS)
        if unknown_item_fields:
            raise ContractError(
                "VALIDATION_ERROR",
                "Request validation failed",
                fields={f"{prefix}.{field}": "field is not allowed" for field in unknown_item_fields},
            )

        medicine_id = item.get("medicine_id")
        quantity = item.get("quantity")
        if not _is_integer(medicine_id) or medicine_id <= 0:
            raise ContractError(
                "VALIDATION_ERROR",
                "Request validation failed",
                fields={f"{prefix}.medicine_id": "must be a positive integer"},
            )
        if not _is_integer(quantity) or not 1 <= quantity <= 99:
            raise ContractError(
                "VALIDATION_ERROR",
                "Request validation failed",
                fields={f"{prefix}.quantity": "must be an integer between 1 and 99"},
            )
        if medicine_id in seen_medicine_ids:
            raise ContractError(
                "DUPLICATE_ORDER_ITEM",
                "Order contains a duplicate medicine",
                http_status=400,
                fields={f"{prefix}.medicine_id": "must be unique within the order"},
            )

        seen_medicine_ids.add(medicine_id)
        normalized_items.append({"medicine_id": medicine_id, "quantity": quantity})

    return {
        "customer_name": customer_name,
        "phone": phone,
        "address": address,
        "comment": comment,
        "items": normalized_items,
    }


def validate_status_transition(
    current_status: Any,
    new_status: Any,
    *,
    reason: Any = None,
) -> tuple[str, str, str | None]:
    if current_status not in STATUS_TRANSITIONS or new_status not in STATUS_TRANSITIONS:
        raise ContractError(
            "INVALID_STATUS_TRANSITION",
            "Order status transition is not allowed",
            http_status=422,
        )
    if new_status not in STATUS_TRANSITIONS[current_status]:
        raise ContractError(
            "INVALID_STATUS_TRANSITION",
            "Order status transition is not allowed",
            http_status=422,
        )

    normalized_reason: str | None = None
    if new_status == "cancelled":
        normalized_reason = _required_text(reason, "reason", minimum=1, maximum=500)
    elif reason is not None:
        if not isinstance(reason, str) or len(reason.strip()) > 500:
            raise ContractError(
                "VALIDATION_ERROR",
                "Request validation failed",
                fields={"reason": "must contain at most 500 characters"},
            )
        normalized_reason = reason.strip() or None

    return current_status, new_status, normalized_reason
