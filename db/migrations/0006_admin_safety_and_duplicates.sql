-- Safe admin deletion foundation. Orders are archived (soft-deleted), not erased.
BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_by VARCHAR(100);

CREATE INDEX IF NOT EXISTS orders_visible_created
    ON orders (created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id VARCHAR(100) NOT NULL,
    action VARCHAR(80) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(100) NOT NULL,
    request_id VARCHAR(80) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_audit_log_resource_created
    ON admin_audit_log (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_created
    ON admin_audit_log (actor_id, created_at DESC);

COMMIT;
