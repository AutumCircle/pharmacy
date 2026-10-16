-- Pharmacy assembly marks per (order, pharmacy) (job 011): «Начать сборку» -> «Собирается»,
-- «Собран» -> «Собран». No row = «Ждёт сборки». Internal to staff: customer statuses, orders,
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

COMMIT;
