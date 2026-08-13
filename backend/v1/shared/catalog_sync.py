"""Pure validation and normalization rules for full catalogue snapshots."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable


MAX_SNAPSHOT_ROWS = 100_000


class SnapshotValidationError(ValueError):
    def __init__(self, code: str, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.safe_message = message
        self.details = details or {}


@dataclass(frozen=True)
class NormalizedCatalogItem:
    row_number: int
    source_sku: str | None
    raw_name: str
    canonical_name: str
    country: str
    vendor: str
    base_price: Decimal
    in_stock: bool
    identity_key: str
    source_row_hash: str

    def as_record(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class DuplicateResolution:
    identity_key: str
    row_numbers: list[int]
    selected_row_number: int
    policy: str


@dataclass(frozen=True)
class ValidatedCatalogSnapshot:
    raw_row_count: int
    items: list[NormalizedCatalogItem]
    duplicate_resolutions: list[DuplicateResolution]


def _text(value: Any, field: str, row_number: int, maximum: int, *, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise SnapshotValidationError(
            "INVALID_ROW", "Snapshot contains invalid rows",
            details={"row_number": row_number, "field": field},
        )
    normalized = value.strip()
    if (required and not normalized) or len(normalized) > maximum:
        raise SnapshotValidationError(
            "INVALID_ROW", "Snapshot contains invalid rows",
            details={"row_number": row_number, "field": field},
        )
    return normalized


def _catalog_attribute(value: Any, field: str, row_number: int) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > 100:
        raise SnapshotValidationError(
            "INVALID_ROW", "Snapshot contains invalid rows",
            details={"row_number": row_number, "field": field},
        )
    return value


def _sha256(parts: Iterable[str]) -> str:
    value = "\x1f".join(parts).encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def normalize_catalog_item(record: Any, row_number: int, source_id: str) -> NormalizedCatalogItem:
    if not isinstance(record, dict):
        raise SnapshotValidationError(
            "INVALID_ROW", "Snapshot contains invalid rows", details={"row_number": row_number}
        )
    allowed = {"name", "price", "country", "vendor", "source_sku"}
    unknown = sorted(set(record) - allowed)
    if unknown:
        raise SnapshotValidationError(
            "INVALID_ROW", "Snapshot contains invalid rows",
            details={"row_number": row_number, "field": unknown[0]},
        )

    raw_name = _text(record.get("name"), "name", row_number, 255, required=True)
    in_stock = not raw_name.startswith("*")
    canonical_name = raw_name[1:].strip() if not in_stock else raw_name
    if not canonical_name or canonical_name.startswith("*") or len(canonical_name) > 255:
        raise SnapshotValidationError(
            "INVALID_ROW", "Snapshot contains invalid rows",
            details={"row_number": row_number, "field": "name"},
        )
    country = _catalog_attribute(record.get("country"), "country", row_number)
    vendor = _catalog_attribute(record.get("vendor"), "vendor", row_number)
    source_sku = _text(record.get("source_sku"), "source_sku", row_number, 255) or None
    try:
        price = Decimal(str(record.get("price"))).quantize(Decimal("0.01"))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise SnapshotValidationError(
            "INVALID_ROW", "Snapshot contains invalid rows",
            details={"row_number": row_number, "field": "price"},
        ) from exc
    if not price.is_finite() or price <= 0 or price > Decimal("99999999.99"):
        raise SnapshotValidationError(
            "INVALID_ROW", "Snapshot contains invalid rows",
            details={"row_number": row_number, "field": "price"},
        )

    if source_sku:
        identity_key = _sha256(("sku", source_id.casefold(), source_sku.casefold()))
    else:
        identity_key = _sha256((
            "fallback", source_id.casefold(), canonical_name.casefold(), vendor.casefold(), country.casefold()
        ))
    source_row_hash = _sha256((
        source_id.casefold(), source_sku.casefold() if source_sku else "",
        canonical_name, country, vendor, format(price, "f"), "1" if in_stock else "0",
    ))
    return NormalizedCatalogItem(
        row_number=row_number,
        source_sku=source_sku,
        raw_name=raw_name,
        canonical_name=canonical_name,
        country=country,
        vendor=vendor,
        base_price=price,
        in_stock=in_stock,
        identity_key=identity_key,
        source_row_hash=source_row_hash,
    )


def validate_snapshot(
    records: Any,
    *,
    source_id: str,
    expected_row_count: int,
    minimum_row_count: int,
) -> ValidatedCatalogSnapshot:
    if not isinstance(records, list):
        raise SnapshotValidationError("INVALID_SNAPSHOT", "records must be an array")
    actual = len(records)
    if actual != expected_row_count:
        raise SnapshotValidationError(
            "ROW_COUNT_MISMATCH", "Snapshot row count does not match initiation request",
            details={"expected": expected_row_count, "actual": actual},
        )
    if actual < minimum_row_count:
        raise SnapshotValidationError(
            "SNAPSHOT_TOO_SMALL", "Snapshot is below the configured safety threshold",
            details={"minimum": minimum_row_count, "actual": actual},
        )
    if actual > MAX_SNAPSHOT_ROWS:
        raise SnapshotValidationError(
            "SNAPSHOT_TOO_LARGE", "Snapshot exceeds the maximum row count",
            details={"maximum": MAX_SNAPSHOT_ROWS, "actual": actual},
        )

    normalized: list[NormalizedCatalogItem] = []
    errors: list[dict[str, Any]] = []
    for row_number, record in enumerate(records, start=1):
        try:
            normalized.append(normalize_catalog_item(record, row_number, source_id))
        except SnapshotValidationError as exc:
            if len(errors) < 50:
                errors.append(exc.details)
    if errors:
        raise SnapshotValidationError(
            "INVALID_ROWS", "Snapshot contains invalid rows",
            details={"invalid_count": len(errors), "examples": errors},
        )

    identities: dict[str, list[NormalizedCatalogItem]] = {}
    for item in normalized:
        identities.setdefault(item.identity_key, []).append(item)

    sku_conflicts = [
        {"identity_key": key, "row_numbers": [item.row_number for item in items]}
        for key, items in identities.items()
        if len(items) > 1 and any(item.source_sku for item in items)
    ]
    if sku_conflicts:
        raise SnapshotValidationError(
            "DUPLICATE_SOURCE_SKU", "Snapshot contains a duplicated source SKU",
            details={"conflict_count": len(sku_conflicts), "conflicts": sku_conflicts[:50]},
        )

    resolved_items: list[NormalizedCatalogItem] = []
    resolutions: list[DuplicateResolution] = []
    for identity_key, items in identities.items():
        if len(items) == 1:
            resolved_items.append(items[0])
            continue

        available = [item for item in items if item.in_stock]
        candidates = available or items
        selected = max(candidates, key=lambda item: (item.base_price, -item.row_number))
        resolved_items.append(selected)
        resolutions.append(DuplicateResolution(
            identity_key=identity_key,
            row_numbers=[item.row_number for item in items],
            selected_row_number=selected.row_number,
            policy="max_available_price_then_first_row",
        ))
    return ValidatedCatalogSnapshot(
        raw_row_count=actual,
        items=resolved_items,
        duplicate_resolutions=resolutions,
    )


def canonical_snapshot_json(source_id: str, generated_at: str, records: list[dict[str, Any]]) -> bytes:
    document = {
        "format": "vatan-catalog-snapshot/v1",
        "source_id": source_id,
        "generated_at": generated_at,
        "records": records,
    }
    return json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
