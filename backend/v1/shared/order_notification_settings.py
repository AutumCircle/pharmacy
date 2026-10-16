"""Allowlisted presentation policy for order notifications and pharmacy view."""

from __future__ import annotations

from typing import Any


FIELDS = (
    "order_reference", "created_at", "source", "customer_name", "phone",
    "address", "landmark", "comment", "items", "quantity", "item_client_total",
    "item_base_total", "client_total",
    "base_total", "profit", "creator", "status",
)
CHANNELS = ("owner_telegram", "courier_telegram", "pharmacy_telegram", "pharmacy_web")
DEFAULT_ENABLED = {
    "owner_telegram": frozenset(FIELDS),
    "courier_telegram": frozenset({
        "order_reference", "customer_name", "phone", "address", "landmark",
        "comment", "items", "quantity", "client_total", "creator",
    }),
    "pharmacy_telegram": frozenset({
        "order_reference", "comment", "items", "quantity", "item_base_total", "base_total",
    }),
    "pharmacy_web": frozenset({
        "order_reference", "created_at", "comment", "items", "quantity", "status",
        "item_base_total", "base_total",
    }),
}


def default_policies() -> dict[str, dict[str, bool]]:
    return {channel: {field: field in DEFAULT_ENABLED[channel] for field in FIELDS}
            for channel in CHANNELS}


def effective_settings(row: dict[str, Any] | None) -> dict[str, Any]:
    policies = default_policies()
    raw = row.get("policies") if row else None
    if isinstance(raw, dict):
        for channel in CHANNELS:
            values = raw.get(channel)
            if isinstance(values, dict):
                for field in FIELDS:
                    if type(values.get(field)) is bool:
                        policies[channel][field] = values[field]
    for channel in CHANNELS:
        policies[channel]["order_reference"] = True
    return {
        "courier_enabled": row.get("courier_enabled", True) if row else True,
        "policies": policies,
        "revision": int(row.get("revision") or 1) if row else 1,
        "updated_at": row.get("updated_at") if row else None,
        "updated_by": row.get("updated_by") if row else None,
    }


def validate_update(payload: Any) -> tuple[bool, dict[str, dict[str, bool]], int]:
    if not isinstance(payload, dict) or set(payload) != {"courier_enabled", "policies", "revision"}:
        raise ValueError("Invalid notification settings payload")
    enabled, policies, revision = payload["courier_enabled"], payload["policies"], payload["revision"]
    if type(enabled) is not bool or type(revision) is not int or revision < 1:
        raise ValueError("Invalid notification settings payload")
    if not isinstance(policies, dict) or set(policies) != set(CHANNELS):
        raise ValueError("Invalid notification settings payload")
    for channel in CHANNELS:
        values = policies[channel]
        if not isinstance(values, dict) or set(values) != set(FIELDS):
            raise ValueError("Invalid notification settings payload")
        if any(type(value) is not bool for value in values.values()) or not values["order_reference"]:
            raise ValueError("Invalid notification settings payload")
    return enabled, policies, revision


def allowed(settings: dict[str, Any], channel: str, field: str) -> bool:
    return channel in CHANNELS and field in FIELDS and settings["policies"][channel][field]
