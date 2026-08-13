# Rollback 0006

Migration 0006 is additive. Deploy the previous Lambda packages first. The new
columns and audit table may remain unused without affecting legacy behavior.

If a later maintenance window requires physical cleanup, export
`admin_audit_log`, confirm that no order has `deleted_at IS NOT NULL`, and only
then remove the indexes, table, and columns manually. Never do that through API
Gateway.
