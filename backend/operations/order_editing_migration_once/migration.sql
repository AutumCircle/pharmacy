-- Packaged from db/migrations/0022_order_editing_and_fractional_quantity.sql.
BEGIN;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS edit_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE order_items ALTER COLUMN quantity TYPE numeric(6,2) USING quantity::numeric(6,2);
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quantity_positive;
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_positive
    CHECK (quantity > 0 AND quantity <= 99 AND mod(quantity * 100, 50) = 0);
COMMIT;
