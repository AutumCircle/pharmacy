-- Additive, repeatable. Roll back application code first; leave these tables in
-- place until an explicit data-retention decision. No existing orders are changed.
BEGIN;

CREATE TABLE IF NOT EXISTS order_notification_settings (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton_id = 1),
    courier_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    courier_enabled_since TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    policies JSONB NOT NULL DEFAULT '{}'::jsonb,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

INSERT INTO order_notification_settings (singleton_id)
VALUES (1) ON CONFLICT (singleton_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS order_notification_deliveries (
    event_key VARCHAR(100) NOT NULL,
    recipient VARCHAR(32) NOT NULL CHECK (recipient IN ('owner_telegram', 'courier_telegram', 'pharmacy_telegram')),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (event_key, recipient)
);

COMMIT;
