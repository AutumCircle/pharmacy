-- Prepared only: do not apply to production until the owner approves fractional
-- quantities and a tested backup/rollback window is scheduled.
--
-- The conversion is narrow and reversible while every value is a multiple of
-- 0.01. It does not rewrite prices, order timestamps or status history.
BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS edit_revision bigint NOT NULL DEFAULT 1;

-- quantity used to be integer. Numeric(6,2) permits 0.50..99.00 while keeping
-- historical integer values exact. The application only accepts 0.50 steps.
ALTER TABLE order_items
    ALTER COLUMN quantity TYPE numeric(6,2) USING quantity::numeric(6,2);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quantity_positive;
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_positive
    CHECK (quantity > 0 AND quantity <= 99 AND mod(quantity * 100, 50) = 0);

COMMIT;
