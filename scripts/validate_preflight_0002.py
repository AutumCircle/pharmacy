"""Validate the metadata-only JSON report produced by the 0002 SQL preflight."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


class PreflightReportError(ValueError):
    pass


REQUIRED_CHECKS = {
    "postgres_version", "required_base_tables", "new_sync_tables_absent",
    "new_medicine_columns_absent", "pg_trgm_installed", "medicine_names_valid",
    "medicine_prices_valid", "normalized_identity_unique", "nullable_catalog_attributes",
    "category_links_without_medicine_id", "rds_backup_schema_present", "medicine_row_count",
    "active_database_connections", "max_connections",
}


def _decode(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def unwrap_report(value: Any) -> dict[str, Any]:
    current = _decode(value)
    for _ in range(5):
        if isinstance(current, dict) and current.get("format") == "vatan-0002-preflight/v1":
            return current
        if not isinstance(current, dict):
            break
        for key in ("preflight_report", "report", "data", "body"):
            if key in current:
                current = _decode(current[key])
                break
        else:
            break
    raise PreflightReportError("0002 preflight report was not found")


def validate_report(value: Any) -> dict[str, Any]:
    report = unwrap_report(value)
    checks = report.get("checks")
    if not isinstance(checks, list) or not checks:
        raise PreflightReportError("checks must be a non-empty array")
    names: set[str] = set()
    counts = {status: 0 for status in ("pass", "warn", "fail", "info")}
    for check in checks:
        if not isinstance(check, dict):
            raise PreflightReportError("every check must be an object")
        name = check.get("name")
        status = check.get("status")
        if not isinstance(name, str) or not name or name in names:
            raise PreflightReportError("check names must be non-empty and unique")
        if status not in {"pass", "warn", "fail", "info"}:
            raise PreflightReportError(f"invalid status for {name}")
        names.add(name)
        counts[status] += 1
    missing = sorted(REQUIRED_CHECKS - names)
    if missing:
        raise PreflightReportError(f"required checks are missing: {', '.join(missing)}")
    summary = report.get("summary")
    if not isinstance(summary, dict) or any(summary.get(status) != count for status, count in counts.items()):
        raise PreflightReportError("summary does not match check statuses")
    ready = report.get("ready")
    if not isinstance(ready, bool) or ready != (counts["fail"] == 0):
        raise PreflightReportError("ready flag does not match failed checks")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Pharmacy Vatan migration 0002 preflight JSON")
    parser.add_argument("report", type=Path)
    args = parser.parse_args()
    try:
        report = validate_report(json.loads(args.report.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError, PreflightReportError) as exc:
        print(f"INVALID PREFLIGHT REPORT: {exc}")
        return 2
    for check in report["checks"]:
        print(f"{check['status'].upper():4} {check['name']}: {check.get('observed')}")
    return 0 if report["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
