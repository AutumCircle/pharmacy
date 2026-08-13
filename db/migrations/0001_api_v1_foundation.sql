-- Pharmacy Vatan API v1 foundation
--
-- Purpose: add new API v1 data structures without removing or renaming legacy
-- columns. Run this once against a tested copy of RDS before production.
--
-- Do not run this file through the legacy public action router.

BEGIN;

CREATE TABLE IF NOT EXISTS order_status_history (
    id BIGSERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    from_status VARCHAR(50),
    to_status VARCHAR(50) NOT NULL,
    actor_type VARCHAR(30) NOT NULL,
    actor_id VARCHAR(100),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT order_status_history_actor_type_check
        CHECK (actor_type IN ('system', 'customer', 'admin', 'legacy_import')),
    CONSTRAINT order_status_history_to_status_check
        CHECK (to_status IN ('pending', 'confirmed', 'delivering', 'delivered', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS order_idempotency (
    id BIGSERIAL PRIMARY KEY,
    idempotency_key UUID NOT NULL UNIQUE,
    request_hash CHAR(64) NOT NULL,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    response_status SMALLINT,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_id VARCHAR(40);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_reference VARCHAR(64);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS items_subtotal NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_total NUMERIC(10,2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'TJS';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) NOT NULL DEFAULT 'cash_on_delivery';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'unpaid';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone_normalized VARCHAR(13);

-- Legacy orders already have total_price. Preserve it and use it to initialize
-- the API v1 display totals; delivery is deliberately not introduced.
UPDATE orders
SET items_subtotal = total_price,
    order_total = total_price
WHERE items_subtotal IS NULL OR order_total IS NULL;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS medicine_id INTEGER REFERENCES medicines(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS base_unit_price NUMERIC(10,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS selling_unit_price NUMERIC(10,2);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(10,2);

-- Existing legacy rows are historical snapshots. Their medicine IDs are not
-- guessed because duplicate names can exist in the current catalogue.
UPDATE order_items
SET selling_unit_price = price,
    line_total = price * quantity
WHERE selling_unit_price IS NULL OR line_total IS NULL;

ALTER TABLE category_medicines ADD COLUMN IF NOT EXISTS medicine_id INTEGER REFERENCES medicines(id);
ALTER TABLE featured_products ADD COLUMN IF NOT EXISTS medicine_id INTEGER REFERENCES medicines(id);

-- Safe best-effort backfill only when a name has one catalogue match.
WITH unique_medicine_names AS (
    SELECT name, MIN(id) AS medicine_id
    FROM medicines
    GROUP BY name
    HAVING COUNT(*) = 1
)
UPDATE category_medicines AS cm
SET medicine_id = u.medicine_id
FROM unique_medicine_names AS u
WHERE cm.medicine_id IS NULL AND cm.medicine_name = u.name;

WITH unique_medicine_names AS (
    SELECT name, MIN(id) AS medicine_id
    FROM medicines
    GROUP BY name
    HAVING COUNT(*) = 1
)
UPDATE featured_products AS fp
SET medicine_id = u.medicine_id
FROM unique_medicine_names AS u
WHERE fp.medicine_id IS NULL AND fp.medicine_name = u.name;

-- Normalize only clear Tajik phone forms. Ambiguous legacy phones stay NULL
-- and are never exposed by the API v1 tracking endpoint.
UPDATE orders
SET phone_normalized = CASE
    WHEN regexp_replace(phone, '\D', '', 'g') ~ '^[0-9]{9}$'
        THEN '+992' || regexp_replace(phone, '\D', '', 'g')
    WHEN regexp_replace(phone, '\D', '', 'g') ~ '^992[0-9]{9}$'
        THEN '+' || regexp_replace(phone, '\D', '', 'g')
    ELSE NULL
END
WHERE phone_normalized IS NULL;

-- Preserve an auditable starting point for historical orders. New API v1
-- orders will insert their own precise status-history record.
INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, created_at)
SELECT o.id, NULL, o.status, 'legacy_import', o.created_at
FROM orders AS o
WHERE o.status IN ('pending', 'confirmed', 'delivering', 'delivered', 'cancelled')
  AND NOT EXISTS (
      SELECT 1
      FROM order_status_history AS h
      WHERE h.order_id = o.id AND h.actor_type = 'legacy_import'
  );

CREATE UNIQUE INDEX IF NOT EXISTS orders_public_id_unique
    ON orders (public_id)
    WHERE public_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_reference_unique
    ON orders (order_reference)
    WHERE order_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS medicines_public_search_trgm
    ON medicines USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS medicines_public_available_id
    ON medicines (id)
    WHERE in_stock IS TRUE;

CREATE INDEX IF NOT EXISTS orders_tracking_phone_created
    ON orders (phone_normalized, created_at DESC, id DESC)
    WHERE phone_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_admin_status_created
    ON orders (status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS order_items_order_id
    ON order_items (order_id);

CREATE UNIQUE INDEX IF NOT EXISTS category_medicines_category_medicine_unique
    ON category_medicines (category_id, medicine_id)
    WHERE medicine_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS featured_products_medicine_unique
    ON featured_products (medicine_id)
    WHERE medicine_id IS NOT NULL;

COMMIT;
