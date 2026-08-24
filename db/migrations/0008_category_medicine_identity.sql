-- Category membership is identified by medicine_id, not by the mutable display name.
-- Keep medicine_name as a legacy snapshot column, but allow distinct medicine IDs
-- that currently share the same name to belong to the same category.

BEGIN;

ALTER TABLE category_medicines
    DROP CONSTRAINT IF EXISTS category_medicines_category_id_medicine_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS category_medicines_category_medicine_unique
    ON category_medicines (category_id, medicine_id)
    WHERE medicine_id IS NOT NULL;

COMMIT;
