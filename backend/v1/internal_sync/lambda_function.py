"""Internal S3-backed full-snapshot catalogue synchronization Lambda."""

from __future__ import annotations

import gzip
import hashlib
import io
import json
import os
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import psycopg2
from psycopg2.extras import execute_values

from backend.v1.shared.authorization import require_sync_identity
from backend.v1.shared.catalog_sync import MAX_SNAPSHOT_ROWS, SnapshotValidationError, validate_snapshot
from backend.v1.shared.contract import ContractError
from backend.v1.shared.database import transaction
from backend.v1.shared.responses import error_response, request_id, success


PRESIGNED_URL_SECONDS = 900
MAX_COMPRESSED_BYTES = 20 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 60 * 1024 * 1024
SHA256_PATTERN = set("0123456789abcdef")
DEFAULT_MIN_SNAPSHOT_RATIO = 0.50
REFERENCE_HISTORY_LIMIT = 20
_s3 = None


def _s3_client():
    """Create the runtime-provided boto3 client lazily so pure tests need no AWS SDK."""

    global _s3
    if _s3 is None:
        import boto3

        _s3 = boto3.client("s3")
    return _s3


def _body(event: dict[str, Any]) -> dict[str, Any]:
    raw = event.get("body") or "{}"
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError as exc:
        raise ContractError("VALIDATION_ERROR", "Malformed JSON request body") from exc
    if not isinstance(parsed, dict):
        raise ContractError("VALIDATION_ERROR", "Request body must be a JSON object")
    return parsed


def _bucket() -> str:
    value = os.environ.get("SYNC_BUCKET", "").strip()
    if not value:
        raise ContractError("SYNC_CONFIGURATION_ERROR", "Sync storage is not configured", http_status=500)
    return value


def _minimum_rows() -> int:
    try:
        return max(1, int(os.environ.get("SYNC_MIN_EXPECTED_ROWS", "5000")))
    except ValueError as exc:
        raise ContractError("SYNC_CONFIGURATION_ERROR", "Sync configuration is invalid", http_status=500) from exc


def _expected_source() -> str:
    value = os.environ.get("SYNC_SOURCE_ID", "").strip()
    if not value:
        raise ContractError("SYNC_CONFIGURATION_ERROR", "Sync source is not configured", http_status=500)
    return value


def _import_timeout_ms() -> int:
    try:
        return min(25_000, max(5_000, int(os.environ.get("SYNC_IMPORT_TIMEOUT_MS", "25000"))))
    except ValueError as exc:
        raise ContractError("SYNC_CONFIGURATION_ERROR", "Sync configuration is invalid", http_status=500) from exc


def _minimum_snapshot_ratio() -> float:
    try:
        value = float(os.environ.get("SYNC_MIN_SNAPSHOT_RATIO", str(DEFAULT_MIN_SNAPSHOT_RATIO)))
    except (TypeError, ValueError):
        value = DEFAULT_MIN_SNAPSHOT_RATIO
    return min(0.90, max(0.25, value))


def evaluate_snapshot_drop(
    incoming_count: int,
    current_active_count: int,
    recent_reference_count: int,
    minimum_ratio: float,
) -> tuple[bool, int, float]:
    reference_count = max(int(current_active_count or 0), int(recent_reference_count or 0))
    if reference_count <= 0:
        return True, reference_count, 1.0
    ratio = float(incoming_count) / float(reference_count)
    return ratio >= minimum_ratio, reference_count, ratio


def _enforce_snapshot_guard(cur: Any, source_id: str, incoming_count: int) -> None:
    cur.execute(
        "SELECT COUNT(*) FROM medicines WHERE source_system = %s AND in_stock = TRUE",
        (source_id,),
    )
    current_active_count = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT COALESCE(MAX(received_row_count), 0)
        FROM (
            SELECT received_row_count
            FROM catalog_syncs
            WHERE source_id = %s AND status = 'succeeded'
              AND received_row_count IS NOT NULL AND received_row_count > 0
            ORDER BY completed_at DESC
            LIMIT %s
        ) recent_syncs
        """,
        (source_id, REFERENCE_HISTORY_LIMIT),
    )
    recent_reference_count = int(cur.fetchone()[0])
    minimum_ratio = _minimum_snapshot_ratio()
    allowed, reference_count, ratio = evaluate_snapshot_drop(
        incoming_count,
        current_active_count,
        recent_reference_count,
        minimum_ratio,
    )
    print(json.dumps({
        "event": "snapshot_guard",
        "source_id": source_id,
        "incoming_count": incoming_count,
        "current_active_count": current_active_count,
        "recent_reference_count": recent_reference_count,
        "reference_count": reference_count,
        "ratio": round(ratio, 6),
        "minimum_ratio": minimum_ratio,
        "allowed": allowed,
    }, sort_keys=True))
    if not allowed:
        raise SnapshotValidationError(
            "SUSPICIOUS_SNAPSHOT_DROP",
            "Snapshot was rejected because its row count dropped catastrophically",
            details={
                "incoming_count": incoming_count,
                "reference_count": reference_count,
                "ratio": round(ratio, 6),
                "minimum_ratio": minimum_ratio,
            },
        )


def _sync_id(value: Any) -> str:
    try:
        return str(UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ContractError("VALIDATION_ERROR", "sync_id is invalid") from exc


def _upload_target(object_key: str, checksum: str) -> dict[str, Any]:
    upload_headers = {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "x-amz-meta-sha256": checksum,
    }
    upload_url = _s3_client().generate_presigned_url(
        "put_object",
        Params={
            "Bucket": _bucket(), "Key": object_key,
            "ContentType": upload_headers["Content-Type"],
            "ContentEncoding": upload_headers["Content-Encoding"],
            "Metadata": {"sha256": checksum},
        },
        ExpiresIn=PRESIGNED_URL_SECONDS,
    )
    return {"method": "PUT", "url": upload_url, "headers": upload_headers}


def initiate_sync(payload: dict[str, Any], principal: str, idempotency_key: str) -> dict[str, Any]:
    allowed = {
        "source_id", "source_updated_at", "file_name", "compressed_size_bytes",
        "expected_row_count", "snapshot_sha256",
    }
    if set(payload) != allowed:
        raise ContractError("VALIDATION_ERROR", "Invalid sync initiation request")
    source_id = payload.get("source_id")
    checksum = payload.get("snapshot_sha256")
    if not isinstance(source_id, str) or source_id.strip() != _expected_source():
        raise ContractError("VALIDATION_ERROR", "source_id is invalid")
    if not isinstance(checksum, str) or len(checksum) != 64 or set(checksum) - SHA256_PATTERN:
        raise ContractError("VALIDATION_ERROR", "snapshot_sha256 is invalid")
    try:
        expected_rows = int(payload["expected_row_count"])
    except (TypeError, ValueError) as exc:
        raise ContractError("VALIDATION_ERROR", "expected_row_count is invalid") from exc
    if not _minimum_rows() <= expected_rows <= MAX_SNAPSHOT_ROWS:
        raise ContractError("VALIDATION_ERROR", "expected_row_count is outside the safe range")
    try:
        idempotency_key = str(UUID(idempotency_key))
        compressed_size = int(payload["compressed_size_bytes"])
    except (ValueError, TypeError, KeyError) as exc:
        raise ContractError("VALIDATION_ERROR", "Sync metadata is invalid") from exc
    file_name = payload.get("file_name")
    source_updated_at = payload.get("source_updated_at")
    if not isinstance(file_name, str) or not 1 <= len(file_name.strip()) <= 255:
        raise ContractError("VALIDATION_ERROR", "file_name is invalid")
    if not isinstance(source_updated_at, str) or not source_updated_at.strip():
        raise ContractError("VALIDATION_ERROR", "source_updated_at is invalid")
    try:
        parsed_source_time = datetime.fromisoformat(source_updated_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError("VALIDATION_ERROR", "source_updated_at is invalid") from exc
    if parsed_source_time.tzinfo is None:
        raise ContractError("VALIDATION_ERROR", "source_updated_at must include a timezone")
    if not 1 <= compressed_size <= MAX_COMPRESSED_BYTES:
        raise ContractError("VALIDATION_ERROR", "compressed_size_bytes is invalid")

    with transaction() as cur:
        cur.execute(
            """
            SELECT sync_id, source_id, snapshot_sha256, expected_row_count, status, object_key
            FROM catalog_syncs WHERE idempotency_key = %s
            """,
            (idempotency_key,),
        )
        existing = cur.fetchone()
    if existing:
        if (
            existing["source_id"] != source_id.strip()
            or existing["snapshot_sha256"] != checksum
            or existing["expected_row_count"] != expected_rows
        ):
            raise ContractError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used", http_status=409)
        result = {
            "sync_id": str(existing["sync_id"]), "status": existing["status"],
            "already_created": True,
        }
        if existing["status"] == "awaiting_upload":
            result["upload"] = _upload_target(existing["object_key"], checksum)
            result["expires_in_seconds"] = PRESIGNED_URL_SECONDS
        return result

    sync_id = str(uuid4())
    object_key = f"catalog-syncs/{source_id.strip()}/{sync_id}.json.gz"
    upload = _upload_target(object_key, checksum)
    with transaction() as cur:
        cur.execute(
            """
            INSERT INTO catalog_syncs
                (sync_id, idempotency_key, source_id, initiated_by, object_key,
                 snapshot_sha256, source_updated_at, file_name, compressed_size_bytes,
                 expected_row_count)
            VALUES (%s, %s, %s, %s, %s, %s, %s::timestamptz, %s, %s, %s)
            """,
            (
                sync_id, idempotency_key, source_id.strip(), principal, object_key,
                checksum, source_updated_at, file_name.strip(), compressed_size, expected_rows,
            ),
        )
    return {
        "sync_id": sync_id,
        "status": "awaiting_upload",
        "upload": upload,
        "expires_in_seconds": PRESIGNED_URL_SECONDS,
    }


def _load_snapshot(sync: dict[str, Any]) -> dict[str, Any]:
    try:
        response = _s3_client().get_object(Bucket=_bucket(), Key=sync["object_key"])
    except Exception as exc:
        error_response_data = getattr(exc, "response", {})
        if error_response_data.get("Error", {}).get("Code") in {"NoSuchKey", "404"}:
            raise SnapshotValidationError("UPLOAD_NOT_FOUND", "Snapshot upload was not found") from exc
        raise
    content_length = int(response.get("ContentLength") or 0)
    if content_length != sync["compressed_size_bytes"] or content_length > MAX_COMPRESSED_BYTES:
        raise SnapshotValidationError("INVALID_FILE_SIZE", "Uploaded snapshot has an invalid size")
    compressed = response["Body"].read(MAX_COMPRESSED_BYTES + 1)
    if len(compressed) != content_length or len(compressed) > MAX_COMPRESSED_BYTES:
        raise SnapshotValidationError("INVALID_FILE_SIZE", "Uploaded snapshot has an invalid size")
    if hashlib.sha256(compressed).hexdigest() != sync["snapshot_sha256"]:
        raise SnapshotValidationError("CHECKSUM_MISMATCH", "Uploaded snapshot checksum does not match")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(compressed), mode="rb") as stream:
            raw = stream.read(MAX_UNCOMPRESSED_BYTES + 1)
    except (OSError, EOFError) as exc:
        raise SnapshotValidationError("INVALID_GZIP", "Uploaded snapshot is not valid gzip") from exc
    if len(raw) > MAX_UNCOMPRESSED_BYTES:
        raise SnapshotValidationError("SNAPSHOT_TOO_LARGE", "Uncompressed snapshot exceeds the size limit")
    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SnapshotValidationError("INVALID_JSON", "Uploaded snapshot is not valid UTF-8 JSON") from exc
    if not isinstance(document, dict) or set(document) != {"format", "source_id", "generated_at", "records"}:
        raise SnapshotValidationError("INVALID_SNAPSHOT", "Snapshot document shape is invalid")
    if document["format"] != "vatan-catalog-snapshot/v1" or document["source_id"] != sync["source_id"]:
        raise SnapshotValidationError("INVALID_SNAPSHOT", "Snapshot metadata does not match initiation request")
    return document


def _record_rejection(sync_id: str, error: SnapshotValidationError) -> None:
    with transaction() as cur:
        cur.execute(
            """
            UPDATE catalog_syncs
            SET status = 'failed', error_code = %s, error_summary = %s::jsonb,
                conflict_count = %s,
                completed_at = CURRENT_TIMESTAMP
            WHERE sync_id = %s AND status <> 'succeeded'
            """,
            (error.code, json.dumps(error.details), int(error.details.get("conflict_count", 0)), sync_id),
        )
        for conflict in error.details.get("conflicts", []):
            cur.execute(
                """
                INSERT INTO catalog_sync_conflicts
                    (sync_id, identity_key, row_numbers, reason, safe_summary)
                VALUES (%s, %s, %s, 'duplicate_identity', %s::jsonb)
                """,
                (sync_id, conflict["identity_key"], conflict["row_numbers"], json.dumps({"row_numbers": conflict["row_numbers"]})),
            )


def _import_snapshot(
    sync: dict[str, Any],
    items: list[Any],
    *,
    raw_row_count: int,
    duplicate_resolutions: list[Any],
) -> dict[str, Any]:
    sync_id = sync["sync_id"]
    source_id = sync["source_id"]
    with transaction() as cur:
        cur.execute("SET LOCAL statement_timeout = %s", (_import_timeout_ms(),))
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"catalog-sync:{source_id}",))
        cur.execute("SELECT status FROM catalog_syncs WHERE sync_id = %s FOR UPDATE", (sync_id,))
        current = cur.fetchone()
        if not current:
            raise ContractError("SYNC_NOT_FOUND", "Sync was not found", http_status=404)
        if current["status"] == "succeeded":
            return {"sync_id": sync_id, "status": "succeeded", "already_completed": True}
        if current["status"] == "failed":
            raise ContractError("SYNC_FAILED", "Sync has failed", http_status=409)
        cur.execute(
            "UPDATE catalog_syncs SET status = 'importing', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE sync_id = %s",
            (sync_id,),
        )
        cur.execute("DELETE FROM catalog_sync_items WHERE sync_id = %s", (sync_id,))
        cur.execute("DELETE FROM catalog_sync_conflicts WHERE sync_id = %s", (sync_id,))
        execute_values(
            cur,
            """
            INSERT INTO catalog_sync_items
                (sync_id, row_number, source_sku, raw_name, canonical_name, country,
                 vendor, base_price, in_stock, identity_key, source_row_hash)
            VALUES %s
            """,
            [(
                sync_id, item.row_number, item.source_sku, item.raw_name, item.canonical_name,
                item.country, item.vendor, item.base_price, item.in_stock,
                item.identity_key, item.source_row_hash,
            ) for item in items],
            page_size=1000,
        )
        if duplicate_resolutions:
            execute_values(
                cur,
                """
                INSERT INTO catalog_sync_conflicts
                    (sync_id, identity_key, row_numbers, reason, safe_summary)
                VALUES %s
                """,
                [(
                    sync_id,
                    resolution.identity_key,
                    resolution.row_numbers,
                    "fallback_duplicate_merged",
                    json.dumps({
                        "selected_row_number": resolution.selected_row_number,
                        "policy": resolution.policy,
                    }),
                ) for resolution in duplicate_resolutions],
                page_size=100,
            )

        # Guard the full snapshot while holding the same advisory transaction
        # lock, before any UPDATE/INSERT against medicines.
        _enforce_snapshot_guard(cur, source_id, raw_row_count)

        # Existing catalogue is from this single pharmacy source. Mark ownership
        # before the first v1 snapshot so missing rows can safely become inactive.
        cur.execute(
            "UPDATE medicines SET source_system = %s WHERE source_system IS NULL",
            (source_id,),
        )
        cur.execute(
            """
            WITH candidates AS (
                SELECT
                    m.id,
                    i.identity_key,
                    i.source_sku,
                    ROW_NUMBER() OVER (
                        PARTITION BY i.identity_key
                        ORDER BY
                            CASE WHEN m.name = i.canonical_name
                                      AND COALESCE(m.country, '') = i.country
                                      AND COALESCE(m.vendor, '') = i.vendor
                                 THEN 0 ELSE 1 END,
                            m.id
                    ) AS candidate_rank
                FROM catalog_sync_items i
                JOIN medicines m
                  ON m.source_identity_key IS NULL
                 AND lower(btrim(m.name)) = lower(btrim(i.canonical_name))
                 AND lower(btrim(COALESCE(m.country, ''))) = lower(btrim(i.country))
                 AND lower(btrim(COALESCE(m.vendor, ''))) = lower(btrim(i.vendor))
                WHERE i.sync_id = %s
            )
            UPDATE medicines m
            SET source_system = %s,
                source_sku = candidates.source_sku,
                source_identity_key = candidates.identity_key
            FROM candidates
            WHERE candidates.candidate_rank = 1 AND m.id = candidates.id
            """,
            (sync_id, source_id),
        )
        cur.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE m.id IS NULL) AS inserted_count,
                COUNT(*) FILTER (WHERE m.id IS NOT NULL) AS updated_count
            FROM catalog_sync_items i
            LEFT JOIN medicines m
              ON m.source_system = %s AND m.source_identity_key = i.identity_key
            WHERE i.sync_id = %s
            """,
            (source_id, sync_id),
        )
        counts = dict(cur.fetchone())
        cur.execute(
            """
            INSERT INTO medicines
                (name, price, country, vendor, in_stock, source_system, source_sku,
                 source_identity_key,
                 last_seen_sync_id, source_row_hash, updated_at)
            SELECT canonical_name, base_price, country, vendor, in_stock, %s,
                   source_sku, identity_key, %s, source_row_hash, CURRENT_TIMESTAMP
            FROM catalog_sync_items WHERE sync_id = %s
            ON CONFLICT (source_system, source_identity_key)
                WHERE source_system IS NOT NULL AND source_identity_key IS NOT NULL
            DO UPDATE SET
                name = EXCLUDED.name,
                price = EXCLUDED.price, in_stock = EXCLUDED.in_stock,
                country = EXCLUDED.country, vendor = EXCLUDED.vendor,
                source_sku = EXCLUDED.source_sku,
                last_seen_sync_id = EXCLUDED.last_seen_sync_id,
                source_row_hash = EXCLUDED.source_row_hash, updated_at = CURRENT_TIMESTAMP
            """,
            (source_id, sync_id, sync_id),
        )
        cur.execute(
            """
            UPDATE medicines SET in_stock = FALSE, updated_at = CURRENT_TIMESTAMP
            WHERE source_system = %s AND last_seen_sync_id IS DISTINCT FROM %s AND in_stock IS TRUE
            """,
            (source_id, sync_id),
        )
        cur.execute(
            """
            SELECT COUNT(*) FILTER (WHERE in_stock) AS in_stock_count,
                   COUNT(*) FILTER (WHERE NOT in_stock) AS out_of_stock_count
            FROM medicines WHERE source_system = %s
            """,
            (source_id,),
        )
        stock = dict(cur.fetchone())
        cur.execute(
            """
            UPDATE catalog_syncs
            SET status = 'succeeded', received_row_count = %s, inserted_count = %s,
                updated_count = %s, in_stock_count = %s, out_of_stock_count = %s,
                conflict_count = %s,
                completed_at = CURRENT_TIMESTAMP, error_code = NULL, error_summary = NULL
            WHERE sync_id = %s
            """,
            (
                raw_row_count, counts["inserted_count"], counts["updated_count"],
                stock["in_stock_count"], stock["out_of_stock_count"],
                len(duplicate_resolutions), sync_id,
            ),
        )
        cur.execute(
            """
            INSERT INTO sync_logs (upserted_count, in_stock_count, out_of_stock_count)
            VALUES (%s, %s, %s)
            """,
            (len(items), stock["in_stock_count"], stock["out_of_stock_count"]),
        )
    return {
        "sync_id": sync_id, "status": "succeeded", "received_row_count": raw_row_count,
        "merged_item_count": len(items),
        "resolved_duplicate_count": len(duplicate_resolutions),
        "inserted_count": counts["inserted_count"], "updated_count": counts["updated_count"],
        "in_stock_count": stock["in_stock_count"], "out_of_stock_count": stock["out_of_stock_count"],
    }


def commit_sync(sync_id: str) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT sync_id, source_id, status, object_key, snapshot_sha256,
                   compressed_size_bytes, expected_row_count, source_updated_at
            FROM catalog_syncs WHERE sync_id = %s
            """,
            (sync_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ContractError("SYNC_NOT_FOUND", "Sync was not found", http_status=404)
    sync = dict(row)
    if sync["status"] == "succeeded":
        return {"sync_id": sync_id, "status": "succeeded", "already_completed": True}
    if sync["status"] == "failed":
        raise ContractError("SYNC_FAILED", "Sync has failed", http_status=409)
    with transaction() as cur:
        cur.execute(
            "UPDATE catalog_syncs SET status = 'validating', started_at = COALESCE(started_at, CURRENT_TIMESTAMP) WHERE sync_id = %s",
            (sync_id,),
        )
    try:
        document = _load_snapshot(sync)
        try:
            generated_at = datetime.fromisoformat(str(document["generated_at"]).replace("Z", "+00:00"))
        except (ValueError, TypeError) as exc:
            raise SnapshotValidationError("INVALID_SNAPSHOT", "Snapshot generated_at is invalid") from exc
        if generated_at.tzinfo is None or generated_at != sync["source_updated_at"]:
            raise SnapshotValidationError("INVALID_SNAPSHOT", "Snapshot source timestamp does not match")
        snapshot = validate_snapshot(
            document["records"], source_id=sync["source_id"],
            expected_row_count=sync["expected_row_count"], minimum_row_count=_minimum_rows(),
        )
    except SnapshotValidationError as exc:
        _record_rejection(sync_id, exc)
        raise ContractError(exc.code, exc.safe_message, http_status=422) from exc
    return _import_snapshot(
        sync,
        snapshot.items,
        raw_row_count=snapshot.raw_row_count,
        duplicate_resolutions=snapshot.duplicate_resolutions,
    )


def get_sync(sync_id: str) -> dict[str, Any]:
    with transaction() as cur:
        cur.execute(
            """
            SELECT sync_id, source_id, status, expected_row_count, received_row_count,
                   inserted_count, updated_count, in_stock_count, out_of_stock_count,
                   conflict_count, error_code, created_at, started_at, completed_at
            FROM catalog_syncs WHERE sync_id = %s
            """,
            (sync_id,),
        )
        row = cur.fetchone()
    if not row:
        raise ContractError("SYNC_NOT_FOUND", "Sync was not found", http_status=404)
    return dict(row)


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    current_request_id = request_id()
    try:
        principal = require_sync_identity(event)
        method = str(event.get("httpMethod") or "").upper()
        path = str(event.get("path") or "")
        parts = [part for part in path.strip("/").split("/") if part]
        tail = parts[parts.index("internal") + 1:] if "internal" in parts else []
        if method == "POST" and path.endswith("/internal/catalog-syncs"):
            headers = {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}
            key = str(headers.get("idempotency-key") or "")
            return success(initiate_sync(_body(event), principal, key), status_code=201, request=current_request_id)
        if method == "POST" and len(tail) == 3 and tail[0] == "catalog-syncs" and tail[2] == "commit":
            return success(commit_sync(_sync_id(tail[1])), request=current_request_id)
        if method == "GET" and len(tail) == 2 and tail[0] == "catalog-syncs":
            return success(get_sync(_sync_id(tail[1])), request=current_request_id)
        raise ContractError("ROUTE_NOT_FOUND", "Route was not found", http_status=404)
    except ContractError as exc:
        return error_response(exc, request=current_request_id)
    except psycopg2.Error:
        return error_response(ContractError("INTERNAL_ERROR", "Internal server error", http_status=500), request=current_request_id)
    except Exception:
        return error_response(ContractError("INTERNAL_ERROR", "Internal server error", http_status=500), request=current_request_id)
