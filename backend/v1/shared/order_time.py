"""Order timestamps: legacy naive values in orders are UTC, not local time."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo


def absolute_order_time(value: datetime | str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def order_time_iso(value: datetime | str) -> str:
    return absolute_order_time(value).astimezone(timezone.utc).isoformat()


def order_time_dushanbe(value: datetime | str) -> str:
    return absolute_order_time(value).astimezone(ZoneInfo("Asia/Dushanbe")).strftime("%d.%m.%Y %H:%M")
