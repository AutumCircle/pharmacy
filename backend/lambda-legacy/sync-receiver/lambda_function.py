"""
Pharmacy Sync Lambda Handler
-----------------------------
Receives gzip-compressed JSON from the pharmacy agent (via API Gateway),
validates the payload, and performs UPSERT into Amazon RDS PostgreSQL.

Environment Variables (set in Lambda configuration):
    DB_HOST     — RDS endpoint (e.g. pharmacy-db.xxxx.us-east-1.rds.amazonaws.com)
    DB_PORT     — Usually 5432
    DB_NAME     — Database name (e.g. pharmacy_db)
    DB_USER     — Database username
    DB_PASSWORD — Database password
"""

import os
import json
import gzip
import base64
import logging
import hashlib
from datetime import datetime, timezone
from uuid import UUID

import psycopg2
from psycopg2.extras import execute_values

# --- Configuration ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

DB_CONFIG = {
    "host": os.environ.get("DB_HOST"),
    "port": int(os.environ.get("DB_PORT", 5432)),
    "dbname": os.environ.get("DB_NAME"),
    "user": os.environ.get("DB_USER"),
    "password": os.environ.get("DB_PASSWORD"),
    "connect_timeout": 10,
}
MIN_SYNC_ROWS = 1
MAX_SYNC_ROWS = int(os.environ.get("SYNC_MAX_EXPECTED_ROWS", "100000"))
DEFAULT_MIN_SNAPSHOT_RATIO = 0.50
REFERENCE_HISTORY_LIMIT = 20

# Connection reuse across Lambda invocations (warm starts)
_connection = None


class SuspiciousSnapshotError(ValueError):
    code = "SUSPICIOUS_SNAPSHOT_DROP"

    def __init__(self, incoming_count, reference_count, ratio, minimum_ratio):
        super().__init__("Snapshot was rejected because its row count dropped catastrophically")
        self.details = {
            "incoming_count": incoming_count,
            "reference_count": reference_count,
            "ratio": round(ratio, 6),
            "minimum_ratio": minimum_ratio,
        }


def minimum_snapshot_ratio():
    try:
        value = float(os.environ.get("SYNC_MIN_SNAPSHOT_RATIO", str(DEFAULT_MIN_SNAPSHOT_RATIO)))
    except (TypeError, ValueError):
        value = DEFAULT_MIN_SNAPSHOT_RATIO
    return min(0.90, max(0.25, value))


def evaluate_snapshot_drop(incoming_count, current_active_count, recent_reference_count, minimum_ratio):
    reference_count = max(int(current_active_count or 0), int(recent_reference_count or 0))
    if reference_count <= 0:
        return True, reference_count, 1.0
    ratio = float(incoming_count) / float(reference_count)
    return ratio >= minimum_ratio, reference_count, ratio


def enforce_snapshot_guard(cur, incoming_count):
    cur.execute("SELECT COUNT(*) FROM medicines WHERE in_stock = TRUE")
    current_active_count = int(cur.fetchone()[0])
    cur.execute(
        """
        SELECT COALESCE(MAX(upserted_count), 0)
        FROM (
            SELECT upserted_count
            FROM sync_logs
            WHERE upserted_count IS NOT NULL AND upserted_count > 0
            ORDER BY sync_time DESC
            LIMIT %s
        ) recent_syncs
        """,
        (REFERENCE_HISTORY_LIMIT,),
    )
    recent_reference_count = int(cur.fetchone()[0])
    minimum_ratio = minimum_snapshot_ratio()
    allowed, reference_count, ratio = evaluate_snapshot_drop(
        incoming_count,
        current_active_count,
        recent_reference_count,
        minimum_ratio,
    )
    logger.info(
        "Snapshot guard: incoming=%s current_active=%s recent_reference=%s "
        "effective_reference=%s ratio=%.6f minimum_ratio=%.2f allowed=%s",
        incoming_count,
        current_active_count,
        recent_reference_count,
        reference_count,
        ratio,
        minimum_ratio,
        allowed,
    )
    if not allowed:
        raise SuspiciousSnapshotError(incoming_count, reference_count, ratio, minimum_ratio)


def get_connection():
    """Get or create a database connection. Reuses connection on warm starts."""
    global _connection
    if _connection is None or _connection.closed:
        logger.info("Creating new database connection...")
        _connection = psycopg2.connect(**DB_CONFIG)
        _connection.autocommit = False
        logger.info(f"Connected to {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['dbname']}")
    return _connection


def decompress_body(event):
    """
    Extract and decompress the request body from API Gateway event.
    Handles both gzip-compressed and plain JSON payloads.
    API Gateway may base64-encode binary bodies.
    """
    body = event.get("body", "")
    is_base64 = event.get("isBase64Encoded", False)

    # API Gateway base64-encodes binary (gzip) bodies
    if is_base64:
        body = base64.b64decode(body)
    elif isinstance(body, str):
        body = body.encode("utf-8")

    # Check for gzip magic bytes (1f 8b)
    if body[:2] == b"\x1f\x8b":
        logger.info("Decompressing gzip payload...")
        body = gzip.decompress(body)

    return body.decode("utf-8")


def validate_payload(medicines):
    """Basic validation of the incoming medicine list."""
    if not isinstance(medicines, list):
        raise ValueError("Payload must be a JSON array")

    if len(medicines) == 0:
        raise ValueError("Payload is empty (0 records)")
    if not MIN_SYNC_ROWS <= len(medicines) <= MAX_SYNC_ROWS:
        raise ValueError(
            f"Snapshot row count {len(medicines)} is outside the safe range "
            f"{MIN_SYNC_ROWS}..{MAX_SYNC_ROWS}"
        )

    # Validate first record structure
    required_fields = {"name", "price"}
    sample = medicines[0]
    missing = required_fields - set(sample.keys())
    if missing:
        raise ValueError(f"Missing required fields in first record: {missing}")

    # Validate price is numeric
    if not isinstance(sample.get("price"), (int, float)):
        raise ValueError(f"'price' must be a number, got {type(sample['price'])}")

    return True


def parse_snapshot(raw_body):
    document = json.loads(raw_body)
    required = {
        "format", "sync_id", "generated_at", "expected_row_count",
        "snapshot_sha256", "records",
    }
    if not isinstance(document, dict) or set(document) != required:
        raise ValueError("Snapshot document has an invalid shape")
    if document["format"] != "vatan-direct-catalog-snapshot/v2":
        raise ValueError("Unsupported snapshot format")
    try:
        sync_id = str(UUID(str(document["sync_id"])))
        expected = int(document["expected_row_count"])
    except (ValueError, TypeError, AttributeError) as exc:
        raise ValueError("Snapshot metadata is invalid") from exc
    medicines = document["records"]
    validate_payload(medicines)
    if len(medicines) != expected:
        raise ValueError("Snapshot row count does not match expected_row_count")
    records_json = json.dumps(medicines, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    checksum = hashlib.sha256(records_json.encode("utf-8")).hexdigest()
    if checksum != document["snapshot_sha256"]:
        raise ValueError("Snapshot checksum does not match")
    return sync_id, checksum, medicines


def clean_catalog_attribute(value):
    return "" if value is None else str(value)


def deduplicate_medicines(medicines):
    """
    Deduplicate by (name, country, vendor) composite key.
    The source OSTATKI.DBF contains absolute duplicates that would cause
    execute_values + ON CONFLICT to crash with a duplicate key error
    within the same batch insert.
    Maximum-price strategy for normalized duplicate keys.
    """
    seen = {}
    for med in medicines:
        cleaned = dict(med)
        cleaned["name"] = (med.get("name") or "").strip()
        cleaned["country"] = clean_catalog_attribute(med.get("country"))
        cleaned["vendor"] = clean_catalog_attribute(med.get("vendor"))
        key = (
            cleaned["name"].casefold(),
            cleaned["vendor"].casefold(),
            cleaned["country"].casefold(),
        )
        current = seen.get(key)
        if current is None or float(cleaned["price"]) > float(current["price"]):
            seen[key] = cleaned
    return list(seen.values())


def upsert_medicines(conn, medicines, sync_id, snapshot_sha256):
    """
    Perform a full inventory sync:
    1. Deduplicate by (name, country, vendor) to prevent batch conflicts
    2. Mark ALL existing medicines as out_of_stock
    3. UPSERT all incoming medicines (marking them as in_stock)

    This ensures that medicines removed from the pharmacy's DBF
    are correctly marked as unavailable.
    """
    cur = conn.cursor()

    try:
        # Serialize full-snapshot writers. The safety comparison and all catalogue
        # mutations stay in the same transaction behind this lock.
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ("pharmacy-full-catalog-sync",))

        # Create sync_logs table if not exists
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sync_logs (
                id SERIAL PRIMARY KEY,
                sync_time TIMESTAMP DEFAULT NOW(),
                upserted_count INTEGER,
                in_stock_count INTEGER,
                out_of_stock_count INTEGER,
                sync_id UUID UNIQUE,
                snapshot_sha256 CHAR(64)
            )
        """)

        cur.execute("""
            SELECT upserted_count, in_stock_count, out_of_stock_count
            FROM sync_logs WHERE sync_id = %s
        """, (sync_id,))
        existing = cur.fetchone()
        if existing:
            conn.rollback()
            return {
                "upserted": existing[0],
                "in_stock": existing[1],
                "out_of_stock": existing[2],
                "already_completed": True,
            }

        # Step 1: Deduplicate
        unique_medicines = deduplicate_medicines(medicines)
        logger.info(
            f"Deduplicated: {len(medicines)} raw → {len(unique_medicines)} unique "
            f"({len(medicines) - len(unique_medicines)} duplicates removed)"
        )

        # Reject a catastrophic drop before any catalogue UPDATE/INSERT. There
        # is deliberately no request-level override for this destructive path.
        enforce_snapshot_guard(cur, len(unique_medicines))

        # Step 2: Mark everything as out of stock
        cur.execute("UPDATE medicines SET in_stock = FALSE")
        marked_out = cur.rowcount
        logger.info(f"Marked {marked_out} existing records as out_of_stock")

        # Step 3: Batch UPSERT all unique medicines
        values = [
            (
                med["name"].strip(),
                float(med["price"]),
                med.get("country", ""),
                med.get("vendor", ""),
            )
            for med in unique_medicines
        ]

        execute_values(
            cur,
            """
            INSERT INTO medicines (name, price, country, vendor, in_stock, updated_at)
            VALUES %s
            ON CONFLICT (name, country, vendor) DO UPDATE SET
                price      = EXCLUDED.price,
                in_stock   = TRUE,
                updated_at = NOW()
            """,
            values,
            template="(%s, %s, %s, %s, TRUE, NOW())",
            page_size=500,
        )

        # Step 3: Get summary stats
        cur.execute("SELECT COUNT(*) FROM medicines WHERE in_stock = TRUE")
        in_stock_count = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM medicines WHERE in_stock = FALSE")

        out_of_stock_count = cur.fetchone()[0]

        logger.info(
            f"Sync complete: {len(unique_medicines)} upserted, "
            f"{in_stock_count} in stock, {out_of_stock_count} out of stock"
        )

        cur.execute("""
            INSERT INTO sync_logs
                (upserted_count, in_stock_count, out_of_stock_count, sync_id, snapshot_sha256)
            VALUES (%s, %s, %s, %s, %s)
        """, (len(unique_medicines), in_stock_count, out_of_stock_count, sync_id, snapshot_sha256))
        conn.commit()

        return {
            "upserted": len(unique_medicines),
            "in_stock": in_stock_count,
            "out_of_stock": out_of_stock_count,
        }

    except Exception as e:
        conn.rollback()
        logger.error(f"Database error during upsert: {e}")
        raise
    finally:
        cur.close()


def lambda_handler(event, context):
    """
    Main Lambda entry point.
    Triggered by API Gateway POST /api/sync
    """
    logger.info("=== Pharmacy Sync Lambda triggered ===")

    # --- Authentication ---
    # API Gateway handles API Key validation before Lambda is invoked.
    # If we reach here, the request is already authenticated.

    try:
        # --- Decompress & Parse ---
        raw_body = decompress_body(event)
        sync_id, snapshot_sha256, medicines = parse_snapshot(raw_body)
        logger.info("Received sync_id=%s with %s medicine records", sync_id, len(medicines))

        # --- Validate ---
        validate_payload(medicines)

        # --- UPSERT into RDS ---
        conn = get_connection()
        result = upsert_medicines(conn, medicines, sync_id, snapshot_sha256)

        return {
            "statusCode": 200,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(
                {
                    "status": "success",
                    "message": f"Synced {result['upserted']} medicines",
                    "details": result,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
            ),
        }

    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON: {e}")
        return {
            "statusCode": 400,
            "body": json.dumps({"status": "error", "message": f"Invalid JSON: {str(e)}"}),
        }

    except SuspiciousSnapshotError as e:
        logger.error("%s: %s", e.code, e.details)
        return {
            "statusCode": 409,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({
                "status": "error",
                "error": {
                    "code": e.code,
                    "message": str(e),
                    "details": e.details,
                },
            }),
        }

    except ValueError as e:
        logger.error(f"Validation error: {e}")
        return {
            "statusCode": 400,
            "body": json.dumps({"status": "error", "message": str(e)}),
        }

    except psycopg2.OperationalError as e:
        logger.error(f"Database connection error: {e}")
        # Reset connection on failure
        global _connection
        _connection = None
        return {
            "statusCode": 500,
            "body": json.dumps({"status": "error", "message": "Database connection failed"}),
        }

    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({"status": "error", "message": "Internal server error"}),
        }
