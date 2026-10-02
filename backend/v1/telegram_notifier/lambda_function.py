"""Send a new-order notification to one configured Telegram chat."""

from __future__ import annotations

import html
import hmac
import json
import os
import urllib.error
import urllib.request
from decimal import Decimal, InvalidOperation
from typing import Any


def _authorizer_response(event: dict[str, Any]) -> dict[str, Any] | None:
    if event.get("type") != "TOKEN":
        return None
    supplied = str(event.get("authorizationToken") or "")
    expected = os.environ.get("NOTIFIER_BEARER_TOKEN", "").strip()
    allowed = bool(expected) and hmac.compare_digest(supplied, f"Bearer {expected}")
    return {
        "principalId": "pharmacy-web" if allowed else "unauthorized",
        "policyDocument": {
            "Version": "2012-10-17",
            "Statement": [{
                "Action": "execute-api:Invoke",
                "Effect": "Allow" if allowed else "Deny",
                "Resource": event.get("methodArn", "*"),
            }],
        },
    }


def _money(value: Any) -> str:
    try:
        return f"{Decimal(str(value)).quantize(Decimal('0.01'))} с."
    except (InvalidOperation, ValueError):
        return "—"


def _identity(event: dict[str, Any]) -> tuple[str, str, str, str]:
    reference = html.escape(str(event.get("order_reference") or "—"))
    customer = html.escape(str(event.get("customer_name") or "—"))
    phone = html.escape(str(event.get("phone") or "—"))
    address = html.escape(str(event.get("address") or "—"))
    return reference, customer, phone, address


def _item_lines(event: dict[str, Any], price_key: str) -> list[str]:
    lines: list[str] = []
    items = event.get("items") if isinstance(event.get("items"), list) else []
    for item in items:
        if not isinstance(item, dict):
            continue
        name = html.escape(str(item.get("medicine_name") or "Товар"))
        quantity = int(item.get("quantity") or 0)
        price = item.get(price_key)
        line = f"• {name} × {quantity} — {_money(price)}"
        if sum(len(part) + 1 for part in lines) + len(line) > 3200:
            lines.append("• …остальные товары смотрите в админ-панели")
            break
        lines.append(line)
    return lines


def format_owner_message(event: dict[str, Any]) -> str:
    if event.get("notification_kind") == "staff_manual_order":
        reference, customer, phone, address = _identity(event)
        account_id = html.escape(str(event.get("fulfillment_pharmacy_id") or event.get("created_by_staff_account_id") or "—"))
        username = html.escape(str(event.get("created_by_staff_username") or "—"))
        actor_label = "Доставщик" if event.get("created_by_staff_account_id") == 3 else "Сотрудник"
        source_labels = {"instagram": "Instagram", "whatsapp": "WhatsApp", "phone": "Телефонный звонок"}
        source = source_labels.get(str(event.get("order_source")), "—")
        landmark = html.escape(str(event.get("landmark") or "—"))
        lines = [
            f"🏥 <b>Новый заказ из аптеки {account_id}</b>",
            f"🧾 Заказ: {reference}",
            f"👤 {actor_label}: {username}",
            f"📨 Источник: {source}",
            "",
            f"Клиент: {customer}",
            f"📞 Телефон: {phone}",
            f"📍 Адрес: {address}",
            f"🧭 Ориентир: {landmark}",
        ]
        items = event.get("items") if isinstance(event.get("items"), list) else []
        if items:
            lines.extend(["", "<b>Товары — аптека / клиент:</b>"])
            for item in items:
                if not isinstance(item, dict):
                    continue
                name = html.escape(str(item.get("medicine_name") or "Товар"))
                quantity = int(item.get("quantity") or 0)
                lines.append(
                    f"• {name} × {quantity} — {_money(item.get('base_line_total'))} / {_money(item.get('line_total'))}"
                )
            lines.extend([
                "",
                f"🏪 Базовая сумма: <b>{_money(event.get('base_total'))}</b>",
                f"👤 Клиентская сумма: <b>{_money(event.get('order_total'))}</b>",
                f"📈 Разница: <b>{_money(event.get('profit'))}</b>",
            ])
        else:
            lines.extend(["", "Товары будут уточнены по телефону."])
        return "\n".join(lines)
    reference, _, _, _ = _identity(event)
    lines = [
        f"📊 <b>Новый заказ {reference} — для владельца</b>",
        "",
        "<b>Товары:</b>",
    ]
    lines.extend(_item_lines(event, "line_total"))
    lines.extend([
        "",
        f"💵 <b>Сумма заказа: {_money(event.get('order_total'))}</b>",
        f"📈 <b>Валовая прибыль: {_money(event.get('profit'))}</b>",
    ])
    return "\n".join(lines)


def format_pharmacy_message(event: dict[str, Any]) -> str:
    reference, _, _, _ = _identity(event)
    lines = [
        f"💊 <b>Заказ {reference} — собрать</b>",
        "",
        "<b>Товары:</b>",
    ]
    lines.extend(_item_lines(event, "base_line_total"))
    lines.extend([
        "",
        f"🧾 <b>Итого: {_money(event.get('base_total'))}</b>",
    ])
    return "\n".join(lines)


def format_delivery_message(event: dict[str, Any]) -> str:
    reference, customer, phone, address = _identity(event)
    lines = [
        f"🚚 <b>Заказ {reference} — доставка</b>",
        "",
        f"👤 Получатель: {customer}",
        f"📞 Позвонить: {phone}",
        f"📍 Адрес: {address}",
        f"💵 Получить: <b>{_money(event.get('order_total'))}</b>",
    ]
    if event.get("notification_kind") == "staff_manual_order":
        landmark = html.escape(str(event.get("landmark") or "—"))
        pharmacy_id = event.get("fulfillment_pharmacy_id") or event.get("created_by_staff_account_id")
        lines.insert(1, f"🏥 Аптека {html.escape(str(pharmacy_id or '—'))}")
        lines.append(f"🧭 Ориентир: {landmark}")
        items = event.get("items") if isinstance(event.get("items"), list) else []
        if items:
            lines.extend(["", "<b>Доставить:</b>"])
            for item in items:
                if isinstance(item, dict):
                    lines.append(f"• {html.escape(str(item.get('medicine_name') or 'Товар'))} × {int(item.get('quantity') or 0)}")
    comment = str(event.get("comment") or "").strip()
    if comment:
        lines.extend(["", f"💬 Комментарий: {html.escape(comment[:500])}"])
    else:
        lines.extend(["", "💬 Комментарий: нет"])
    return "\n".join(lines)


def format_message(event: dict[str, Any]) -> str:
    """Backward-compatible owner message formatter."""
    return format_owner_message(event)


def _send_message(
    token: str,
    chat_id: str,
    text: str,
    event: dict[str, Any],
    *,
    include_admin_link: bool = True,
) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    base_url = os.environ.get("ADMIN_ORDER_BASE_URL", "").strip().rstrip("/")
    order_id = event.get("admin_order_id")
    if include_admin_link and base_url.startswith("https://") and isinstance(order_id, int):
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


def _notification_event(event: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    is_api_gateway = isinstance(event.get("requestContext"), dict)
    if not is_api_gateway:
        return event, False
    raw_body = event.get("body")
    if not isinstance(raw_body, str):
        raise RuntimeError("Notification payload is missing")
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Notification payload is invalid") from exc
    if not isinstance(body, dict):
        raise RuntimeError("Notification payload is invalid")
    return body, True


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    authorization = _authorizer_response(event)
    if authorization is not None:
        return authorization
    notification, is_api_gateway = _notification_event(event)
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    delivery_token = os.environ.get("TELEGRAM_DELIVERY_BOT_TOKEN", "").strip() or token
    legacy_chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    owner_chat_id = os.environ.get("TELEGRAM_OWNER_CHAT_ID", "").strip() or legacy_chat_id
    pharmacy_chat_id = os.environ.get("TELEGRAM_PHARMACY_CHAT_ID", "").strip() or owner_chat_id
    delivery_chat_id = os.environ.get("TELEGRAM_DELIVERY_CHAT_ID", "").strip() or owner_chat_id
    if not token or not owner_chat_id:
        raise RuntimeError("Telegram notification configuration is incomplete")
    if notification.get("notification_kind") == "staff_manual_order":
        deliveries = [(token, owner_chat_id, format_owner_message(notification), True)]
        configured_delivery_chat = os.environ.get("TELEGRAM_DELIVERY_CHAT_ID", "").strip()
        if configured_delivery_chat and configured_delivery_chat != owner_chat_id:
            deliveries.append((delivery_token, configured_delivery_chat, format_delivery_message(notification), False))
    else:
        deliveries = (
            (token, owner_chat_id, format_owner_message(notification), True),
            (token, pharmacy_chat_id, format_pharmacy_message(notification), True),
            (delivery_token, delivery_chat_id, format_delivery_message(notification), False),
        )
    for message_token, chat_id, text, include_admin_link in deliveries:
        _send_message(
            message_token,
            chat_id,
            text,
            notification,
            include_admin_link=include_admin_link,
        )
    result = {"ok": True, "order_reference": notification.get("order_reference"), "messages_sent": len(deliveries)}
    if is_api_gateway:
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "body": json.dumps({"data": result, "request_id": "telegram-notifier"}),
        }
    return result
