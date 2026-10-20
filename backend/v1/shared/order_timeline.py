"""Order history («История», job 016): one chronology from existing sources, no new table.

Sources: `orders.created_at`, `order_status_history` rows and `admin_audit_log` rows of the order
(`resource_type='order'`) and of its items (`resource_type='order_item'`). Every row is mapped to a
small event with whitelisted keys only; a raw audit `details` object never leaves this module.
Unknown actions become `{"kind": "other"}` without details. Russian text is built in Next.js
(`src/lib/order-timeline.ts`).

Pure functions only: the admin Lambda reads the rows and calls `build_timeline` / `courier_view`.
"""

from __future__ import annotations

import json
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from backend.v1.shared.order_time import absolute_order_time, order_time_iso

TIMELINE_LIMIT = 200

ORDER_STATUSES = frozenset({"pending", "confirmed", "delivering", "delivered", "cancelled"})
PHARMACY_ANSWERS = frozenset({"available", "unavailable", "price_differs"})
ASSEMBLY_STATES = frozenset({"assembling", "assembled"})
CUSTOMER_FIELDS = ("customer_name", "phone", "address", "landmark", "comment")

# Every key an event may carry. `fields` is a list of {field, previous, current}.
EVENT_KEYS = frozenset({
    "at", "kind", "actor", "pharmacy_id", "order_item_id", "medicine_name", "from_status", "to_status",
    "answer", "previous_price", "new_price", "client_price", "step", "done", "reason", "state", "count",
    "fields",
})

# Courier (job 016 criterion 2): kinds and keys kept; everything else is dropped.
COURIER_KINDS: dict[str, frozenset[str]] = {
    "created": frozenset({"to_status"}),
    "status_changed": frozenset({"from_status", "to_status", "reason"}),
    "pharmacy_answer": frozenset({"pharmacy_id", "order_item_id", "medicine_name", "answer"}),
    "pharmacy_routed": frozenset({"pharmacy_id", "order_item_id", "medicine_name"}),
    "pharmacy_price_changed": frozenset({"pharmacy_id", "order_item_id", "medicine_name", "previous_price",
                                         "new_price", "client_price"}),
    "item_collected": frozenset({"pharmacy_id", "order_item_id", "medicine_name"}),
    "assembly_marked": frozenset({"pharmacy_id", "state"}),
    "assembly_reopened": frozenset({"pharmacy_id"}),
    "checklist_updated": frozenset({"step", "done"}),
}
COURIER_ACTIONS = (
    "pharmacy.order.items_answered", "pharmacy.order.item_price_changed", "pharmacy.order.item_collected",
    "pharmacy.order.assembly_marked", "pharmacy.order.assembly_reopened", "courier.order.checklist_updated",
)

_STATUS_DEDUPE_SECONDS = 120


def _text(value: Any, maximum: int = 300) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text[:maximum] if text else None


def _amount(value: Any) -> str | None:
    """A money/quantity value as a plain decimal string, or None when it is not a finite number."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return str(number) if number.is_finite() else None


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        number = int(str(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _status(value: Any) -> str | None:
    return value if value in ORDER_STATUSES else None


def _details(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def staff_actor(account_id: Any) -> dict[str, Any]:
    """Staff account 1/2 are the pharmacies «Ватан 1»/«Ватан 2», 3 is the courier."""
    number = _int(account_id)
    if number in (1, 2):
        return {"actor": "pharmacy", "pharmacy_id": number}
    if number == 3:
        return {"actor": "courier"}
    return {"actor": "system"}


def audit_actor(actor_id: Any) -> dict[str, Any]:
    text = str(actor_id or "")
    if text.startswith("staff:"):
        return staff_actor(text.removeprefix("staff:"))
    return {"actor": "admin"} if text else {"actor": "system"}


def history_actor(actor_type: Any, actor_id: Any) -> dict[str, Any]:
    if actor_type == "customer":
        return {"actor": "customer"}
    if actor_type == "admin":
        return {"actor": "admin"}
    if actor_type == "staff":
        text = str(actor_id or "")
        return staff_actor(text.removeprefix("courier:"))
    return {"actor": "system"}


def creator_actor(created_by_staff_account_id: Any) -> dict[str, Any]:
    if created_by_staff_account_id is None:
        return {"actor": "customer"}
    return staff_actor(created_by_staff_account_id)


def _clean(event: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in event.items() if key in EVENT_KEYS and value is not None}


def _changes(pairs: Iterable[tuple[str, Any, Any]]) -> list[dict[str, Any]]:
    return [{"field": field, "previous": previous, "current": current}
            for field, previous, current in pairs if previous != current]


def map_status_row(row: dict[str, Any]) -> dict[str, Any]:
    """One `order_status_history` row. `from_status IS NULL` marks the creation row."""
    event = {"at": order_time_iso(row["created_at"]), "kind": "status_changed",
             **history_actor(row.get("actor_type"), row.get("actor_id")),
             "from_status": _status(row.get("from_status")), "to_status": _status(row.get("to_status")),
             "reason": _text(row.get("reason"), 500)}
    return _clean(event)


def map_audit_row(row: dict[str, Any], item_names: dict[int, str] | None = None) -> list[dict[str, Any]]:
    """One `admin_audit_log` row -> zero or more events (an answer row lists several items)."""
    names = item_names or {}
    action = str(row.get("action") or "")
    details = _details(row.get("details"))
    at = order_time_iso(row["created_at"])
    base: dict[str, Any] = {"at": at, **audit_actor(row.get("actor_id"))}
    resource_item = _int(row.get("resource_id")) if row.get("resource_type") == "order_item" else None

    def item_name(item_id: int | None) -> str | None:
        return _text(details.get("medicine_name")) or (names.get(item_id) if item_id else None)

    def per_item(entry: Any) -> tuple[int | None, str | None]:
        item_id = _int(entry.get("order_item_id")) if isinstance(entry, dict) else None
        return item_id, _text(names.get(item_id)) if item_id else None

    pharmacy = _int(details.get("pharmacy_id"))
    if base["actor"] == "pharmacy":
        pharmacy = base["pharmacy_id"]

    if action == "pharmacy.order.items_answered":
        routed_ids = details.get("routed_to_pharmacy_2")
        routed = {_int(value) for value in routed_ids} if isinstance(routed_ids, list) else set()
        events = []
        for entry in details.get("items") or []:
            item_id, name = per_item(entry)
            answer = entry.get("answer") if isinstance(entry, dict) else None
            if item_id is None or answer not in PHARMACY_ANSWERS:
                continue
            kind = "pharmacy_routed" if item_id in routed else "pharmacy_answer"
            events.append(_clean({**base, "kind": kind, "pharmacy_id": pharmacy, "order_item_id": item_id,
                                  "medicine_name": name, "answer": answer}))
        return events
    if action == "pharmacy.order.item_price_changed":
        events = []
        for entry in details.get("items") or []:
            item_id, name = per_item(entry)
            if item_id is None:
                continue
            events.append(_clean({**base, "kind": "pharmacy_price_changed", "pharmacy_id": pharmacy,
                                  "order_item_id": item_id, "medicine_name": name,
                                  "previous_price": _amount(entry.get("previous_base_unit_price")),
                                  "new_price": _amount(entry.get("new_base_unit_price")),
                                  "client_price": _amount(entry.get("new_selling_unit_price"))}))
        return events
    if action == "pharmacy.order.item_collected":
        item_id = _int(details.get("order_item_id"))
        return [_clean({**base, "kind": "item_collected", "pharmacy_id": pharmacy, "order_item_id": item_id,
                        "medicine_name": _text(names.get(item_id)) if item_id else None})]
    if action == "pharmacy.order.assembly_marked":
        state = details.get("to_state")
        return [_clean({**base, "kind": "assembly_marked", "pharmacy_id": pharmacy,
                        "state": state if state in ASSEMBLY_STATES else None})]
    if action == "pharmacy.order.assembly_reopened":
        # Written with actor «Ватан 1» (it routed an item); the reopened part is always «Ватан 2».
        return [_clean({**base, "kind": "assembly_reopened"})]
    if action == "courier.order.checklist_updated":
        step = _int(details.get("step"))
        done = details.get("done")
        return [_clean({**base, "kind": "checklist_updated", "step": step if step and step <= 7 else None,
                        "done": done if isinstance(done, bool) else None})]
    if action == "courier.order.status_changed":
        return [_clean({**base, "kind": "status_changed", "from_status": _status(details.get("from_status")),
                        "to_status": _status(details.get("to_status"))})]
    if action in {"order.customer_updated", "courier.order.customer_updated"}:
        previous = details.get("previous") if isinstance(details.get("previous"), dict) else {}
        current = details.get("current") if isinstance(details.get("current"), dict) else {}
        fields = _changes((field, _text(previous.get(field), 500), _text(current.get(field), 500))
                          for field in CUSTOMER_FIELDS if field in previous or field in current)
        return [_clean({**base, "kind": "customer_updated", "fields": fields})]
    if action == "order.item_price_updated":
        fields = _changes([
            ("client_price", _amount(details.get("previous_unit_price")), _amount(details.get("new_unit_price"))),
            ("pharmacy_price", _amount(details.get("previous_base_unit_price")),
             _amount(details.get("new_base_unit_price"))),
        ])
        return [_clean({**base, "kind": "item_updated", "order_item_id": resource_item,
                        "medicine_name": item_name(resource_item), "fields": fields})]
    if action in {"order.item_quantity_set", "courier.order.item_updated"}:
        pairs = [("quantity", _amount(details.get("previous_quantity")), _amount(details.get("new_quantity")))]
        if action == "courier.order.item_updated":
            pairs.append(("client_price", _amount(details.get("previous_price")), _amount(details.get("new_price"))))
        # The courier's audit stores None for an unchanged value.
        fields = _changes((field, previous, current) for field, previous, current in pairs if current is not None)
        return [_clean({**base, "kind": "item_updated", "order_item_id": resource_item,
                        "medicine_name": item_name(resource_item), "fields": fields})]
    if action in {"order.item_removed", "courier.order.item_removed"}:
        return [_clean({**base, "kind": "item_removed", "order_item_id": resource_item,
                        "medicine_name": item_name(resource_item)})]
    if action in {"admin.order.items_added", "courier.order.items_added", "order.manual_items_added"}:
        added = details.get("manual_items") if action == "order.manual_items_added" else details.get("items")
        return [_clean({**base, "kind": "items_added",
                        "count": len(added) if isinstance(added, list) else None})]
    if action == "order.delivery_fee_updated":
        fields = _changes([
            ("courier_amount", _amount(details.get("previous_courier_amount")), _amount(details.get("courier_amount"))),
            ("owner_amount", _amount(details.get("previous_owner_amount")), _amount(details.get("owner_amount"))),
        ])
        return [_clean({**base, "kind": "delivery_fee_updated", "fields": fields})]
    if action == "order.soft_delete":
        return [_clean({**base, "kind": "deleted"})]
    if action == "staff.order.created":
        return [_clean({**base, "kind": "created"})]
    return [_clean({**base, "kind": "other"})]


def _moment(event: dict[str, Any]) -> datetime:
    return absolute_order_time(event["at"])


def build_timeline(
    *,
    created_at: Any,
    creator: dict[str, Any] | None,
    status_rows: Iterable[dict[str, Any]],
    audit_rows: Iterable[dict[str, Any]],
    item_names: dict[int, str] | None = None,
    source_truncated: bool = False,
    limit: int = TIMELINE_LIMIT,
) -> tuple[list[dict[str, Any]], bool]:
    """All events sorted by time, then source row id; the `limit` newest, oldest first.

    The creation is one event at `orders.created_at`: the history row `NULL -> status` and the audit
    `staff.order.created` are folded into it. A courier status audit duplicates the history row written
    in the same transaction and is dropped when that row is present.
    """
    keyed: list[tuple[datetime, int, int, int, dict[str, Any]]] = []
    created: dict[str, Any] = {"at": order_time_iso(created_at), "kind": "created", **(creator or {})}
    history_moves: list[tuple[datetime, Any, Any]] = []
    for row in status_rows:
        event = map_status_row(row)
        if row.get("from_status") is None:
            if creator is None and event.get("actor"):
                created.update({key: event[key] for key in ("actor", "pharmacy_id") if key in event})
            if event.get("to_status") and event["to_status"] != "pending":
                created["to_status"] = event["to_status"]
            continue
        history_moves.append((_moment(event), event.get("from_status"), event.get("to_status")))
        keyed.append((_moment(event), 1, int(row.get("id") or 0), 0, event))
    for row in audit_rows:
        for index, event in enumerate(map_audit_row(row, item_names)):
            if event["kind"] == "created":
                if creator is None and not created.get("actor"):
                    created.update({key: event[key] for key in ("actor", "pharmacy_id") if key in event})
                continue
            if event["kind"] == "status_changed" and any(
                    move[1:] == (event.get("from_status"), event.get("to_status"))
                    and abs((move[0] - _moment(event)).total_seconds()) <= _STATUS_DEDUPE_SECONDS
                    for move in history_moves):
                continue
            keyed.append((_moment(event), 2, int(row.get("id") or 0), index, event))
    created.setdefault("actor", "system")
    keyed.append((_moment(created), 0, 0, 0, _clean(created)))
    keyed.sort(key=lambda entry: entry[:4])
    events = [entry[4] for entry in keyed]
    truncated = source_truncated or len(events) > limit
    return events[-limit:], truncated


def courier_view(events: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """The courier's short history: no client data values, owner share, admin edits or deletion.

    Admin actors stay anonymous («Администратор»); a status reason is kept only for a cancellation.
    """
    result = []
    for event in events:
        allowed = COURIER_KINDS.get(event.get("kind"))
        if allowed is None:
            continue
        kept = {key: value for key, value in event.items() if key in allowed}
        if event.get("kind") == "status_changed" and event.get("to_status") != "cancelled":
            kept.pop("reason", None)
        actor = event.get("actor") if event.get("actor") in {"customer", "admin", "courier", "pharmacy"} else "system"
        if actor == "pharmacy" and event.get("pharmacy_id") in (1, 2):
            kept["pharmacy_id"] = event["pharmacy_id"]
        result.append({"at": event["at"], "kind": event["kind"], "actor": actor, **kept})
    return result
