-- Manual order leads entered by the two fixed pharmacy staff accounts.
-- Additive only: public orders and existing rows keep their current behavior.
BEGIN;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS created_by_staff_account_id smallint
        REFERENCES staff_accounts(account_id),
    ADD COLUMN IF NOT EXISTS order_source varchar(20),
    ADD COLUMN IF NOT EXISTS landmark text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'orders_order_source_check'
    ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_order_source_check
            CHECK (order_source IS NULL OR order_source IN ('instagram', 'whatsapp', 'phone'));
    END IF;
END $$;

ALTER TABLE order_status_history DROP CONSTRAINT IF EXISTS order_status_history_actor_type_check;
ALTER TABLE order_status_history ADD CONSTRAINT order_status_history_actor_type_check
    CHECK (actor_type IN ('system', 'customer', 'admin', 'staff', 'legacy_import'));

CREATE INDEX IF NOT EXISTS orders_staff_created
    ON orders (created_by_staff_account_id, created_at DESC, id DESC)
    WHERE created_by_staff_account_id IS NOT NULL;

COMMIT;
