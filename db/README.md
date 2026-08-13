# Database artifacts

`current-schema.json` is the metadata-only production schema inventory returned
by Lambda. It contains no table rows, credentials, or executable DDL.

## Migration state

- `migrations/0001_api_v1_foundation.sql` was applied to production on
  2026-08-06.
- `migrations/0002_catalog_sync_v1.sql` was applied to production on
  2026-08-06. Backup schema: `vatan_pre_sync_v1_20260806`.
- `preflight/0002_catalog_sync_v1_preflight.sql` returns one JSON report with
  metadata and counts only. It explicitly starts a read-only transaction.
- `ROLLBACK_0002.md` explains recovery boundaries. There is intentionally no
  one-click destructive rollback script.

Validate a saved preflight JSON response locally with:

```powershell
python scripts/validate_preflight_0002.py path\to\preflight-response.json
```

An RDS snapshot or tested point-in-time restore remains required before
production migration. The same-database backup schema is useful for comparison
but is not a complete disaster-recovery backup.
## Migration 0005: reusable product carousels

`migrations/0005_product_carousels.sql` adds product-level HTTPS image metadata,
reusable ordered carousel sections, and ordered unique products inside each
section. It seeds `items-of-the-day` and `best-sellers`, then copies the existing
`featured_products` configuration into `items-of-the-day`. The legacy table is
kept for rollback compatibility and is not used by the new storefront endpoint.
