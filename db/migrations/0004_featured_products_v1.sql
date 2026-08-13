-- Admin-managed "Products of the day" carousel metadata.
BEGIN;

ALTER TABLE featured_products ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE featured_products ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Legacy uniqueness by name conflicts with the catalogue identity based on medicine_id.
ALTER TABLE featured_products DROP CONSTRAINT IF EXISTS featured_products_medicine_name_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'featured_products_image_url_check'
    ) THEN
        ALTER TABLE featured_products
            ADD CONSTRAINT featured_products_image_url_check
            CHECK (image_url IS NULL OR image_url ~ '^https://');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS featured_products_sort_order
    ON featured_products (sort_order ASC, id ASC);

COMMIT;
