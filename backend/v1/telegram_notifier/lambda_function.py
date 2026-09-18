"""Send a new-order notification to one configured Telegram chat."""

from __future__ import annotations

import html
import json
import os
import urllib.error
import urllib.request
from decimal import Decimal, InvalidOperation
from typing import Any


def _money(value: Any) -> str:
    try:
        return f"{Decimal(str(value)).quantize(Decimal('0.01'))} с."
    except (InvalidOperation, ValueError):
        return "—"


def format_message(event: dict[str, Any]) -> str:
    reference = html.escape(str(event.get("order_reference") or "—"))
    customer = html.escape(str(event.get("customer_name") or "—"))
    phone = html.escape(str(event.get("phone") or "—"))
    address = html.escape(str(event.get("address") or "—"))
    lines = [
        f"🛒 <b>Новый заказ {reference}</b>",
        "",
        f"👤 {customer}",
        f"📞 {phone}",
        f"📍 {address}",
        "",
        "<b>Товары:</b>",
    ]
    items = event.get("items") if isinstance(event.get("items"), list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = html.escape(str(item.get("medicine_name") or "Товар"))
        quantity = int(item.get("quantity") or 0)
        line = f"• {name} × {quantity} — {_money(item.get('line_total'))}"
        # Telegram messages have a 4096-character limit. Keep room for totals.
        if sum(len(part) + 1 for part in lines) + len(line) > 3400:
            lines.append("• …остальные товары смотрите в админ-панели")
            break
        lines.append(line)
    lines.extend([
        "",
        f"💵 <b>Сумма: {_money(event.get('order_total'))}</b>",
        f"📈 <b>Валовая прибыль: {_money(event.get('profit'))}</b>",
    ])
    comment = str(event.get("comment") or "").strip()
    if comment:
        lines.extend(["", f"💬 {html.escape(comment[:500])}"])
    return "\n".join(lines)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        raise RuntimeError("Telegram notification configuration is incomplete")
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": format_message(event),
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    base_url = os.environ.get("ADMIN_ORDER_BASE_URL", "").strip().rstrip("/")
    order_id = event.get("admin_order_id")
    if base_url.startswith("https://") and isinstance(order_id, int):
        payload["reply_markup"] = {
            "inline_keyboard": [[{"text": "Открыть заказ", "url": f"{base_url}/{order_id}"}]],
        }
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("Telegram delivery failed") from exc
    if not body.get("ok"):
        raise RuntimeError("Telegram rejected the notification")
    return {"ok": True, "order_reference": event.get("order_reference")}
