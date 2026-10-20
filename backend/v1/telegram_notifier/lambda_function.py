"""Send a new-order notification to one configured Telegram chat."""

from __future__ import annotations

import html
import hmac
import json
import os
import re
import urllib.error
import urllib.request
from decimal import Decimal, InvalidOperation
from typing import Any

from backend.v1.shared.order_notification_messages import format_configured_message
from backend.v1.shared.order_notification_settings import default_policies


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


def _quantity(value: Any) -> str:
    try:
        quantity = Decimal(str(value)).quantize(Decimal("0.01"))
        return format(quantity.normalize(), "f")
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
        quantity = _quantity(item.get("quantity"))
        price = item.get(price_key)
        line = f"• {name} × {quantity} — {_money(price)}"
        if sum(len(part) + 1 for part in lines) + len(line) > 3200:
            lines.append("• …остальные товары смотрите в админ-панели")
            break
        lines.append(line)
    return lines


def _medicine_lines(event: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    for item in event.get("items") or []:
        if not isinstance(item, dict):
            continue
        line = f"• {html.escape(str(item.get('medicine_name') or 'Товар'))} × {_quantity(item.get('quantity'))}"
        if sum(len(part) + 1 for part in lines) + len(line) > 2900:
            lines.append("• …остальные товары смотрите в панели заказов")
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
            f"🚚 <b>Новый заказ от доставщика · аптека {account_id}</b>",
            f"🧾 Заказ: {reference}",
            f"👤 {actor_label}: {username}",
            f"📨 Источник: {source}",
            "",
            f"Клиент: {customer}",
            f"📞 Телефон: {phone}",
            f"📍 Адрес: {address}",
            f"🧭 Ориентир: {landmark}",
        ]
        comment = str(event.get("comment") or "").strip()
        if comment:
            lines.append(f"💬 Комментарий: {html.escape(comment[:500])}")
        items = event.get("items") if isinstance(event.get("items"), list) else []
        if items:
            lines.extend(["", "<b>Товары — аптека / клиент:</b>"])
            for item in items:
                if not isinstance(item, dict):
                    continue
                name = html.escape(str(item.get("medicine_name") or "Товар"))
                quantity = _quantity(item.get("quantity"))
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
    reference, customer, phone, address = _identity(event)
    lines = [
        f"📊 <b>Новый заказ {reference} — для владельца</b>",
        "🏥 Аптека 1 · заказ с сайта",
        f"👤 Клиент: {customer}",
        f"📞 Телефон: {phone}",
        f"📍 Адрес: {address}",
        "",
        "<b>Товары:</b>",
    ]
    lines.extend(_item_lines(event, "line_total"))
    lines.extend([
        "",
        f"💵 <b>Сумма заказа: {_money(event.get('order_total'))}</b>",
        f"📈 <b>Валовая прибыль: {_money(event.get('profit'))}</b>",
    ])
    if event.get("comment"):
        lines.append(f"💬 Комментарий: {html.escape(str(event['comment'])[:500])}")
    attribution = [str(event.get(key) or "").strip() for key in
                   ("source_collection", "utm_source", "utm_medium", "utm_campaign", "utm_content")]
    if any(attribution):
        lines.append("🔗 Источник: " + html.escape(" / ".join(value or "—" for value in attribution)))
    return "\n".join(lines)


def format_pharmacy_message(event: dict[str, Any]) -> str:
    reference, _, _, _ = _identity(event)
    lines = [
        f"💊 <b>Аптека 1 · заказ {reference} — собрать</b>",
        "",
        "<b>Товары:</b>",
    ]
    lines.extend(_item_lines(event, "base_line_total"))
    lines.extend([
        "",
        f"🧾 <b>Итого: {_money(event.get('base_total'))}</b>",
    ])
    if event.get("comment"):
        lines.append(f"💬 Комментарий: {html.escape(str(event['comment'])[:500])}")
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
    if event.get("notification_kind") != "staff_manual_order":
        lines.insert(1, "🏥 Забрать из аптеки 1")
        lines.extend(["", "<b>Лекарства:</b>"])
        lines.extend(_medicine_lines(event))
    else:
        landmark = html.escape(str(event.get("landmark") or "—"))
        pharmacy_id = event.get("fulfillment_pharmacy_id") or event.get("created_by_staff_account_id")
        lines.insert(1, f"🏥 Аптека {html.escape(str(pharmacy_id or '—'))}")
        lines.append(f"🧭 Ориентир: {landmark}")
        items = event.get("items") if isinstance(event.get("items"), list) else []
        if items:
            lines.extend(["", "<b>Доставить:</b>"])
            lines.extend(_medicine_lines(event))
    comment = str(event.get("comment") or "").strip()
    if comment:
        lines.extend(["", f"💬 Комментарий: {html.escape(comment[:500])}"])
    else:
        lines.extend(["", "💬 Комментарий: нет"])
    return "\n".join(lines)


def format_message(event: dict[str, Any]) -> str:
    """Backward-compatible owner message formatter."""
    return format_owner_message(event)


def _claim_delivery(event_key: str, recipient: str) -> dict[str, Any]:
    url = os.environ.get("NOTIFICATION_CLAIM_API_URL", "").strip()
    api_key = os.environ.get("NOTIFICATION_CLAIM_API_KEY", "").strip()
    bearer = os.environ.get("NOTIFICATION_CLAIM_TOKEN", "").strip()
    if not url.startswith("https://") or not api_key or not bearer:
        raise RuntimeError("Notification claim configuration is incomplete")
    request = urllib.request.Request(url,
        data=json.dumps({"event_key": event_key, "recipient": recipient}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-api-key": api_key,
                 "Authorization": f"Bearer {bearer}"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError("Notification claim failed") from exc
    result = body.get("data") if isinstance(body, dict) else None
    if not isinstance(result, dict) or type(result.get("claimed")) is not bool:
        raise RuntimeError("Notification claim returned invalid data")
    return result


def _send_message(
    token: str,
    chat_id: str,
    text: str,
    event: dict[str, Any],
    *,
    include_admin_link: bool = True,
    buttons: list[dict[str, str]] | None = None,
) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    base_url = os.environ.get("ADMIN_ORDER_BASE_URL", "").strip().rstrip("/")
    order_id = event.get("admin_order_id")
    if buttons:
        payload["reply_markup"] = {"inline_keyboard": [buttons]}
    elif include_admin_link and base_url.startswith("https://") and isinstance(order_id, int):
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


def courier_buttons(event: dict[str, Any]) -> list[dict[str, str]]:
    """Open the order in the courier cabinet and dial the client (Telegram buttons cannot use tel: links)."""
    site = os.environ.get("STAFF_SITE_BASE_URL", "").strip().rstrip("/")
    if not site.startswith("https://"):
        return []
    buttons = []
    public_id = str(event.get("order_id") or "")
    if re.fullmatch(r"ord_[0-9a-f]{32}", public_id):
        buttons.append({"text": "📦 Открыть заказ", "url": f"{site}/staff/orders/{public_id}"})
    digits = "".join(character for character in str(event.get("phone") or "") if character.isdigit())
    if len(digits) == 9:
        digits = f"992{digits}"
    if re.fullmatch(r"992[0-9]{9}", digits):
        buttons.append({"text": "📞 Позвонить", "url": f"{site}/call/{digits}"})
    return buttons


def format_courier_assembly_message(event: dict[str, Any]) -> str:
    """Copy of the pharmacy picking list the courier can forward to the pharmacy."""
    fields = default_policies()["pharmacy_telegram"]
    text = format_configured_message(event, fields, "pharmacy_telegram")
    first, _, rest = text.partition("\n")
    pharmacy = html.escape(str(event.get("fulfillment_pharmacy_id") or 1))
    return f"{first}\n🏥 Аптека {pharmacy} · переслать в аптеку\n{rest}"


PHARMACY_CHANGE_KIND = "pharmacy_item_change"
_PHARMACY_CHANGE_RECIPIENTS = ("owner_telegram", "courier_telegram")


def _plain_money(value: Any) -> str:
    try:
        return str(Decimal(str(value)).quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return "—"


def _price_change_text(change: dict[str, Any], fields: dict[str, Any]) -> str:
    """«цена изменена: old → new с.»; base prices only with item_base_total, client prices only with
    item_client_total in the claimed recipient policy."""
    parts: list[str] = []
    if fields.get("item_base_total"):
        parts.append(f"{_plain_money(change.get('old_base_unit_price'))} → "
                     f"{_plain_money(change.get('new_base_unit_price'))} с.")
    if fields.get("item_client_total"):
        client = (f"{_plain_money(change.get('old_selling_unit_price'))} → "
                  f"{_plain_money(change.get('new_selling_unit_price'))} с.")
        parts.append(f"клиенту {client}")
    if not parts:
        return "цена изменена"
    if len(parts) == 2:
        return f"цена изменена: {parts[0]} ({parts[1]})"
    return f"цена изменена: {parts[0]}"


def format_pharmacy_change_message(event: dict[str, Any], fields: dict[str, Any]) -> str:
    """Job 013: a pharmacy changed a price or passed an item to «Ватан 2»; job 014: «Ватан 2» has no
    stock either («нет в наличии в обеих аптеках»). No client data at all."""
    reference = html.escape(str(event.get("order_reference") or "—"))
    pharmacy = event.get("pharmacy_id")
    pharmacy_label = f"Ватан {pharmacy}" if pharmacy in (1, 2) else "Аптека"
    lines = [f"🔔 <b>Заказ № {reference} · {pharmacy_label}</b>"]
    changes = event.get("changes") if isinstance(event.get("changes"), list) else []
    for change in changes:
        if not isinstance(change, dict):
            continue
        name = html.escape(str(change.get("medicine_name") or "Товар"))
        line = f"• «{name}» × {_quantity(change.get('quantity'))} — "
        if change.get("kind") == "routed":
            line += "передано в Ватан 2"
        elif change.get("kind") == "unavailable_both":
            line += "нет в наличии в обеих аптеках"
        elif change.get("kind") == "price":
            line += _price_change_text(change, fields)
        else:
            continue
        if sum(len(part) + 1 for part in lines) + len(line) > 3500:
            lines.append("• …остальные изменения смотрите в панели заказов")
            break
        lines.append(line)
    return "\n".join(lines)


def _pharmacy_change_event_key(notification: dict[str, Any], order_id: int) -> str:
    event_key = notification.get("event_key")
    if (not isinstance(event_key, str)
            or not re.fullmatch(rf"order:{order_id}:pharmacy-change:req_[0-9a-f]{{32}}", event_key)):
        raise RuntimeError("Notification event key is invalid")
    return event_key


def _send_pharmacy_change(
    notification: dict[str, Any], order_id: int, token: str, owner_chat_id: str,
    delivery_token: str, delivery_chat_id: str,
) -> int:
    """Owner and (if enabled and configured) courier; never the pharmacy, no picking list."""
    event_key = _pharmacy_change_event_key(notification, order_id)
    recipients = [("owner_telegram", token, owner_chat_id)]
    if delivery_chat_id:
        recipients.append(("courier_telegram", delivery_token, delivery_chat_id))
    sent = 0
    for recipient, message_token, chat_id in recipients:
        claim = _claim_delivery(event_key, recipient)
        if not claim["claimed"]:
            continue
        fields = claim.get("fields")
        if not isinstance(fields, dict):
            raise RuntimeError("Notification policy is missing")
        text = format_pharmacy_change_message(notification, fields)
        if recipient == "courier_telegram":
            buttons = [button for button in courier_buttons({"order_id": notification.get("order_id")})
                       if button["text"] == "📦 Открыть заказ"]
            _send_message(message_token, chat_id, text, notification, include_admin_link=False,
                          buttons=buttons or None)
        else:
            _send_message(message_token, chat_id, text, notification, include_admin_link=True)
        sent += 1
    return sent


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
    pharmacy_chat_id = os.environ.get("TELEGRAM_PHARMACY_CHAT_ID", "").strip()
    delivery_chat_id = os.environ.get("TELEGRAM_DELIVERY_CHAT_ID", "").strip()
    if not token or not owner_chat_id:
        raise RuntimeError("Telegram notification configuration is incomplete")
    order_id = notification.get("admin_order_id")
    if type(order_id) is not int or order_id <= 0:
        raise RuntimeError("Notification order ID is missing")
    if notification.get("notification_kind") == PHARMACY_CHANGE_KIND:
        messages_sent = _send_pharmacy_change(notification, order_id, token, owner_chat_id,
                                              delivery_token, delivery_chat_id)
        return _handler_result(notification, messages_sent, is_api_gateway)
    # Pharmacy and courier are notified only about website orders; staff orders are entered by them.
    is_website_order = notification.get("notification_kind") != "staff_manual_order"
    recipients = [("owner_telegram", token, owner_chat_id, True)]
    if is_website_order and pharmacy_chat_id:
        recipients.append(("pharmacy_telegram", token, pharmacy_chat_id, False))
    if is_website_order and delivery_chat_id:
        recipients.append(("courier_telegram", delivery_token, delivery_chat_id, False))
    messages_sent = 0
    for recipient, message_token, chat_id, include_admin_link in recipients:
        claim = _claim_delivery(f"order:{order_id}:created", recipient)
        if not claim["claimed"]:
            continue
        fields = claim.get("fields")
        if not isinstance(fields, dict):
            raise RuntimeError("Notification policy is missing")
        _send_message(message_token, chat_id, format_configured_message(notification, fields, recipient),
                      notification, include_admin_link=include_admin_link,
                      buttons=courier_buttons(notification) if recipient == "courier_telegram" else None)
        messages_sent += 1
        if recipient == "courier_telegram":
            _send_message(message_token, chat_id, format_courier_assembly_message(notification),
                          notification, include_admin_link=False)
            messages_sent += 1
    return _handler_result(notification, messages_sent, is_api_gateway)


def _handler_result(notification: dict[str, Any], messages_sent: int, is_api_gateway: bool) -> dict[str, Any]:
    result = {"ok": True, "order_reference": notification.get("order_reference"), "messages_sent": messages_sent}
    if is_api_gateway:
        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
            "body": json.dumps({"data": result, "request_id": "telegram-notifier"}),
        }
    return result
