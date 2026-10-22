-- Additive/idempotent. Run OUTSIDE a transaction after an available RDS snapshot.
-- CONCURRENTLY preserves agent writes. Check indisvalid after interruption;
-- an invalid index must be removed CONCURRENTLY before retrying that statement.
-- pg_trgm already exists in production (catalogue search uses it).
CREATE INDEX CONCURRENTLY IF NOT EXISTS pharmacy_mirror_product_name_trgm
ON pharmacy_mirror_rows USING gin (lower(data->>'PRODUCT_NAME') gin_trgm_ops)
WHERE pharmacy_id=1 AND table_name='T_PRODUCT';
CREATE INDEX CONCURRENTLY IF NOT EXISTS pharmacy_mirror_product_barcode
ON pharmacy_mirror_rows ((data->>'SCAN_CODE'),row_key)
WHERE pharmacy_id=1 AND table_name='T_PRODUCT';
CREATE INDEX CONCURRENTLY IF NOT EXISTS pharmacy_mirror_stock_product
ON pharmacy_mirror_rows ((data->>'PRODUCT_ID'),row_key)
WHERE pharmacy_id=1 AND table_name='T_SKLAD_STATE';
CREATE INDEX CONCURRENTLY IF NOT EXISTS pharmacy_mirror_income_product
ON pharmacy_mirror_rows ((data->>'PRODUCT_ID'),row_key)
WHERE pharmacy_id=1 AND table_name='T_INCOME';
-- Cover the 12-table count/freshness query without reading the JSONB heap.
CREATE INDEX CONCURRENTLY IF NOT EXISTS pharmacy_mirror_admin_status
ON pharmacy_mirror_rows (pharmacy_id,table_name)
INCLUDE (change_id,received_at,source_generated_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS pharmacy_mirror_income_barcode
ON pharmacy_mirror_rows ((data->>'INCOME_SCAN_CODE'),(data->>'PRODUCT_ID'))
WHERE pharmacy_id=1 AND table_name='T_INCOME';
-- Rollback: first restore previous admin Lambda and Vercel deployment. Indexes
-- may remain (no row/schema changes); if removal is needed use DROP INDEX
-- CONCURRENTLY IF EXISTS for these six names only. Never restore the database
-- snapshot over ongoing agent changes for a code/index rollback.
