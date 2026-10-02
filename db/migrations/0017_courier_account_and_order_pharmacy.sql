-- Add one restricted courier login and attribute orders entered by that courier.
-- Existing staff credentials, orders and catalogue data are preserved.
BEGIN;

ALTER TABLE staff_accounts DROP CONSTRAINT IF EXISTS staff_accounts_account_id_check;
ALTER TABLE staff_accounts DROP CONSTRAINT IF EXISTS staff_accounts_catalog_access_check;
ALTER TABLE staff_accounts ALTER COLUMN password_hash DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_accounts_account_id_check') THEN
        ALTER TABLE staff_accounts ADD CONSTRAINT staff_accounts_account_id_check
            CHECK (account_id IN (1, 2, 3));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_accounts_catalog_access_check') THEN
        ALTER TABLE staff_accounts ADD CONSTRAINT staff_accounts_catalog_access_check
            CHECK (catalog_access = (account_id = 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_accounts_pharmacy_password_check') THEN
        ALTER TABLE staff_accounts ADD CONSTRAINT staff_accounts_pharmacy_password_check
            CHECK (account_id = 3 OR password_hash IS NOT NULL);
    END IF;
END $$;

INSERT INTO staff_accounts (account_id, username, password_hash, catalog_access)
VALUES (3, 'courier', NULL, false)
ON CONFLICT (account_id) DO NOTHING;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_pharmacy_id smallint;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_pharmacy_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_fulfillment_pharmacy_check
            CHECK (fulfillment_pharmacy_id IS NULL OR fulfillment_pharmacy_id IN (1, 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_courier_pharmacy_required_check') THEN
        ALTER TABLE orders ADD CONSTRAINT orders_courier_pharmacy_required_check
            CHECK (created_by_staff_account_id IS DISTINCT FROM 3 OR fulfillment_pharmacy_id IN (1, 2));
    END IF;
END $$;

COMMIT;
