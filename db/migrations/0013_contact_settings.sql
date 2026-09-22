BEGIN;

CREATE TABLE IF NOT EXISTS site_contact_settings (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
    delivery_contact_phone VARCHAR(13),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100),
    CONSTRAINT site_contact_settings_singleton_check CHECK (singleton_id = 1),
    CONSTRAINT site_contact_settings_phone_check CHECK (
        delivery_contact_phone IS NULL OR delivery_contact_phone ~ '^\+992[0-9]{9}$'
    )
);

INSERT INTO site_contact_settings (singleton_id, delivery_contact_phone)
VALUES (1, NULL)
ON CONFLICT (singleton_id) DO NOTHING;

COMMIT;
