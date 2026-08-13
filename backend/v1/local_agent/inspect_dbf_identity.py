"""Read-only DBF identity inspection; prints metadata and counts, never row values."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def _normalized(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().casefold()


def inspect(path: Path, encoding: str) -> dict[str, Any]:
    try:
        from dbfread import DBF
    except ImportError as exc:
        raise SystemExit("dbfread is not installed in this Python environment") from exc

    if not path.is_file():
        raise SystemExit(f"DBF file was not found: {path}")

    table = DBF(
        str(path), encoding=encoding, char_decode_errors="strict", load=False,
    )
    field_names = list(table.field_names)
    counters = {name: Counter() for name in field_names}
    row_count = 0
    for row in table:
        row_count += 1
        for name in field_names:
            counters[name][_normalized(row.get(name))] += 1

    fields = []
    for descriptor in table.fields:
        counts = counters[descriptor.name]
        blank_count = counts.get("", 0)
        nonblank_counts = [count for value, count in counts.items() if value]
        distinct_nonblank = len(nonblank_counts)
        duplicate_rows = sum(count - 1 for count in nonblank_counts if count > 1)
        fields.append({
            "name": descriptor.name,
            "type": descriptor.type,
            "length": descriptor.length,
            "decimal_count": descriptor.decimal_count,
            "blank_count": blank_count,
            "distinct_nonblank": distinct_nonblank,
            "duplicate_nonblank_rows": duplicate_rows,
            "unique_and_complete": row_count > 0 and blank_count == 0 and distinct_nonblank == row_count,
        })

    return {
        "format": "vatan-dbf-identity-inspection/v1",
        "file_name": path.name,
        "row_count": row_count,
        "fields": fields,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inspect DBF columns without printing catalogue row values",
    )
    parser.add_argument("dbf_path", type=Path)
    parser.add_argument("--encoding", default="cp866")
    args = parser.parse_args()
    print(json.dumps(inspect(args.dbf_path, args.encoding), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
