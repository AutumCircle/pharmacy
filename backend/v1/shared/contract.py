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


ORDER_FIELDS = {"customer_name", "phone", "address", "comment", "items", "attribution"}
ORDER_ITEM_FIELDS = {"medicine_id", "quantity"}
STAFF_ORDER_FIELDS = {"customer_name", "phone", "address", "landmark", "source", "items", "manual_items", "pharmacy_id", "comment"}
STAFF_ORDER_SOURCES = frozenset({"instagram", "whatsapp", "phone"})
STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending": frozenset({"confirmed", "cancelled"}),
    "confirmed": frozenset({"delivering", "cancelled"}),
    "delivering": frozenset({"delivered", "cancelled"}),
    "delivered": frozenset(),
    "cancelled": frozenset(),
}


def _is_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_order_quantity(value: Any, field: str = "quantity") -> Decimal:
    """Accept half-unit order quantities without using binary math for totals."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ContractError("VALIDATION_ERROR", f"{field} must be between 0.5 and 99 in 0.5 steps")
    try:
        quantity = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", f"{field} must be between 0.5 and 99 in 0.5 steps") from exc
    if (not quantity.is_finite() or quantity < Decimal("0.5") or quantity > Decimal("99")
            or quantity * 2 != (quantity * 2).to_integral_value()):
        raise ContractError("VALIDATION_ERROR", f"{field} must be between 0.5 and 99 in 0.5 steps")
    return quantity.quantize(Decimal("0.01"))


def _quantity_wire_value(quantity: Decimal) -> int | str:
    """Keep the existing integer wire form stable; represent only fractional values as strings."""
    return int(quantity) if quantity == quantity.to_integral_value() else str(quantity)


def validate_unit_price(value: Any) -> Decimal:
    """A staff-entered price per unit: 0.01..999999.99 TJS with at most two decimals."""
    if isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        raise ContractError("VALIDATION_ERROR", "Укажите корректную цену")
    try:
        price = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation as exc:
        raise ContractError("VALIDATION_ERROR", "Укажите корректную цену") from exc
    if not price.is_finite() or not Decimal("0.01") <= price <= Decimal("999999.99") or price.as_tuple().exponent < -2:
        raise ContractError("VALIDATION_ERROR", "Цена должна быть от 0,01 до 999999,99 с. с точностью до копейки")
    return price.quantize(Decimal("0.01"))


def validate_manual_order_items(value: Any) -> list[dict[str, Any]]:
    """Only authorized staff/admin may supply these order-only price snapshots."""
    if not isinstance(value, list) or not 1 <= len(value) <= 20:
        raise ContractError("VALIDATION_ERROR", "Укажите от 1 до 20 ручных позиций")
    result: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict) or set(item) != {"medicine_name", "price", "quantity"}:
            raise ContractError("VALIDATION_ERROR", "Укажите название, цену и количество")
        name = item["medicine_name"]
        if not isinstance(name, str):
            raise ContractError("VALIDATION_ERROR", "Укажите название лекарства")
        name = " ".join(name.split())
        if not 2 <= len(name) <= 200 or "\x00" in name:
            raise ContractError("VALIDATION_ERROR", "Название должно содержать от 2 до 200 символов")
        price = validate_unit_price(item["price"])
        quantity = validate_order_quantity(item["quantity"])
        result.append({"medicine_name": name, "price": str(price), "quantity": _quantity_wire_value(quantity)})
    return result


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

    normalized_items: list[dict[str, Any]] = []
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
        try:
            normalized_quantity = validate_order_quantity(quantity, f"{prefix}.quantity")
        except ContractError as exc:
            raise ContractError("VALIDATION_ERROR", "Request validation failed",
                fields={f"{prefix}.quantity": "must be between 0.5 and 99 in 0.5 steps"}) from exc
        if medicine_id in seen_medicine_ids:
            raise ContractError(
                "DUPLICATE_ORDER_ITEM",
                "Order contains a duplicate medicine",
                http_status=400,
                fields={f"{prefix}.medicine_id": "must be unique within the order"},
            )

        seen_medicine_ids.add(medicine_id)
        normalized_items.append({"medicine_id": medicine_id, "quantity": _quantity_wire_value(normalized_quantity)})

    from .marketing import normalize_attribution

    return {
        "customer_name": customer_name,
        "phone": phone,
        "address": address,
        "comment": comment,
        "items": normalized_items,
        "attribution": normalize_attribution(payload.get("attribution")),
    }


def validate_staff_order_request(payload: Any) -> dict[str, Any]:
    """Validate a manual order lead entered by pharmacy staff or courier."""

    if not isinstance(payload, dict):
        raise ContractError("VALIDATION_ERROR", "Request body must be a JSON object")
    unknown_fields = sorted(set(payload) - STAFF_ORDER_FIELDS)
    if unknown_fields:
        raise ContractError(
            "VALIDATION_ERROR",
            "Request validation failed",
            fields={field: "field is not allowed" for field in unknown_fields},
        )

    name_value = payload.get("customer_name")
    if name_value is None or name_value == "":
        customer_name = ""
    elif isinstance(name_value, str) and len(name_value.strip()) <= 120:
        customer_name = name_value.strip()
    else:
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={"customer_name": "must contain at most 120 characters"},
        )

    phone_value = payload.get("phone")
    if not isinstance(phone_value, str) or len(phone_value) != 9 or not phone_value.isdigit():
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={"phone": "must contain exactly 9 digits"},
        )
    address = _required_text(payload.get("address"), "address", minimum=3, maximum=500)
    landmark = _required_text(payload.get("landmark"), "landmark", minimum=2, maximum=300)
    comment_value = payload.get("comment")
    if comment_value is not None and not isinstance(comment_value, str):
        raise ContractError("VALIDATION_ERROR", "Request validation failed",
                            fields={"comment": "must be a string with at most 500 characters"})
    if isinstance(comment_value, str) and len(comment_value.strip()) > 500:
        raise ContractError("VALIDATION_ERROR", "Request validation failed",
                            fields={"comment": "must be a string with at most 500 characters"})
    source = payload.get("source")
    if source not in STAFF_ORDER_SOURCES:
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={"source": "must be instagram, whatsapp or phone"},
        )
    items_value = payload.get("items", [])
    if not isinstance(items_value, list) or len(items_value) > 50:
        raise ContractError(
            "VALIDATION_ERROR", "Request validation failed",
            fields={"items": "must contain at most 50 items"},
        )
    items: list[dict[str, Any]] = []
    seen: set[int] = set()
    for index, item in enumerate(items_value):
        if not isinstance(item, dict) or not ORDER_ITEM_FIELDS <= set(item) <= ORDER_ITEM_FIELDS | {"unit_price"}:
            raise ContractError(
                "VALIDATION_ERROR", "Request validation failed",
                fields={f"items[{index}]": "medicine_id and quantity are required"},
            )
        medicine_id, quantity = item.get("medicine_id"), item.get("quantity")
        if not _is_integer(medicine_id) or medicine_id <= 0:
            raise ContractError("VALIDATION_ERROR", "Request validation failed",
                                fields={f"items[{index}].medicine_id": "must be a positive integer"})
        try:
            normalized_quantity = validate_order_quantity(quantity, f"items[{index}].quantity")
        except ContractError as exc:
            raise ContractError("VALIDATION_ERROR", "Request validation failed",
                                fields={f"items[{index}].quantity": "must be between 0.5 and 99 in 0.5 steps"}) from exc
        if medicine_id in seen:
            raise ContractError("DUPLICATE_ORDER_ITEM", "Order contains a duplicate medicine", http_status=400)
        seen.add(medicine_id)
        normalized_item: dict[str, Any] = {"medicine_id": medicine_id, "quantity": _quantity_wire_value(normalized_quantity)}
        if "unit_price" in item:
            normalized_item["unit_price"] = str(validate_unit_price(item["unit_price"]))
        items.append(normalized_item)
    result = {
        "customer_name": customer_name,
        "phone": f"+992{phone_value}",
        "address": address,
        "landmark": landmark,
        "source": source,
        "items": items,
    }
    if "manual_items" in payload:
        result["manual_items"] = validate_manual_order_items(payload["manual_items"])
    if isinstance(comment_value, str) and comment_value.strip():
        result["comment"] = comment_value.strip()
    if "pharmacy_id" in payload:
        pharmacy_id = payload["pharmacy_id"]
        if not _is_integer(pharmacy_id) or pharmacy_id not in (1, 2):
            raise ContractError("VALIDATION_ERROR", "Request validation failed",
                                fields={"pharmacy_id": "must be 1 or 2"})
        result["pharmacy_id"] = pharmacy_id
    return result


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
