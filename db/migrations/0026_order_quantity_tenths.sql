-- Allow tenths in existing numeric order_item quantities without rewriting any orders.
-- Apply before deploying Lambda/UI that accepts 0.1 steps. This migration is repeatable.
-- Rollback: if no non-half quantities have been saved, restore the previous
-- CHECK (quantity > 0 AND quantity <= 99 AND mod(quantity * 100, 50) = 0).
-- After non-half quantities exist, roll back the application only and retain
-- this broader constraint; never round or remove existing order items.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items'
      AND column_name = 'quantity' AND data_type = 'numeric' AND numeric_scale >= 1
  ) THEN
    RAISE EXCEPTION 'order_items.quantity must already be numeric with fractional scale';
  END IF;
END $$;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quantity_positive;
ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_positive
  CHECK (quantity >= 0.1 AND quantity <= 99 AND mod(quantity * 100, 1) = 0);

COMMIT;
