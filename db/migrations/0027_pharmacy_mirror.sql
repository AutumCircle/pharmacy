-- Raw read-only mirror of selected Oracle tables of the pharmacy program «Алгоритм».
-- Written only by the pharmacy agent through the internal API; nothing on the storefront reads it
-- yet (shadow mode). Additive and safe to re-run. Apply after an RDS snapshot, before deploying
-- the matching Internal Sync Lambda package.
BEGIN;

CREATE TABLE IF NOT EXISTS pharmacy_sources (
    pharmacy_id SMALLINT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ,
    last_batch_at TIMESTAMPTZ,
    agent_version VARCHAR(40),
    agent_status JSONB,
    CONSTRAINT pharmacy_sources_id_check CHECK (pharmacy_id BETWEEN 1 AND 99)
);

INSERT INTO pharmacy_sources (pharmacy_id, name)
VALUES (1, 'Аптека №1')
ON CONFLICT (pharmacy_id) DO NOTHING;

-- One row per source row. data holds every non-null Oracle column of that row, keyed by the
-- upper-case Oracle column name. Oracle NUMBER values that are not integers are stored as JSON
-- strings to keep exact decimals; dates are ISO-8601 strings.
CREATE TABLE IF NOT EXISTS pharmacy_mirror_rows (
    pharmacy_id SMALLINT NOT NULL REFERENCES pharmacy_sources (pharmacy_id),
    table_name VARCHAR(64) NOT NULL,
    row_key VARCHAR(200) NOT NULL,
    change_id BIGINT,
    data JSONB NOT NULL,
    source_generated_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (pharmacy_id, table_name, row_key),
    CONSTRAINT pharmacy_mirror_rows_table_check CHECK (table_name ~ '^[A-Z][A-Z0-9_]{0,63}$'),
    CONSTRAINT pharmacy_mirror_rows_data_check CHECK (jsonb_typeof(data) = 'object')
);

CREATE INDEX IF NOT EXISTS pharmacy_mirror_rows_change_idx
    ON pharmacy_mirror_rows (pharmacy_id, table_name, change_id);

-- Applied agent batches. batch_id makes a retried upload idempotent.
CREATE TABLE IF NOT EXISTS pharmacy_mirror_batches (
    batch_id UUID PRIMARY KEY,
    pharmacy_id SMALLINT NOT NULL REFERENCES pharmacy_sources (pharmacy_id),
    table_name VARCHAR(64) NOT NULL,
    upserted_count INTEGER NOT NULL,
    deleted_count INTEGER NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS pharmacy_mirror_batches_received_idx
    ON pharmacy_mirror_batches (pharmacy_id, received_at DESC);

COMMIT;
