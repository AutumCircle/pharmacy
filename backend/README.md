# Pharmacy Vatan backend

The backend is being migrated from the legacy single-action Lambda handlers to the explicit API v1 described in `API_CONTRACT.md`.

## Directories

- `lambda-legacy/`: read-only copies of the currently deployed Lambda source. Do not deploy changes from this directory.
- `local-agent/`: source template for the Windows DBF synchronization agent. Real `config.json`, local SQLite state, logs, virtual environments, and built executables are intentionally excluded.
- `v1/`: new implementation. It is built alongside the legacy API and must pass contract/integration tests before traffic is switched.

## Migration safety

1. Do not edit the live legacy handlers as the main migration strategy.
2. Create `/v1/public`, `/v1/admin`, and `/v1/internal` routes alongside `/api/query`.
3. Test API v1 against a non-production database first.
4. Switch Next.js server-side calls only after the corresponding v1 route is deployed and verified.
5. Remove legacy/destructive actions only after the application no longer depends on them.

The metadata-only RDS structure is stored in `db/current-schema.json` and API v1
source packages can be built with `python scripts/build_lambda_packages.py`.
Buildable does not mean deployed: migration 0002, staging tests, authorizers,
IAM, VPC configuration, and CloudWatch verification are still release gates.
