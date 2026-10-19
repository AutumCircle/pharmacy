# Rollback 0022

Use only after confirming `SELECT count(*) FROM order_items WHERE quantity <> trunc(quantity);` is zero.
Then, in a maintenance window and after a verified RDS snapshot:

```sql
BEGIN;
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quantity_positive;
ALTER TABLE order_items ALTER COLUMN quantity TYPE integer USING quantity::integer;
ALTER TABLE orders DROP COLUMN IF EXISTS edit_revision;
COMMIT;
```

If fractional rows exist, do not run this rollback: restore the pre-migration snapshot instead.
