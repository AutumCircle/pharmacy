-- Pharmacy assembly marks per (order, pharmacy) (job 011 + rework 1): «Начать сборку» -> «Собирается»,
-- «Сборка сделана» -> «Собран». No row = «Ждёт сборки». Internal to staff: customer statuses, orders,
-- order_items, order_status_history and existing rows are not touched. Written only by the admin Lambda.
-- Additive and safe to re-run. Apply BEFORE deploying the Lambda that reads this table.
BEGIN;

-- order_id must have exactly the type of orders.id (legacy table), so the type is read from the
-- catalogue instead of being guessed (same approach as 0024).
DO $$
DECLARE
    order_id_type text;
BEGIN
    SELECT format_type(a.atttypid, a.atttypmod) INTO order_id_type
    FROM pg_attribute a
    WHERE a.attrelid = 'orders'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
    IF order_id_type IS NULL THEN
        RAISE EXCEPTION 'orders.id not found';
    END IF;
    EXECUTE format($ddl$
        CREATE TABLE IF NOT EXISTS order_pharmacy_assembly (
            order_id %s NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            pharmacy_id smallint NOT NULL
                CONSTRAINT order_pharmacy_assembly_pharmacy_check CHECK (pharmacy_id IN (1, 2)),
            state text NOT NULL
                CONSTRAINT order_pharmacy_assembly_state_check CHECK (state IN ('assembling', 'assembled')),
            started_at timestamptz NOT NULL DEFAULT now(),
            assembled_at timestamptz NULL,
            updated_by text NOT NULL,
            CONSTRAINT order_pharmacy_assembly_assembled_at_check
                CHECK ((state = 'assembled') = (assembled_at IS NOT NULL)),
            PRIMARY KEY (order_id, pharmacy_id)
        )$ddl$, order_id_type);
END $$;

-- Rework 1: per-item «Собрано» (used by «Ватан 2» for items routed to it). One row per item per
-- pharmacy; order_item_id has exactly the type of order_items.id (read from the catalogue, as in 0024).
DO $$
DECLARE
    item_id_type text;
BEGIN
    SELECT format_type(a.atttypid, a.atttypmod) INTO item_id_type
    FROM pg_attribute a
    WHERE a.attrelid = 'order_items'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
    IF item_id_type IS NULL THEN
        RAISE EXCEPTION 'order_items.id not found';
    END IF;
    EXECUTE format($ddl$
        CREATE TABLE IF NOT EXISTS order_item_assembly (
            order_item_id %s NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
            pharmacy_id smallint NOT NULL
                CONSTRAINT order_item_assembly_pharmacy_check CHECK (pharmacy_id IN (1, 2)),
            collected_at timestamptz NOT NULL DEFAULT now(),
            collected_by text NOT NULL,
            PRIMARY KEY (order_item_id, pharmacy_id)
        )$ddl$, item_id_type);
END $$;

COMMIT;
