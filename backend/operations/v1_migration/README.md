# Temporary API v1 migration Lambda

This function creates a same-database rollback copy and then applies migration
`0001_api_v1_foundation.sql`. It must be deployed separately from the public
legacy API and deleted after verification.

The rollback copy protects against a bad SQL migration. It is not an RDS
snapshot and does not protect against failure or deletion of the RDS instance.

## Package and Lambda settings

Build the deployment ZIP from the repository root so both `backend/` and
`db/migrations/0001_api_v1_foundation.sql` are present in the ZIP.

- Handler: `backend.operations.v1_migration.lambda_function.lambda_handler`
- Runtime: the same Python runtime and `psycopg2` layer as the existing Lambda
- Network: the same VPC/subnets/database security-group access as the existing Lambda
- Timeout: 180 seconds for this temporary function
- Memory: 256 MB is sufficient for SQL-side copies

Environment variables:

- existing `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`;
- `DB_SSLMODE=require`;
- `MIGRATION_ENABLED=true`;
- `MIGRATION_ADMIN_TOKEN=<a new random value of at least 32 characters>`;
- optional `MIGRATION_BACKUP_SCHEMA=vatan_pre_v1_20260806`.

Do not reuse the public API key as `MIGRATION_ADMIN_TOKEN`, do not commit this
token, and do not put it in a browser or `NEXT_PUBLIC_*` variable.

## Calls, in required order

Every call is `POST`, includes header `x-migration-token`, and sends JSON.

1. Check the connection:

```json
{"action":"status"}
```

The response includes `estimated_copy_bytes`. Before continuing, RDS
`FreeStorageSpace` must be comfortably larger than this estimate; use at least
twice the estimate as a minimum safety margin. PostgreSQL cannot see the RDS
volume's exact free-space CloudWatch metric itself.

2. Create the rollback copy:

```json
{
  "action":"create_rollback_copy",
  "confirmation":"CREATE_PRE_V1_ROLLBACK_COPY"
}
```

The response must list all eight tables and their copied row counts. Re-run
`status` and save that non-secret response locally.

3. Apply migration 0001:

```json
{
  "action":"apply_v1_migration",
  "confirmation":"APPLY_VATAN_V1_MIGRATION"
}
```

4. Run `status` again. It must show migration
`0001_api_v1_foundation.sql` with its SHA-256 value and application time.

If any call returns an error, stop. The handler rolls back the active database
transaction. Do not keep retrying a lock timeout while the production site is
busy; schedule a quiet maintenance window.

## Preferred real backup without the AWS Console

If AWS CLI is installed and authenticated, create a real RDS snapshot before
the rollback-copy action:

```powershell
aws rds create-db-snapshot --region eu-central-1 --db-instance-identifier "YOUR_DB_INSTANCE_ID" --db-snapshot-identifier "vatan-pre-v1-20260806"
aws rds wait db-snapshot-available --region eu-central-1 --db-snapshot-identifier "vatan-pre-v1-20260806"
```

The second command must finish successfully before migration starts. It does
not print or require the PostgreSQL password.

## Cleanup

After application smoke tests and an agreed retention period:

1. set `MIGRATION_ENABLED=false`;
2. remove the temporary route/function;
3. keep the rollback schema until the owner explicitly approves its deletion.

This tool intentionally has no `drop`, `wipe`, or automatic rollback action.
