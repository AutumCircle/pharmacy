# Recovery and rollback runbook for migration 0002

Do not run a rollback through a public API route. Stop and identify which of
the following states applies first.

## State A: migration failed inside its transaction

PostgreSQL rolls back all statements in `0002_catalog_sync_v1.sql`. Run the
read-only preflight again. If any `new_*_absent` check fails, do not rerun the
migration: inspect the object definitions because they may be from a manual or
older attempt.

## State B: migration succeeded, but no v1 sync succeeded

Disable the internal sync route and verify with a read-only query that
`catalog_syncs` contains no `status = 'succeeded'` row. Only then may an
operator remove the new tables/columns in a maintenance window. Take an RDS
snapshot first. This repository deliberately does not provide a one-click drop
script because choosing the wrong state would destroy sync audit data.

## State C: at least one v1 sync succeeded

Do not drop 0002 and do not copy the old `medicines` table over the live table.
The sync may have updated prices, stock, and stable source identities, while
new orders may reference those medicine IDs. Preferred recovery order:

1. disable internal sync initiation/commit routes;
2. keep public/admin reads available if the catalogue is consistent;
3. investigate the failed `sync_id`, CloudWatch request ID, and RDS metrics;
4. fix forward with a corrected full snapshot;
5. for actual data corruption, restore an RDS snapshot/PITR into a separate
   instance and reconcile data before any production cutover.

The schema `vatan_pre_v1_20260806` is not a complete disaster-recovery backup.
It predates later API v1 writes and copying it back wholesale could remove new
orders or break references. Use it only as a read-only comparison source.

## Evidence required before any recovery mutation

- RDS snapshot or PITR restore point identifier;
- affected `sync_id` and final status;
- counts from `catalog_syncs`, never full customer payloads;
- confirmation that legacy and v1 sync writers are both stopped;
- explicit operator approval and a written reconciliation plan.
