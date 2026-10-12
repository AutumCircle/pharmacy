"""The Telegram message renderer shared by delivery and admin preview."""
from __future__ import annotations

import html
from decimal import Decimal, InvalidOperation
from typing import Any

from backend.v1.shared.order_notification_settings import CHANNELS, FIELDS
from backend.v1.shared.order_time import order_time_dushanbe


def _money(value: Any) -> str:
    try:
        return f"{Decimal(str(value)).quantize(Decimal('0.01'))} с."
    except (InvalidOperation, ValueError):
        return "—"


def format_configured_message(event: dict[str, Any], fields: dict[str, bool], channel: str) -> str:
    """Only explicitly allowed fields enter the recipient's Telegram text."""
    if channel not in CHANNELS[:3] or set(fields) != set(FIELDS) or not fields["order_reference"]:
        raise RuntimeError("Notification policy is invalid")
    reference = html.escape(str(event.get("order_reference") or "—"))
    titles = {"owner_telegram": "Новый заказ", "courier_telegram": "Новая доставка",
              "pharmacy_telegram": "Заказ на сборку"}
    lines = [f"<b>{titles[channel]} {reference}</b>"]
    mapping = (
        ("created_at", "📅 Дата", "created_at"),
        ("source", "📨 Источник", "order_source"),
        ("customer_name", "👤 Клиент", "customer_name"),
        ("phone", "📞 Телефон", "phone"),
        ("address", "📍 Адрес", "address"),
        ("landmark", "🧭 Ориентир", "landmark"),
        ("comment", "💬 Комментарий", "comment"),
        ("creator", "🏥 Создал", "created_by_staff_username"),
        ("status", "📦 Статус", "status"),
    )
    for field, label, key in mapping:
        if not fields[field]:
            continue
        value = event.get(key)
        if field == "created_at" and value:
            value = order_time_dushanbe(value)
        if field == "source" and not value:
            value = "Сайт"
        if field == "creator" and not value:
            value = f"Аптека {event.get('fulfillment_pharmacy_id') or 1}"
        if value is not None and str(value).strip():
            lines.append(f"{label}: {html.escape(str(value)[:500])}")
    amount_lines = []
    for field, label, key in (
        ("client_total", "💵 Клиентская сумма", "order_total"),
        ("base_total", "🏪 Базовая сумма", "base_total"),
        ("profit", "📈 Разница", "profit"),
    ):
        if fields[field]:
            amount_lines.append(f"{label}: <b>{_money(event.get(key))}</b>")
    if fields["items"]:
        items = event.get("items") if isinstance(event.get("items"), list) else []
        lines.append("<b>Товары:</b>")
        for item in items:
            if not isinstance(item, dict):
                continue
            name = html.escape(str(item.get("medicine_name") or "Товар")[:200])
            line = f"• {name}"
            if fields["quantity"]:
                line += f" × {int(item.get('quantity') or 0)}"
            prices = []
            if fields["item_client_total"]:
                prices.append(_money(item.get("line_total")))
            if fields["item_base_total"]:
                prices.append(_money(item.get("base_line_total")))
            if prices:
                line += " — " + " / ".join(prices)
            if sum(len(part) + 1 for part in lines + amount_lines) + len(line) > 3800:
                lines.append("• …остальные товары в панели заказов")
                break
            lines.append(line)
    lines.extend(amount_lines)
    return "\n".join(lines)
