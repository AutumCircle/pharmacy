-- Delivery fee per order, split between the courier and the owner.
-- delivery_fee = delivery_courier_amount + delivery_owner_amount (computed, never stored twice).
-- Existing orders default to 0/0 ("no delivery fee recorded"). Additive and safe to re-run.
BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_courier_amount numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_owner_amount numeric(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_updated_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_updated_by text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_delivery_amounts_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_delivery_amounts_check
            CHECK (delivery_courier_amount >= 0 AND delivery_owner_amount >= 0
                   AND delivery_courier_amount <= 1000000 AND delivery_owner_amount <= 1000000);
    END IF;
END $$;

COMMIT;
