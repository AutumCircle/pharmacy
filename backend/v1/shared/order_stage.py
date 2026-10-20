"""Customer-facing order stage (job 013), derived from orders.status and the job 011 assembly marks.

Stages: assembling («Собирается») -> assembled («Собран») -> confirmed («Подтверждён») -> delivering
(«В пути») -> delivered («Доставлен»), plus cancelled. Nothing is stored: «Собран» is a pending website
order whose every assembly pharmacy marked its part «Сборка сделана». An assembly pharmacy is the
distinct effective pharmacy of the items its current pharmacy did not answer «Нет в наличии» (the same
rule as the courier projection and the «Согласовано» gate). Staff-created orders, orders with nothing
to assemble and orders from before job 011 stay «Собирается» while pending.

The SQL fragment is one correlated boolean expression per order row, so a list query keeps a fixed
number of statements whatever the number of orders. The client never sends a stage.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

STAGES = ("assembling", "assembled", "confirmed", "delivering", "delivered", "cancelled")
_ONE_TO_ONE = frozenset({"confirmed", "delivering", "delivered", "cancelled"})


def assembled_sql(alias: str = "o") -> str:
    """Boolean SQL: the order row `alias` is a pending website order whose assembly is complete.

    `alias` is a fixed SQL identifier chosen by the caller (never client input)."""
    if not alias.isidentifier():
        raise ValueError("alias must be an SQL identifier")
    pharmacy = f"COALESCE(stage_oi.fulfillment_pharmacy_id, {alias}.fulfillment_pharmacy_id, 1)"
    return f"""({alias}.status = 'pending' AND {alias}.created_by_staff_account_id IS NULL
        AND COALESCE((
            SELECT COUNT(*) > 0 AND bool_and(stage_asm.state IS NOT DISTINCT FROM 'assembled')
            FROM (SELECT DISTINCT {pharmacy} AS pharmacy_id
                  FROM order_items stage_oi
                  LEFT JOIN order_item_pharmacy_answers stage_cur
                         ON stage_cur.order_item_id = stage_oi.id AND stage_cur.pharmacy_id = {pharmacy}
                  WHERE stage_oi.order_id = {alias}.id
                    AND stage_cur.answer IS DISTINCT FROM 'unavailable') stage_parts
            LEFT JOIN order_pharmacy_assembly stage_asm
                   ON stage_asm.order_id = {alias}.id AND stage_asm.pharmacy_id = stage_parts.pharmacy_id
        ), false))"""


def assembly_complete(website_order: bool, part_states: Iterable[Any]) -> bool:
    """Python twin of assembled_sql for rows that already carry the assembly parts (courier projection):
    a website order with at least one assembly pharmacy, every one of them 'assembled'."""
    states = list(part_states)
    return bool(website_order) and bool(states) and all(state == "assembled" for state in states)


def order_stage(status: Any, assembled: Any = False) -> str:
    """Maps orders.status plus the derived «all pharmacies assembled» flag to the stage."""
    if status == "pending":
        return "assembled" if assembled is True else "assembling"
    if status in _ONE_TO_ONE:
        return str(status)
    # Unknown/legacy status: never claim progress the order has not made.
    return "assembling"
