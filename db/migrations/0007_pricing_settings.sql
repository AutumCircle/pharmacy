-- Runtime-configurable catalogue markup. Existing order snapshots are never changed.
BEGIN;

CREATE TABLE IF NOT EXISTS pricing_settings (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
    markup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    markup_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100),
    CONSTRAINT pricing_settings_singleton_check CHECK (singleton_id = 1),
    CONSTRAINT pricing_settings_markup_percent_check CHECK (markup_percent BETWEEN 0 AND 100)
);

INSERT INTO pricing_settings (singleton_id, markup_enabled, markup_percent)
VALUES (1, TRUE, 5.00)
ON CONFLICT (singleton_id) DO NOTHING;

CREATE OR REPLACE FUNCTION vatan_selling_unit_price(base_price NUMERIC)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $function$
    SELECT CEIL(
        base_price * COALESCE(
            (
                SELECT CASE
                    WHEN markup_enabled THEN 1 + (markup_percent / 100)
                    ELSE 1
                END
                FROM pricing_settings
                WHERE singleton_id = 1
            ),
            1.05
        )
    )::BIGINT;
$function$;

COMMIT;
