-- Marketing collections (/podborka/<slug>), first-party click statistics and order attribution.
-- Additive and safe to re-run. Apply after an RDS snapshot, before deploying the matching
-- Public/Admin Lambda packages.
BEGIN;

CREATE TABLE IF NOT EXISTS collections (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(80) NOT NULL UNIQUE,
    title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    -- Ordered list of medicines.id. Order in the array is the display order.
    product_ids INTEGER[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT collections_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    CONSTRAINT collections_title_check CHECK (length(btrim(title)) BETWEEN 2 AND 160),
    CONSTRAINT collections_description_check CHECK (length(description) <= 1000),
    CONSTRAINT collections_product_ids_check CHECK (cardinality(product_ids) <= 50)
);

-- No foreign key on collection_slug: statistics must survive deleting or renaming a collection.
CREATE TABLE IF NOT EXISTS collection_events (
    id BIGSERIAL PRIMARY KEY,
    collection_slug VARCHAR(80) NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    product_id INTEGER,
    visitor_id VARCHAR(64) NOT NULL,
    utm_source VARCHAR(100),
    utm_medium VARCHAR(100),
    utm_campaign VARCHAR(100),
    utm_content VARCHAR(100),
    referrer VARCHAR(500),
    user_agent VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT collection_events_type_check
        CHECK (event_type IN ('view', 'product_open', 'add_to_cart')),
    CONSTRAINT collection_events_product_check
        CHECK ((event_type = 'view' AND product_id IS NULL)
            OR (event_type <> 'view' AND product_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS collection_events_slug_created
    ON collection_events (collection_slug, created_at);
CREATE INDEX IF NOT EXISTS collection_events_created
    ON collection_events (created_at);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source_collection VARCHAR(80);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_source VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_medium VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_campaign VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS utm_content VARCHAR(100);

CREATE INDEX IF NOT EXISTS orders_source_collection_created
    ON orders (source_collection, created_at) WHERE source_collection IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_utm_created
    ON orders (created_at) WHERE utm_source IS NOT NULL OR utm_content IS NOT NULL;

-- First collections. Only IDs that exist in the current catalogue are linked, in the given order.
-- oct-5 is created inactive: the third product has to be added by the SMM specialist first.
-- Tirzetta (prescription medicine) must never be added to any collection.
INSERT INTO collections (slug, title, description, product_ids, is_active)
SELECT 'oct-6', 'Подборка 6 октября', 'Товары из нашего поста в Instagram. Цены и наличие актуальны.',
       COALESCE((SELECT array_agg(t.id ORDER BY t.ord)
                 FROM unnest(ARRAY[10059, 4048, 8955]) WITH ORDINALITY AS t(id, ord)
                 WHERE EXISTS (SELECT 1 FROM medicines m WHERE m.id = t.id)), '{}'),
       TRUE
ON CONFLICT (slug) DO NOTHING;

INSERT INTO collections (slug, title, description, product_ids, is_active)
SELECT 'oct-5', 'Подборка 5 октября', 'Товары из нашего поста в Instagram. Цены и наличие актуальны.',
       COALESCE((SELECT array_agg(t.id ORDER BY t.ord)
                 FROM unnest(ARRAY[1671, 5646]) WITH ORDINALITY AS t(id, ord)
                 WHERE EXISTS (SELECT 1 FROM medicines m WHERE m.id = t.id)), '{}'),
       FALSE
ON CONFLICT (slug) DO NOTHING;

COMMIT;
