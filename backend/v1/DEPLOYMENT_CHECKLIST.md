# API v1 deployment checklist

Nothing in this document has been applied to AWS automatically.

## Before deployment

1. Create an RDS snapshot in AWS. The existing same-database backup schema is
   useful for data recovery, but it is not a replacement for an RDS snapshot.
2. Test `db/migrations/0002_catalog_sync_v1.sql` against a disposable copy of
   the current schema, then apply it once during a maintenance window.
3. Keep the legacy sync receiver disabled while the v1 sync importer runs. Two
   catalogue writers must not operate at the same time.
4. Build reviewed ZIP artifacts with
   `python scripts/build_lambda_packages.py`. Verify the SHA-256
   values in `build/lambda-v1/manifest.json` before uploading.

## Required AWS resources

- one private S3 bucket in `eu-central-1` for temporary gzip snapshots;
- S3 lifecycle deletion for uploaded snapshots (recommended: 7 days);
- API Gateway routes from `API_CONTRACT.md`;
- three Lambda handlers: public, admin, and internal sync;
- separate authorizer roles: `admin` and `agent_sync`;
- CloudWatch access logs with authorization headers and pre-signed URLs redacted.

## Internal sync Lambda configuration

- handler: `backend.v1.internal_sync.lambda_function.lambda_handler`;
- existing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`;
- `DB_SSLMODE=require`;
- `SYNC_BUCKET=<private bucket name>`;
- `SYNC_SOURCE_ID=vatan-main-pharmacy`;
- `SYNC_MIN_EXPECTED_ROWS=5000`;
- `SYNC_IMPORT_TIMEOUT_MS=25000`;
- permission to `s3:GetObject`, `s3:PutObject` only under
  `catalog-syncs/vatan-main-pharmacy/*`.

Start with 512 MB Lambda memory and a 30-second timeout, then confirm the real
10,000-row duration in CloudWatch. API Gateway integration timeout must remain
longer than the observed commit duration. If it cannot, move commit execution
to an asynchronous worker before production traffic.

## Next.js/Vercel configuration

- `API_V1_BASE_URL` — server-only API Gateway v1 base URL;
- `API_KEY` — server-only usage-plan key, if the Gateway still requires it;
- `ADMIN_USERNAME` — non-default administrator login, no fallback value;
- `ADMIN_PASSWORD` — strong unique password, no fallback value;
- `ADMIN_SESSION_SECRET` — random value of at least 32 characters;
- `ADMIN_API_BEARER_TOKEN` — server-only credential accepted by the chosen
  API Gateway admin authorizer (replace it with short-lived identity when the
  final authorizer is selected);
- never expose these as `NEXT_PUBLIC_*`.

## Information still needed from the owner/AWS

- API Gateway API ID, stage name, and the exact routes/integrations;
- chosen admin and machine-authorizer mechanism;
- S3 bucket name and Lambda IAM role names;
- DBF encoding still needs a real-file check; columns are confirmed as `NAME`,
  `PRICE`, `COUNTRY`, and `PROIZVOD`, with no stable SKU column;
- staging CloudWatch timings for one 10,000-row sync;
- RDS PostgreSQL version, `max_connections`, current connection count, SSL
  policy, storage/IOPS, and a tested rollback result.
