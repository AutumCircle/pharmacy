"""Pharmacy Oracle mirror agent for Windows 7 (Python 3.8).

Reads selected tables of the local «Алгоритм» Oracle XE database with a read-only account and
mirrors them to the internal API:

* every cycle (default 60 s) it reads rows whose CHANGE_ID grew (or, for tables without
  CHANGE_ID, rows with a larger key) and sends only rows whose content really changed;
* on start-up and then periodically it walks the whole table, which also detects deleted rows.

What was successfully sent is remembered in a local SQLite file, so after a network failure
the next cycle simply recomputes and resends the difference. The agent never writes to Oracle.
"""

from __future__ import annotations

import argparse
import datetime as dt
import decimal
import hashlib
import json
import logging
import os
import sqlite3
import sys
import time
import uuid
from dataclasses import dataclass
from logging.handlers import RotatingFileHandler
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple


AGENT_VERSION = "pharmacy-agent/1.0.0"
MAX_BATCH_ROWS = 2000
MAX_BATCH_BYTES = 1_500_000
MAX_DELETE_KEYS = 10_000
MAX_TEXT_LENGTH = 4000
PAGE_SIZE = 5000
MAX_DELTA_ROWS = 20_000
# A full scan that suddenly sees far fewer rows than were mirrored (database being restored,
# missing grant) must not wipe the server copy.
MIN_SAFE_SCAN_RATIO = 0.5
MIN_GUARDED_ROWS = 1000
HTTP_ATTEMPTS = 3

log = logging.getLogger("pharmacy_agent")


@dataclass(frozen=True)
class TableSpec:
    name: str
    key_column: str
    # Tables with CHANGE_ID get minute-level deltas by it; tables without it are read
    # incrementally by a growing numeric key and fully re-checked on schedule.
    change_column: Optional[str]
    delta_seconds: int
    full_scan_seconds: int


# Product, stock, batch and dictionary tables. Sales, receipts, discount cards and employees
# are intentionally not read. Keep in sync with DEFAULT_MIRROR_TABLES on the server.
DEFAULT_TABLES: Tuple[TableSpec, ...] = (
    TableSpec("T_SKLAD_STATE", "SKLAD_STATE_ID", "CHANGE_ID", 60, 15 * 60),
    TableSpec("T_PRODUCT", "PRODUCT_ID", "CHANGE_ID", 60, 6 * 3600),
    TableSpec("T_INCOME", "INCOME_ID", None, 60, 2 * 3600),
    TableSpec("T_INCOME_HEAD", "INCOME_HEAD_ID", "CHANGE_ID", 300, 6 * 3600),
    TableSpec("T_VENDOR", "VENDOR_ID", "CHANGE_ID", 600, 6 * 3600),
    TableSpec("T_COUNTRY", "COUNTRY_ID", "CHANGE_ID", 600, 6 * 3600),
    TableSpec("T_PRODUCT_MNN", "PRODUCT_MNN_ID", "CHANGE_ID", 600, 6 * 3600),
    TableSpec("T_PRODUCT_GROUP", "PRODUCT_GROUP_ID", "CHANGE_ID", 600, 6 * 3600),
    TableSpec("T_PRODUCT_SOSTAV", "PRODUCT_SOSTAV_ID", "CHANGE_ID", 600, 6 * 3600),
    TableSpec("T_SKLAD", "SKLAD_ID", "CHANGE_ID", 600, 6 * 3600),
    TableSpec("T_MEASURE", "MEASURE_ID", "CHANGE_ID", 600, 6 * 3600),
    TableSpec("T_PRODUCT_TYPE", "PRODUCT_TYPE_ID", "CHANGE_ID", 600, 6 * 3600),
)


# --------------------------------------------------------------------------- row encoding

def encode_value(value: Any) -> Any:
    """Convert one Oracle value to a JSON scalar; None means "omit this column"."""

    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, decimal.Decimal):
        if value == value.to_integral_value():
            return int(value)
        return format(value.normalize(), "f")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    if isinstance(value, dt.datetime):
        return value.replace(microsecond=0).isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        text = bytes(value).hex()
        return text if len(text) <= MAX_TEXT_LENGTH else None
    if isinstance(value, str):
        text = value.replace("\x00", "")
        return text if len(text) <= MAX_TEXT_LENGTH else text[:MAX_TEXT_LENGTH]
    # LOBs and other exotic types are skipped rather than blocking the whole row.
    return None


@dataclass(frozen=True)
class Record:
    key: str
    change_id: Optional[int]
    data: Dict[str, Any]
    row_hash: str
    size: int


def build_record(columns: Sequence[str], values: Sequence[Any], spec: TableSpec) -> Optional[Record]:
    data: Dict[str, Any] = {}
    for column, value in zip(columns, values):
        encoded = encode_value(value)
        if encoded is not None:
            data[column] = encoded
    key_value = data.get(spec.key_column)
    if key_value is None:
        return None
    change_id = data.get(spec.change_column) if spec.change_column else None
    canonical = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return Record(
        key=str(key_value),
        change_id=change_id if isinstance(change_id, int) else None,
        data=data,
        row_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        size=len(canonical.encode("utf-8")) + 64,
    )


# --------------------------------------------------------------------------- local state

class StateStore:
    """What the server already holds, as (table, key) -> content hash, plus cursors."""

    def __init__(self, path: str) -> None:
        self.connection = sqlite3.connect(path)
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS sent_rows (table_name TEXT NOT NULL, row_key TEXT NOT NULL, "
            "row_hash TEXT NOT NULL, PRIMARY KEY (table_name, row_key))"
        )
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS table_state (table_name TEXT PRIMARY KEY, "
            "last_change_id INTEGER, max_key INTEGER, last_full_scan REAL, last_delta REAL)"
        )
        self.connection.commit()

    def hashes(self, table: str) -> Dict[str, str]:
        rows = self.connection.execute(
            "SELECT row_key, row_hash FROM sent_rows WHERE table_name = ?", (table,)
        )
        return {key: row_hash for key, row_hash in rows}

    def hashes_for(self, table: str, keys: Sequence[str]) -> Dict[str, str]:
        result: Dict[str, str] = {}
        for start in range(0, len(keys), 500):
            chunk = list(keys[start:start + 500])
            placeholders = ",".join("?" for _ in chunk)
            rows = self.connection.execute(
                "SELECT row_key, row_hash FROM sent_rows WHERE table_name = ? AND row_key IN (%s)" % placeholders,
                [table] + chunk,
            )
            result.update({key: row_hash for key, row_hash in rows})
        return result

    def count(self, table: str) -> int:
        return int(self.connection.execute(
            "SELECT COUNT(*) FROM sent_rows WHERE table_name = ?", (table,)
        ).fetchone()[0])

    def mark_sent(self, table: str, upserts: Sequence[Record], deletes: Sequence[str]) -> None:
        with self.connection:
            self.connection.executemany(
                "INSERT OR REPLACE INTO sent_rows (table_name, row_key, row_hash) VALUES (?, ?, ?)",
                [(table, record.key, record.row_hash) for record in upserts],
            )
            self.connection.executemany(
                "DELETE FROM sent_rows WHERE table_name = ? AND row_key = ?",
                [(table, key) for key in deletes],
            )

    def get(self, table: str) -> Dict[str, Optional[float]]:
        row = self.connection.execute(
            "SELECT last_change_id, max_key, last_full_scan, last_delta FROM table_state WHERE table_name = ?",
            (table,),
        ).fetchone()
        names = ("last_change_id", "max_key", "last_full_scan", "last_delta")
        return dict(zip(names, row)) if row else dict.fromkeys(names)

    def update(self, table: str, **values: Any) -> None:
        current = self.get(table)
        current.update(values)
        with self.connection:
            self.connection.execute(
                "INSERT OR REPLACE INTO table_state (table_name, last_change_id, max_key, last_full_scan, last_delta) "
                "VALUES (?, ?, ?, ?, ?)",
                (table, current["last_change_id"], current["max_key"], current["last_full_scan"], current["last_delta"]),
            )

    def reset(self, table: str) -> None:
        with self.connection:
            self.connection.execute("DELETE FROM sent_rows WHERE table_name = ?", (table,))
            self.connection.execute("DELETE FROM table_state WHERE table_name = ?", (table,))


# --------------------------------------------------------------------------- batching

def chunk_records(records: Sequence[Record]) -> Iterator[List[Record]]:
    chunk: List[Record] = []
    size = 0
    for record in records:
        if chunk and (len(chunk) >= MAX_BATCH_ROWS or size + record.size > MAX_BATCH_BYTES):
            yield chunk
            chunk, size = [], 0
        chunk.append(record)
        size += record.size
    if chunk:
        yield chunk


def build_payload(pharmacy_id: int, table: str, upserts: Sequence[Record], deletes: Sequence[str]) -> Dict[str, Any]:
    return {
        "batch_id": str(uuid.uuid4()),
        "pharmacy_id": pharmacy_id,
        "table": table,
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "upserts": [{"key": r.key, "change_id": r.change_id, "data": r.data} for r in upserts],
        "deletes": list(deletes),
    }


class Sender:
    """Sends changes for one table and records them as sent only after the server accepted them."""

    def __init__(self, pharmacy_id: int, state: StateStore, post: Callable[[str, Dict[str, Any]], Any]) -> None:
        self.pharmacy_id = pharmacy_id
        self.state = state
        self.post = post

    def send(self, table: str, upserts: Sequence[Record], deletes: Sequence[str] = ()) -> Tuple[int, int]:
        for chunk in chunk_records(upserts):
            self.post("batches", build_payload(self.pharmacy_id, table, chunk, ()))
            self.state.mark_sent(table, chunk, ())
        delete_list = list(deletes)
        for start in range(0, len(delete_list), MAX_DELETE_KEYS):
            chunk_keys = delete_list[start:start + MAX_DELETE_KEYS]
            self.post("batches", build_payload(self.pharmacy_id, table, (), chunk_keys))
            self.state.mark_sent(table, (), chunk_keys)
        return len(upserts), len(delete_list)


def changed_records(records: Iterable[Record], known_hashes: Dict[str, str]) -> List[Record]:
    return [record for record in records if known_hashes.get(record.key) != record.row_hash]


# --------------------------------------------------------------------------- Oracle access

class OracleSource:
    """Read-only access to the pharmacy tables."""

    def __init__(self, config: Dict[str, Any]) -> None:
        import cx_Oracle  # imported lazily so the pure logic is testable without Oracle

        oracle = config["oracle"]
        client_dir = oracle.get("client_lib_dir")
        if client_dir:
            try:
                cx_Oracle.init_oracle_client(lib_dir=client_dir)
            except cx_Oracle.ProgrammingError:
                pass  # already initialised in this process
        self.cx_Oracle = cx_Oracle
        self.schema = str(config.get("schema", "ORGANIZ")).upper()
        self.connection = cx_Oracle.connect(
            user=oracle["user"], password=oracle["password"], dsn=oracle["dsn"], encoding="UTF-8",
        )
        self.connection.outputtypehandler = self._output_type_handler

    def _output_type_handler(self, cursor: Any, name: str, default_type: Any, size: int, precision: int, scale: int) -> Any:
        # Oracle NUMBER must arrive as Decimal, not float, to keep exact prices and quantities.
        if default_type == self.cx_Oracle.DB_TYPE_NUMBER:
            return cursor.var(decimal.Decimal, arraysize=cursor.arraysize)
        return None

    def close(self) -> None:
        try:
            self.connection.close()
        except Exception:
            pass

    def _query(self, sql: str, params: Dict[str, Any]) -> Tuple[List[str], List[Tuple[Any, ...]]]:
        cursor = self.connection.cursor()
        try:
            cursor.arraysize = 1000
            cursor.execute(sql, params)
            columns = [str(description[0]).upper() for description in cursor.description]
            return columns, cursor.fetchall()
        finally:
            cursor.close()

    def page_by_key(self, spec: TableSpec, after_key: Optional[int], limit: int) -> Tuple[List[str], List[Tuple[Any, ...]]]:
        where = "WHERE t.%s > :after_key" % spec.key_column if after_key is not None else ""
        sql = (
            "SELECT * FROM (SELECT t.* FROM %s.%s t %s ORDER BY t.%s) WHERE ROWNUM <= :row_limit"
            % (self.schema, spec.name, where, spec.key_column)
        )
        params: Dict[str, Any] = {"row_limit": limit}
        if after_key is not None:
            params["after_key"] = after_key
        return self._query(sql, params)

    def changed_since(self, spec: TableSpec, change_id: int, limit: int) -> Tuple[List[str], List[Tuple[Any, ...]]]:
        sql = (
            "SELECT * FROM (SELECT t.* FROM %s.%s t WHERE t.%s > :change_id ORDER BY t.%s) WHERE ROWNUM <= :row_limit"
            % (self.schema, spec.name, spec.change_column, spec.change_column)
        )
        return self._query(sql, {"change_id": change_id, "row_limit": limit})


# --------------------------------------------------------------------------- synchronisation

class Synchronizer:
    def __init__(self, source: Any, state: StateStore, sender: Sender, tables: Sequence[TableSpec],
                 change_overlap: int = 2000, clock: Callable[[], float] = time.time) -> None:
        self.source = source
        self.state = state
        self.sender = sender
        self.tables = list(tables)
        self.change_overlap = change_overlap
        self.clock = clock

    def full_scan(self, spec: TableSpec) -> Tuple[int, int]:
        """Walk the whole table by key, send changed rows, then send deletions."""

        known = self.state.hashes(spec.name)
        seen = set()
        sent = 0
        after_key: Optional[int] = None
        max_change: Optional[int] = None
        max_key: Optional[int] = None
        while True:
            columns, rows = self.source.page_by_key(spec, after_key, PAGE_SIZE)
            records = [r for r in (build_record(columns, row, spec) for row in rows) if r is not None]
            for record in records:
                seen.add(record.key)
                if record.change_id is not None:
                    max_change = record.change_id if max_change is None else max(max_change, record.change_id)
            changed = changed_records(records, known)
            if changed:
                self.sender.send(spec.name, changed)
                sent += len(changed)
            if len(rows) < PAGE_SIZE or not records:
                break
            after_key = int(records[-1].key)
            max_key = after_key
        if records:
            max_key = max(int(records[-1].key), max_key or 0)
        deleted = [key for key in known if key not in seen]
        if len(known) >= MIN_GUARDED_ROWS and len(seen) < len(known) * MIN_SAFE_SCAN_RATIO:
            raise RuntimeError(
                "%s: full scan saw %d rows but %d are mirrored; deletions withheld"
                % (spec.name, len(seen), len(known))
            )
        if deleted:
            self.sender.send(spec.name, (), deleted)
        now = self.clock()
        self.state.update(
            spec.name, last_full_scan=now, last_delta=now,
            last_change_id=max_change if spec.change_column else None,
            max_key=max_key,
        )
        return sent, len(deleted)

    def delta(self, spec: TableSpec) -> Optional[int]:
        """Send rows changed since the last cycle. Returns None when a full scan is needed."""

        table_state = self.state.get(spec.name)
        if spec.change_column:
            last_change = table_state["last_change_id"]
            if last_change is None:
                return None
            columns, rows = self.source.changed_since(
                spec, max(0, int(last_change) - self.change_overlap), MAX_DELTA_ROWS + 1,
            )
        else:
            max_key = table_state["max_key"]
            if max_key is None:
                return None
            columns, rows = self.source.page_by_key(spec, int(max_key), MAX_DELTA_ROWS + 1)
        if len(rows) > MAX_DELTA_ROWS:
            return None  # mass change: a full scan is cheaper and safer
        records = [r for r in (build_record(columns, row, spec) for row in rows) if r is not None]
        changed = changed_records(records, self.state.hashes_for(spec.name, [r.key for r in records]))
        if changed:
            self.sender.send(spec.name, changed)
        updates: Dict[str, Any] = {"last_delta": self.clock()}
        if spec.change_column:
            changes = [r.change_id for r in records if r.change_id is not None]
            if changes:
                updates["last_change_id"] = max(int(table_state["last_change_id"]), max(changes))
        elif records:
            updates["max_key"] = max(int(table_state["max_key"]), max(int(r.key) for r in records))
        self.state.update(spec.name, **updates)
        return len(changed)

    def run_cycle(self, force_full: bool = False) -> Dict[str, Any]:
        summary: Dict[str, Any] = {}
        for spec in self.tables:
            try:
                result = self._sync_table(spec, force_full)
            except Exception as exc:
                # One failing table must not stop the others; database connection errors
                # are re-raised so the caller reconnects.
                if "ORA-" in str(exc) and "ORA-00942" not in str(exc):
                    raise
                log.exception("Table %s failed", spec.name)
                result = {"mode": "error", "error": str(exc)[:200]}
            if result:
                summary[spec.name] = result
        return summary

    def _sync_table(self, spec: TableSpec, force_full: bool) -> Optional[Dict[str, Any]]:
        table_state = self.state.get(spec.name)
        now = self.clock()
        last_full = table_state["last_full_scan"]
        last_delta = table_state["last_delta"] or 0
        if not (force_full or last_full is None or now - last_full >= spec.full_scan_seconds):
            if now - last_delta < spec.delta_seconds:
                return None
            result = self.delta(spec)
            if result is not None:
                return {"mode": "delta", "sent": result} if result else None
        sent, deleted = self.full_scan(spec)
        return {"mode": "full", "sent": sent, "deleted": deleted}

    def reconcile_with_server(self, server_status: Dict[str, Any]) -> List[str]:
        """Forget local state for tables the server no longer holds (e.g. a restored database)."""

        server_counts = {item["table_name"]: int(item["row_count"]) for item in server_status.get("tables", [])}
        reset = []
        for spec in self.tables:
            if server_counts.get(spec.name, 0) == 0 and self.state.count(spec.name) > 0:
                self.state.reset(spec.name)
                reset.append(spec.name)
        return reset


# --------------------------------------------------------------------------- HTTP

class ApiClient:
    def __init__(self, config: Dict[str, Any]) -> None:
        import requests  # lazy for tests

        self.requests = requests
        self.base_url = str(config["api_base_url"]).rstrip("/") + "/v1/internal/pharmacy-mirror/"
        self.headers = {
            "Authorization": "Bearer " + str(config["api_token"]),
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": AGENT_VERSION,
        }
        if config.get("api_gateway_key"):
            self.headers["x-api-key"] = str(config["api_gateway_key"])
        self.timeout = int(config.get("http_timeout_seconds", 60))

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Any:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
        last_error: Optional[Exception] = None
        for attempt in range(HTTP_ATTEMPTS):
            try:
                response = self.requests.request(
                    method, self.base_url + path, data=body, headers=self.headers, timeout=self.timeout, verify=True,
                )
                if response.status_code < 300:
                    return response.json().get("data")
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    raise RuntimeError("Server rejected %s %s: %s %s" % (
                        method, path, response.status_code, response.text[:500]))
                last_error = RuntimeError("HTTP %s" % response.status_code)
            except self.requests.RequestException as exc:
                last_error = exc
            time.sleep(2 ** attempt * 2)
        raise RuntimeError("Request %s %s failed: %s" % (method, path, last_error))

    def post(self, path: str, payload: Dict[str, Any]) -> Any:
        return self._request("POST", path, payload)

    def get(self, path: str) -> Any:
        return self._request("GET", path)


# --------------------------------------------------------------------------- process

def application_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


def load_config(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        config = json.load(handle)
    for name in ("pharmacy_id", "api_base_url", "api_token", "oracle"):
        if name not in config:
            raise ValueError("config.json is missing %s" % name)
    for name in ("dsn", "user", "password"):
        if name not in config["oracle"]:
            raise ValueError("config.json oracle section is missing %s" % name)
    if not str(config["api_base_url"]).startswith("https://"):
        raise ValueError("api_base_url must use HTTPS")
    return config


def acquire_single_instance_lock(path: str) -> Any:
    handle = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle


def setup_logging(directory: str) -> None:
    handler = RotatingFileHandler(
        os.path.join(directory, "pharmacy_agent.log"), maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8",
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    if sys.stdout is not None:
        root.addHandler(logging.StreamHandler(sys.stdout))


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Pharmacy Oracle mirror agent")
    parser.add_argument("--config", default=os.path.join(application_dir(), "config.json"))
    parser.add_argument("--once", action="store_true", help="run one full cycle and exit (installation test)")
    args = parser.parse_args(argv)

    directory = os.path.dirname(os.path.abspath(args.config))
    setup_logging(directory)
    lock = acquire_single_instance_lock(os.path.join(directory, "pharmacy_agent.lock"))
    if lock is None:
        log.info("Another agent instance is already running; exiting")
        return 0
    config = load_config(args.config)
    pharmacy_id = int(config["pharmacy_id"])
    interval = max(30, int(config.get("cycle_seconds", 60)))
    api = ApiClient(config)
    state = StateStore(os.path.join(directory, "pharmacy_agent_state.sqlite3"))
    sender = Sender(pharmacy_id, state, api.post)
    log.info("%s started for pharmacy %s", AGENT_VERSION, pharmacy_id)

    source = None
    first_cycle = True
    while True:
        started = time.time()
        status: Dict[str, Any] = {"ok": False}
        try:
            if source is None:
                source = OracleSource(config)
            synchronizer = Synchronizer(source, state, sender, DEFAULT_TABLES,
                                        change_overlap=int(config.get("change_overlap", 2000)))
            if first_cycle:
                reset = synchronizer.reconcile_with_server(api.get("status") or {})
                if reset:
                    log.warning("Server holds no rows for %s; resending these tables", ", ".join(reset))
            summary = synchronizer.run_cycle(force_full=first_cycle)
            first_cycle = False
            status = {"ok": True, "cycle_seconds": round(time.time() - started, 1), "tables": summary}
            if summary:
                log.info("Cycle done: %s", json.dumps(summary, ensure_ascii=False))
        except Exception as exc:  # keep running; the next cycle resends whatever was not accepted
            log.exception("Cycle failed")
            status = {"ok": False, "error": str(exc)[:500]}
            if source is not None and "ORA-" in str(exc):
                source.close()
                source = None
        try:
            api.post("heartbeat", {"pharmacy_id": pharmacy_id, "agent_version": AGENT_VERSION, "status": status})
        except Exception:
            log.warning("Heartbeat failed", exc_info=True)
        if args.once:
            return 0 if status.get("ok") else 1
        time.sleep(max(5.0, interval - (time.time() - started)))


if __name__ == "__main__":
    sys.exit(main())
