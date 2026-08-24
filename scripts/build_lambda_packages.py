"""Build deterministic, source-only ZIP files for the three API v1 Lambdas."""

from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BUILD_ROOT = (ROOT / "build").resolve()
OUTPUT = (BUILD_ROOT / "lambda-v1").resolve()
PACKAGES = (
    ("public-api-v1", "public_api", "lambda_function.lambda_handler"),
    ("admin-api-v1", "admin_api", "lambda_function.lambda_handler"),
    ("internal-sync-v1", "internal_sync", "lambda_function.lambda_handler"),
)
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)


def _assert_safe_output() -> None:
    if OUTPUT.parent != BUILD_ROOT or ROOT not in OUTPUT.parents:
        raise RuntimeError("Unsafe Lambda package output path")


def _package_entries(module: str) -> list[tuple[str, Path]]:
    handler_source = ROOT / "backend" / "v1" / module / "lambda_function.py"
    files = [ROOT / "backend" / "__init__.py", ROOT / "backend" / "v1" / "__init__.py"]
    files.extend(sorted((ROOT / "backend" / "v1" / "shared").glob("*.py")))
    entries = [("lambda_function.py", handler_source)]
    entries.extend((path.relative_to(ROOT).as_posix(), path) for path in files)
    if any(not path.is_file() for _, path in entries):
        raise RuntimeError(f"Lambda source files are incomplete for {module}")
    return entries


def _write_deterministic_zip(destination: Path, entries: list[tuple[str, Path]]) -> None:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for archive_name, source in sorted(entries):
            info = zipfile.ZipInfo(archive_name, FIXED_ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, source.read_bytes(), compresslevel=9)


def build() -> Path:
    _assert_safe_output()
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)
    manifest_packages = []
    for name, module, handler in PACKAGES:
        destination = OUTPUT / f"{name}.zip"
        _write_deterministic_zip(destination, _package_entries(module))
        payload = destination.read_bytes()
        manifest_packages.append({
            "file": destination.name,
            "handler": handler,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "size_bytes": len(payload),
        })
    legacy_destination = OUTPUT / "legacy-sync-receiver.zip"
    legacy_source = ROOT / "backend" / "lambda-legacy" / "sync-receiver" / "lambda_function.py"
    _write_deterministic_zip(legacy_destination, [("lambda_function.py", legacy_source)])
    legacy_payload = legacy_destination.read_bytes()
    manifest_packages.append({
        "file": legacy_destination.name,
        "handler": "lambda_function.lambda_handler",
        "sha256": hashlib.sha256(legacy_payload).hexdigest(),
        "size_bytes": len(legacy_payload),
    })
    reset_destination = OUTPUT / "catalog-reset-once.zip"
    reset_source = ROOT / "backend" / "operations" / "catalog_reset_once" / "lambda_function.py"
    _write_deterministic_zip(reset_destination, [("lambda_function.py", reset_source)])
    reset_payload = reset_destination.read_bytes()
    manifest_packages.append({
        "file": reset_destination.name,
        "handler": "lambda_function.lambda_handler",
        "sha256": hashlib.sha256(reset_payload).hexdigest(),
        "size_bytes": len(reset_payload),
    })
    migration_destination = OUTPUT / "migration-0006-once.zip"
    migration_source = ROOT / "backend" / "operations" / "admin_safety_migration_once" / "lambda_function.py"
    _write_deterministic_zip(migration_destination, [("lambda_function.py", migration_source)])
    migration_payload = migration_destination.read_bytes()
    manifest_packages.append({
        "file": migration_destination.name,
        "handler": "lambda_function.lambda_handler",
        "sha256": hashlib.sha256(migration_payload).hexdigest(),
        "size_bytes": len(migration_payload),
    })
    pricing_migration_destination = OUTPUT / "migration-0007-pricing-once.zip"
    pricing_migration_source = ROOT / "backend" / "operations" / "pricing_migration_once" / "lambda_function.py"
    _write_deterministic_zip(
        pricing_migration_destination,
        [("lambda_function.py", pricing_migration_source)],
    )
    pricing_migration_payload = pricing_migration_destination.read_bytes()
    manifest_packages.append({
        "file": pricing_migration_destination.name,
        "handler": "lambda_function.lambda_handler",
        "sha256": hashlib.sha256(pricing_migration_payload).hexdigest(),
        "size_bytes": len(pricing_migration_payload),
    })
    identity_migration_destination = OUTPUT / "migration-0008-category-medicine-identity-once.zip"
    identity_migration_source = (
        ROOT / "backend" / "operations" / "category_medicine_identity_migration_once" / "lambda_function.py"
    )
    _write_deterministic_zip(
        identity_migration_destination,
        [("lambda_function.py", identity_migration_source)],
    )
    identity_migration_payload = identity_migration_destination.read_bytes()
    manifest_packages.append({
        "file": identity_migration_destination.name,
        "handler": "lambda_function.lambda_handler",
        "sha256": hashlib.sha256(identity_migration_payload).hexdigest(),
        "size_bytes": len(identity_migration_payload),
    })
    manifest = {
        "format": "vatan-lambda-packages/v1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "packages": manifest_packages,
        "external_runtime_dependencies": [
            "AWS Lambda Python runtime: boto3/botocore",
            "Configured Lambda layer: psycopg2",
        ],
    }
    (OUTPUT / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    return OUTPUT


if __name__ == "__main__":
    print(f"Lambda packages created in {build()}")
