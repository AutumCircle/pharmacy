# Backend API v1

This is the replacement backend, developed alongside `lambda-legacy`. It is
not connected to the live API Gateway yet.

## What it already enforces

- the browser sends only medicine IDs and quantities when creating an order;
- Lambda locks the medicine rows, checks stock, recalculates the 5% markup and
  rounding, and stores price snapshots in one database transaction;
- a UUID `Idempotency-Key` prevents an accidental double order;
- public tracking returns only orders for the exact normalised phone number and
  does not return the delivery address or phone number;
- public catalogue queries are limited and use SQL pagination.

## Before deployment

1. Apply `db/migrations/0001_api_v1_foundation.sql` to a disposable/staging
   PostgreSQL database made from the same schema. Do not run it through the
   legacy `action` router.
2. Package the repository's `backend` directory so Lambda can import
   `backend.v1.public_api.lambda_function`.
3. Attach the existing `psycopg2` Lambda layer, set the existing `DB_*`
   environment variables, and set `DB_SSLMODE=require` unless the RDS setup
   explicitly requires a different verified TLS mode.
4. Create API Gateway routes below `/v1/public/*` and use handler
   `backend.v1.public_api.lambda_function.lambda_handler`.
5. Smoke-test a staging route before switching any Next.js call. No browser
   code receives the Gateway API key.

## Additional handlers now implemented locally

- `backend.v1.admin_api.lambda_function.lambda_handler` serves admin-only
  order, category, and synchronization-history routes.
- `backend.v1.internal_sync.lambda_function.lambda_handler` serves the
  machine-only S3 snapshot flow after migration `0002_catalog_sync_v1.sql`.

They require separate authorizer identities (`admin` and `agent_sync`). The
internal handler also requires `SYNC_BUCKET`, `SYNC_SOURCE_ID`, and S3 IAM
permissions. These handlers are not connected to live API Gateway yet.
