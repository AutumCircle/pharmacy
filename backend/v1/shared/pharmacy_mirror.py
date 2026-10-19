"""Raw mirror of pharmacy Oracle tables, written by the per-pharmacy agent.

The agent detects changes on the pharmacy computer and sends batches of changed rows and
deleted keys for one table at a time. This module validates those batches and applies them
idempotently. It never touches the storefront tables (``medicines`` etc.).
"""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from psycopg2.extras import Json, execute_values

from .contract import ContractError
from .database import transaction


# Product, stock, batch and dictionary tables only. Sales receipts, fiscal documents,
# discount cards and employees are deliberately not mirrored.
DEFAULT_MIRROR_TABLES = frozenset({
    "T_PRODUCT", "T_SKLAD_STATE", "T_INCOME", "T_INCOME_HEAD", "T_VENDOR", "T_COUNTRY",
    "T_PRODUCT_MNN", "T_PRODUCT_GROUP", "T_PRODUCT_SOSTAV", "T_SKLAD", "T_MEASURE",
    "T_PRODUCT_TYPE",
})
ORACLE_NAME_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
MAX_UPSERTS_PER_BATCH = 5000
MAX_DELETES_PER_BATCH = 20000
MAX_COLUMNS_PER_ROW = 300
MAX_KEY_LENGTH = 200
MAX_TEXT_VALUE_LENGTH = 4000
MAX_STATUS_BYTES = 8192
BATCH_FIELDS = {"batch_id", "pharmacy_id", "table", "generated_at", "upserts", "deletes"}
UPSERT_FIELDS = {"key", "change_id", "data"}


@dataclass(frozen=True)
class MirrorRow:
    key: str
    change_id: int | None
    data: dict[str, Any]


@dataclass(frozen=True)
class MirrorBatch:
    batch_id: str
    pharmacy_id: int
    table: str
    generated_at: datetime
    upserts: list[MirrorRow]
    deletes: list[str]


def allowed_tables() -> frozenset[str]:
    configured = os.environ.get("PHARMACY_MIRROR_TABLES", "").strip()
    if not configured:
        return DEFAULT_MIRROR_TABLES
    return frozenset(name.strip().upper() for name in configured.split(",") if name.strip())


def _invalid(message: str) -> ContractError:
    return ContractError("VALIDATION_ERROR", message)


def _key(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > MAX_KEY_LENGTH or value != value.strip():
        raise _invalid("Row key is invalid")
    return value


def _value(value: Any) -> Any:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise _invalid("Row value is not a finite number")
        return value
    if isinstance(value, str):
        if len(value) > MAX_TEXT_VALUE_LENGTH or "\x00" in value:
            raise _invalid("Row text value is invalid")
        return value
    raise _invalid("Row values must be scalars")


def _row(raw: Any) -> MirrorRow:
    if not isinstance(raw, dict) or not set(raw) <= UPSERT_FIELDS or "key" not in raw or "data" not in raw:
        raise _invalid("Upsert row shape is invalid")
    change_id = raw.get("change_id")
    if change_id is not None and (isinstance(change_id, bool) or not isinstance(change_id, int) or change_id < 0):
        raise _invalid("change_id must be a non-negative integer or null")
    data = raw["data"]
    if not isinstance(data, dict) or not data or len(data) > MAX_COLUMNS_PER_ROW:
        raise _invalid("Row data is invalid")
    clean: dict[str, Any] = {}
    for column, value in data.items():
        if not isinstance(column, str) or not ORACLE_NAME_PATTERN.match(column):
            raise _invalid("Column name is invalid")
        clean[column] = _value(value)
    return MirrorRow(key=_key(raw["key"]), change_id=change_id, data=clean)


def _generated_at(value: Any) -> datetime:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise _invalid("generated_at is invalid") from exc
    if parsed.tzinfo is None:
        raise _invalid("generated_at must include a timezone")
    return parsed


def validate_batch(payload: dict[str, Any], pharmacy_id: int) -> MirrorBatch:
    if set(payload) != BATCH_FIELDS:
        raise _invalid("Batch fields are invalid")
    if payload["pharmacy_id"] != pharmacy_id or isinstance(payload["pharmacy_id"], bool):
        raise ContractError("FORBIDDEN", "Batch belongs to another pharmacy", http_status=403)
    try:
        batch_id = str(UUID(str(payload["batch_id"])))
    except ValueError as exc:
        raise _invalid("batch_id must be a UUID") from exc
    table = payload["table"]
    if not isinstance(table, str) or not ORACLE_NAME_PATTERN.match(table) or table not in allowed_tables():
        raise _invalid("Table is not allowed")
    upserts_raw, deletes_raw = payload["upserts"], payload["deletes"]
    if not isinstance(upserts_raw, list) or not isinstance(deletes_raw, list):
        raise _invalid("upserts and deletes must be lists")
    if len(upserts_raw) > MAX_UPSERTS_PER_BATCH or len(deletes_raw) > MAX_DELETES_PER_BATCH:
        raise _invalid("Batch is too large")
    if not upserts_raw and not deletes_raw:
        raise _invalid("Batch is empty")
    upserts = [_row(raw) for raw in upserts_raw]
    deletes = [_key(raw) for raw in deletes_raw]
    upsert_keys = {row.key for row in upserts}
    if len(upsert_keys) != len(upserts) or len(set(deletes)) != len(deletes) or upsert_keys & set(deletes):
        raise _invalid("Batch contains duplicate keys")
    return MirrorBatch(
        batch_id=batch_id, pharmacy_id=pharmacy_id, table=table,
        generated_at=_generated_at(payload["generated_at"]), upserts=upserts, deletes=deletes,
    )


def _lock_active_pharmacy(cur: Any, pharmacy_id: int) -> None:
    cur.execute(
        "SELECT is_active FROM pharmacy_sources WHERE pharmacy_id = %s FOR UPDATE",
        (pharmacy_id,),
    )
    row = cur.fetchone()
    if not row or not row["is_active"]:
        raise ContractError("PHARMACY_INACTIVE", "Pharmacy is not registered or inactive", http_status=409)


def apply_batch(batch: MirrorBatch) -> dict[str, Any]:
    """Apply one batch atomically. Re-sending the same batch_id is a no-op."""

    with transaction() as cur:
        _lock_active_pharmacy(cur, batch.pharmacy_id)
        cur.execute(
            """
            INSERT INTO pharmacy_mirror_batches
                (batch_id, pharmacy_id, table_name, upserted_count, deleted_count, generated_at)
            VALUES (%s, %s, %s, 0, 0, %s)
            ON CONFLICT (batch_id) DO NOTHING
            RETURNING batch_id
            """,
            (batch.batch_id, batch.pharmacy_id, batch.table, batch.generated_at),
        )
        if cur.fetchone() is None:
            cur.execute(
                """
                SELECT pharmacy_id, table_name, upserted_count, deleted_count
                FROM pharmacy_mirror_batches WHERE batch_id = %s
                """,
                (batch.batch_id,),
            )
            existing = cur.fetchone()
            if not existing or existing["pharmacy_id"] != batch.pharmacy_id or existing["table_name"] != batch.table:
                raise ContractError("BATCH_CONFLICT", "batch_id was already used for another batch", http_status=409)
            return {
                "batch_id": batch.batch_id, "already_applied": True,
                "upserted_count": existing["upserted_count"], "deleted_count": existing["deleted_count"],
            }

        upserted = 0
        if batch.upserts:
            # The agent sends batches strictly one after another and retries a failed batch
            # before moving on, so the last applied batch is the newest state. generated_at is
            # informational only: the pharmacy computer clock is not trusted for ordering.
            execute_values(
                cur,
                """
                INSERT INTO pharmacy_mirror_rows
                    (pharmacy_id, table_name, row_key, change_id, data, source_generated_at)
                VALUES %s
                ON CONFLICT (pharmacy_id, table_name, row_key) DO UPDATE SET
                    change_id = EXCLUDED.change_id,
                    data = EXCLUDED.data,
                    source_generated_at = EXCLUDED.source_generated_at,
                    received_at = CURRENT_TIMESTAMP
                """,
                [
                    (batch.pharmacy_id, batch.table, row.key, row.change_id, Json(row.data), batch.generated_at)
                    for row in batch.upserts
                ],
                page_size=len(batch.upserts),
            )
            upserted = max(0, cur.rowcount)
        deleted = 0
        if batch.deletes:
            cur.execute(
                """
                DELETE FROM pharmacy_mirror_rows
                WHERE pharmacy_id = %s AND table_name = %s AND row_key = ANY(%s)
                """,
                (batch.pharmacy_id, batch.table, batch.deletes),
            )
            deleted = max(0, cur.rowcount)
        cur.execute(
            "UPDATE pharmacy_mirror_batches SET upserted_count = %s, deleted_count = %s WHERE batch_id = %s",
            (upserted, deleted, batch.batch_id),
        )
        cur.execute(
            """
            UPDATE pharmacy_sources
            SET last_batch_at = CURRENT_TIMESTAMP, last_seen_at = CURRENT_TIMESTAMP
            WHERE pharmacy_id = %s
            """,
            (batch.pharmacy_id,),
        )
    return {"batch_id": batch.batch_id, "already_applied": False, "upserted_count": upserted, "deleted_count": deleted}


def record_heartbeat(payload: dict[str, Any], pharmacy_id: int) -> dict[str, Any]:
    if not set(payload) <= {"pharmacy_id", "agent_version", "status"} or payload.get("pharmacy_id") != pharmacy_id:
        raise _invalid("Heartbeat fields are invalid")
    version = payload.get("agent_version")
    if not isinstance(version, str) or not 1 <= len(version) <= 40:
        raise _invalid("agent_version is invalid")
    status = payload.get("status", {})
    if not isinstance(status, dict) or len(json.dumps(status, ensure_ascii=False)) > MAX_STATUS_BYTES:
        raise _invalid("status is invalid")
    with transaction() as cur:
        cur.execute(
            """
            UPDATE pharmacy_sources
            SET last_seen_at = CURRENT_TIMESTAMP, agent_version = %s, agent_status = %s
            WHERE pharmacy_id = %s AND is_active
            RETURNING last_seen_at
            """,
            (version, Json(status), pharmacy_id),
        )
        row = cur.fetchone()
    if not row:
        raise ContractError("PHARMACY_INACTIVE", "Pharmacy is not registered or inactive", http_status=409)
    return {"pharmacy_id": pharmacy_id, "last_seen_at": row["last_seen_at"]}


def mirror_status(pharmacy_id: int) -> dict[str, Any]:
    """Per-table row counts the agent compares with its local state on start-up."""

    with transaction() as cur:
        cur.execute(
            """
            SELECT table_name, COUNT(*) AS row_count, MAX(change_id) AS max_change_id,
                   MAX(received_at) AS last_received_at
            FROM pharmacy_mirror_rows
            WHERE pharmacy_id = %s
            GROUP BY table_name
            ORDER BY table_name
            """,
            (pharmacy_id,),
        )
        tables = [dict(row) for row in cur.fetchall()]
    return {"pharmacy_id": pharmacy_id, "tables": tables}
