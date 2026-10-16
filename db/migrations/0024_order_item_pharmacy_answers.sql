-- Pharmacist availability answers per order item and per-item pharmacy assignment (job 010).
-- * order_items.fulfillment_pharmacy_id: NULL = the order's pharmacy (COALESCE(oi, o, 1)); set to 2 when
--   «Ватан 1» answers «Нет в наличии» and the item is routed automatically to «Ватан 2».
-- * order_items.pharmacy_assigned_at: when the item was routed (drives the «Ватан 2» waiting timer).
-- * order_item_pharmacy_answers: one answer per item per pharmacy, written only by the admin Lambda.
-- No change to orders.status, order_status_history or existing rows; existing items keep NULL.
-- Additive and safe to re-run. Apply BEFORE deploying the Lambda that reads these columns.
BEGIN;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS fulfillment_pharmacy_id smallint;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS pharmacy_assigned_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_fulfillment_pharmacy_check') THEN
        ALTER TABLE order_items ADD CONSTRAINT order_items_fulfillment_pharmacy_check
            CHECK (fulfillment_pharmacy_id IS NULL OR fulfillment_pharmacy_id IN (1, 2));
    END IF;
END $$;

-- order_item_id must have exactly the type of order_items.id (legacy table), so the type is read
-- from the catalogue instead of being guessed.
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
        CREATE TABLE IF NOT EXISTS order_item_pharmacy_answers (
            order_item_id %s NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
            pharmacy_id smallint NOT NULL
                CONSTRAINT order_item_pharmacy_answers_pharmacy_check CHECK (pharmacy_id IN (1, 2)),
            answer text NOT NULL
                CONSTRAINT order_item_pharmacy_answers_answer_check
                CHECK (answer IN ('available', 'unavailable', 'price_differs')),
            problem text
                CONSTRAINT order_item_pharmacy_answers_problem_check
                CHECK (problem IS NULL OR char_length(problem) BETWEEN 1 AND 300),
            answered_at timestamptz NOT NULL DEFAULT now(),
            answered_by text NOT NULL,
            PRIMARY KEY (order_item_id, pharmacy_id)
        )$ddl$, item_id_type);
END $$;

CREATE INDEX IF NOT EXISTS order_items_fulfillment_pharmacy_idx
    ON order_items (fulfillment_pharmacy_id)
    WHERE fulfillment_pharmacy_id IS NOT NULL;

COMMIT;
