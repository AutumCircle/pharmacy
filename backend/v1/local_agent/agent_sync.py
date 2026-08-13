"""Pharmacy Windows agent for the API v1 full-catalogue sync flow."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import uuid4

import requests


FORMAT = "vatan-catalog-snapshot/v1"
DEFAULT_TIMEOUT = (5, 30)


class AgentError(RuntimeError):
    pass


def load_config(path: Path) -> dict[str, Any]:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AgentError(f"Cannot read configuration: {path}") from exc
    required = ("dbf_path", "api_base_url", "source_id", "authorization_token", "fields")
    if not isinstance(config, dict) or any(not config.get(key) for key in required):
        raise AgentError("Configuration is incomplete")
    return config


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (datetime,)):
        return value.isoformat()
    return value


def _clean_catalog_attribute(value: Any) -> str:
    return "" if value is None else str(value)


def read_dbf(config: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        from dbfread import DBF
    except ImportError as exc:
        raise AgentError("The dbfread package is not installed") from exc

    path = Path(config["dbf_path"])
    if not path.is_file():
        raise AgentError(f"DBF file was not found: {path}")
    fields = config["fields"]
    if not isinstance(fields, dict) or not fields.get("name") or not fields.get("price"):
        raise AgentError("fields.name and fields.price are required")
    table = DBF(
        str(path), encoding=config.get("dbf_encoding", "cp866"),
        char_decode_errors="strict", load=False,
    )
    available = set(table.field_names)
    configured = {value for value in fields.values() if value}
    missing = sorted(configured - available)
    if missing:
        raise AgentError(f"Configured DBF columns were not found: {', '.join(missing)}")

    records: list[dict[str, Any]] = []
    for row in table:
        item = {
            "name": _json_value(row.get(fields["name"])),
            "price": _json_value(row.get(fields["price"])),
            "country": _clean_catalog_attribute(row.get(fields.get("country"))) if fields.get("country") else "",
            "vendor": _clean_catalog_attribute(row.get(fields.get("vendor"))) if fields.get("vendor") else "",
        }
        if fields.get("source_sku"):
            sku = row.get(fields["source_sku"])
            item["source_sku"] = "" if sku is None else str(sku).strip()
        records.append(item)
    minimum = int(config.get("min_expected_rows", 5000))
    if len(records) < minimum:
        raise AgentError(f"Safety check stopped sync: only {len(records)} rows, minimum is {minimum}")
    return records


def build_snapshot(config: dict[str, Any], records: list[dict[str, Any]]) -> tuple[bytes, str, str]:
    dbf_path = Path(config["dbf_path"])
    source_updated_at = datetime.fromtimestamp(dbf_path.stat().st_mtime, timezone.utc).isoformat()
    document = {
        "format": FORMAT,
        "source_id": config["source_id"],
        "generated_at": source_updated_at,
        "records": records,
    }
    raw = json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    compressed = gzip.compress(raw, compresslevel=6, mtime=0)
    return compressed, hashlib.sha256(compressed).hexdigest(), source_updated_at


def _state_path(config_path: Path) -> Path:
    return config_path.with_name("agent_sync_state.json")


def _read_state(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_state(path: Path, state: dict[str, Any]) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, indent=2), encoding="utf-8")
    temporary.replace(path)


class SyncClient:
    def __init__(self, config: dict[str, Any]) -> None:
        self.base_url = str(config["api_base_url"]).rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {config['authorization_token']}",
            "Content-Type": "application/json",
        })
        if config.get("api_key"):
            self.session.headers["x-api-key"] = str(config["api_key"])

    @staticmethod
    def _data(response: requests.Response) -> dict[str, Any]:
        try:
            body = response.json()
        except ValueError as exc:
            raise AgentError(f"Server returned non-JSON response ({response.status_code})") from exc
        if not response.ok:
            error = body.get("error", {}) if isinstance(body, dict) else {}
            raise AgentError(f"Server error {response.status_code}: {error.get('code', 'UNKNOWN')}")
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            raise AgentError("Server response has an invalid shape")
        return data

    def initiate(self, metadata: dict[str, Any], idempotency_key: str) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}/v1/internal/catalog-syncs", json=metadata,
            headers={"Idempotency-Key": idempotency_key}, timeout=DEFAULT_TIMEOUT,
        )
        return self._data(response)

    def upload(self, target: dict[str, Any], compressed: bytes) -> None:
        response = requests.put(
            target["url"], data=compressed, headers=target["headers"],
            timeout=(5, 120),
        )
        if not response.ok:
            raise AgentError(f"Snapshot upload failed ({response.status_code})")

    def commit(self, sync_id: str) -> dict[str, Any]:
        response = self.session.post(
            f"{self.base_url}/v1/internal/catalog-syncs/{sync_id}/commit",
            json={}, timeout=(5, 120),
        )
        return self._data(response)


def run(config_path: Path) -> dict[str, Any]:
    config = load_config(config_path)
    records = read_dbf(config)
    compressed, checksum, source_updated_at = build_snapshot(config, records)
    state_path = _state_path(config_path)
    state = _read_state(state_path)
    if state.get("checksum") == checksum and state.get("status") == "succeeded":
        return {"status": "unchanged", "row_count": len(records), "sync_id": state.get("sync_id")}
    if state.get("checksum") != checksum:
        state = {"checksum": checksum, "idempotency_key": str(uuid4()), "status": "prepared"}
        _write_state(state_path, state)
    if state.get("status") == "failed":
        raise AgentError("This snapshot previously failed validation; correct the source data before retrying")

    client = SyncClient(config)
    metadata = {
        "source_id": config["source_id"], "source_updated_at": source_updated_at,
        "file_name": Path(config["dbf_path"]).name,
        "compressed_size_bytes": len(compressed), "expected_row_count": len(records),
        "snapshot_sha256": checksum,
    }
    initiated = client.initiate(metadata, state["idempotency_key"])
    state.update({"sync_id": initiated["sync_id"], "status": initiated["status"]})
    _write_state(state_path, state)
    if initiated["status"] == "succeeded":
        return initiated
    upload = initiated.get("upload")
    if not isinstance(upload, dict):
        raise AgentError(f"Sync cannot be resumed from status: {initiated['status']}")
    client.upload(upload, compressed)
    result = client.commit(initiated["sync_id"])
    state["status"] = result["status"]
    _write_state(state_path, state)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Synchronize OSTATKI.DBF with Pharmacy Vatan API v1")
    parser.add_argument("--config", type=Path, default=Path(__file__).with_name("config.json"))
    args = parser.parse_args()
    try:
        result = run(args.config.resolve())
    except (AgentError, requests.RequestException, OSError, ValueError) as exc:
        print(f"SYNC FAILED: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
