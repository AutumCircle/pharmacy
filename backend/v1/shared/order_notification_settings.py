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


# Job 014: the pharmacy web alarm («Ватан 1» and «Ватан 2»). Stored inside the existing `policies` JSONB
# under the reserved key PHARMACY_ALARM_KEY (no migration); channel policies never read that key.
PHARMACY_ALARM_KEY = "pharmacy_alarm"
RINGTONES = ("classic", "bell", "pulse", "melody")
ALARM_DURATION_MIN, ALARM_DURATION_MAX = 5, 120
ALARM_INTERVAL_MIN, ALARM_INTERVAL_MAX = 30, 600
DEFAULT_PHARMACY_ALARM = {"ringtone": "classic", "duration_seconds": 60, "interval_seconds": 60}


def default_pharmacy_alarm() -> dict[str, Any]:
    return dict(DEFAULT_PHARMACY_ALARM)


def _valid_alarm(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != set(DEFAULT_PHARMACY_ALARM):
        return False
    ringtone, duration, interval = value["ringtone"], value["duration_seconds"], value["interval_seconds"]
    return (isinstance(ringtone, str) and ringtone in RINGTONES
            and type(duration) is int and ALARM_DURATION_MIN <= duration <= ALARM_DURATION_MAX
            and type(interval) is int and ALARM_INTERVAL_MIN <= interval <= ALARM_INTERVAL_MAX
            and duration <= interval)


def pharmacy_alarm_from(raw_policies: Any) -> dict[str, Any]:
    """The stored alarm when it is complete and valid, otherwise the defaults (rows saved before job 014,
    or by an older Lambda that dropped the key)."""
    value = raw_policies.get(PHARMACY_ALARM_KEY) if isinstance(raw_policies, dict) else None
    return dict(value) if _valid_alarm(value) else default_pharmacy_alarm()


def stored_policies(policies: dict[str, dict[str, bool]], alarm: dict[str, Any]) -> dict[str, Any]:
    """The JSONB document written to order_notification_settings.policies: the channels plus the alarm."""
    return {**{channel: policies[channel] for channel in CHANNELS}, PHARMACY_ALARM_KEY: dict(alarm)}


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
        "pharmacy_alarm": pharmacy_alarm_from(raw),
        "revision": int(row.get("revision") or 1) if row else 1,
        "updated_at": row.get("updated_at") if row else None,
        "updated_by": row.get("updated_by") if row else None,
    }


def validate_update(payload: Any) -> tuple[bool, dict[str, dict[str, bool]], int, dict[str, Any]]:
    """Exactly {courier_enabled, policies, revision, pharmacy_alarm} (job 014 made the alarm required)."""
    if not isinstance(payload, dict) or set(payload) != {"courier_enabled", "policies", "revision", PHARMACY_ALARM_KEY}:
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
    alarm = payload[PHARMACY_ALARM_KEY]
    if not _valid_alarm(alarm):
        raise ValueError("Invalid pharmacy alarm")
    return enabled, policies, revision, dict(alarm)


def allowed(settings: dict[str, Any], channel: str, field: str) -> bool:
    return channel in CHANNELS and field in FIELDS and settings["policies"][channel][field]
