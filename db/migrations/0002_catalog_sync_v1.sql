-- Pharmacy Vatan catalog synchronization v1 foundation.
-- Additive only: legacy sync_logs and medicines columns remain available.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
BEGIN
    IF to_regclass('public.medicines') IS NULL OR to_regclass('public.sync_logs') IS NULL THEN
        RAISE EXCEPTION '0002 prerequisite tables are missing';
    END IF;
    IF to_regclass('public.catalog_syncs') IS NOT NULL
       OR to_regclass('public.catalog_sync_items') IS NOT NULL
       OR to_regclass('public.catalog_sync_conflicts') IS NOT NULL THEN
        RAISE EXCEPTION '0002 sync tables already exist; inspect partial or prior migration state';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'medicines'
          AND column_name IN ('source_system', 'source_sku', 'source_identity_key', 'last_seen_sync_id', 'source_row_hash')
    ) THEN
        RAISE EXCEPTION '0002 medicines columns already exist; inspect partial or prior migration state';
    END IF;
END
$$;

CREATE TABLE catalog_syncs (
    sync_id UUID PRIMARY KEY,
    idempotency_key UUID NOT NULL UNIQUE,
    source_id VARCHAR(100) NOT NULL,
    initiated_by VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'awaiting_upload',
    object_key TEXT NOT NULL UNIQUE,
    snapshot_sha256 CHAR(64) NOT NULL,
    source_updated_at TIMESTAMPTZ NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    compressed_size_bytes INTEGER NOT NULL,
    expected_row_count INTEGER NOT NULL,
    received_row_count INTEGER,
    inserted_count INTEGER NOT NULL DEFAULT 0,
    updated_count INTEGER NOT NULL DEFAULT 0,
    in_stock_count INTEGER NOT NULL DEFAULT 0,
    out_of_stock_count INTEGER NOT NULL DEFAULT 0,
    conflict_count INTEGER NOT NULL DEFAULT 0,
    error_code VARCHAR(100),
    error_summary JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT catalog_syncs_status_check CHECK (
        status IN ('awaiting_upload', 'validating', 'importing', 'succeeded', 'failed')
    ),
    CONSTRAINT catalog_syncs_expected_rows_check CHECK (expected_row_count > 0),
    CONSTRAINT catalog_syncs_compressed_size_check CHECK (compressed_size_bytes > 0),
    CONSTRAINT catalog_syncs_sha256_check CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE catalog_sync_items (
    sync_id UUID NOT NULL REFERENCES catalog_syncs(sync_id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    source_sku VARCHAR(255),
    raw_name TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    country VARCHAR(100) NOT NULL DEFAULT '',
    vendor VARCHAR(100) NOT NULL DEFAULT '',
    base_price NUMERIC(10,2) NOT NULL,
    in_stock BOOLEAN NOT NULL,
    identity_key CHAR(64) NOT NULL,
    source_row_hash CHAR(64) NOT NULL,
    PRIMARY KEY (sync_id, row_number),
    CONSTRAINT catalog_sync_items_row_number_check CHECK (row_number > 0),
    CONSTRAINT catalog_sync_items_price_check CHECK (base_price > 0),
    CONSTRAINT catalog_sync_items_identity_check CHECK (identity_key ~ '^[0-9a-f]{64}$'),
    CONSTRAINT catalog_sync_items_row_hash_check CHECK (source_row_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE catalog_sync_conflicts (
    id BIGSERIAL PRIMARY KEY,
    sync_id UUID NOT NULL REFERENCES catalog_syncs(sync_id) ON DELETE CASCADE,
    identity_key CHAR(64) NOT NULL,
    row_numbers INTEGER[] NOT NULL,
    reason VARCHAR(100) NOT NULL,
    safe_summary JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE medicines ADD COLUMN source_system VARCHAR(100);
ALTER TABLE medicines ADD COLUMN source_sku VARCHAR(255);
ALTER TABLE medicines ADD COLUMN source_identity_key CHAR(64);
ALTER TABLE medicines ADD COLUMN last_seen_sync_id UUID REFERENCES catalog_syncs(sync_id);
ALTER TABLE medicines ADD COLUMN source_row_hash CHAR(64);

CREATE UNIQUE INDEX medicines_source_system_sku_unique
    ON medicines (source_system, source_sku)
    WHERE source_system IS NOT NULL AND source_sku IS NOT NULL;

CREATE UNIQUE INDEX medicines_source_system_identity_unique
    ON medicines (source_system, source_identity_key)
    WHERE source_system IS NOT NULL AND source_identity_key IS NOT NULL;

CREATE INDEX medicines_last_seen_sync_id
    ON medicines (last_seen_sync_id)
    WHERE last_seen_sync_id IS NOT NULL;

CREATE INDEX catalog_syncs_source_created
    ON catalog_syncs (source_id, created_at DESC);

CREATE INDEX catalog_syncs_status_created
    ON catalog_syncs (status, created_at DESC);

CREATE INDEX catalog_sync_items_identity
    ON catalog_sync_items (sync_id, identity_key);

CREATE INDEX catalog_sync_conflicts_sync
    ON catalog_sync_conflicts (sync_id, id);

COMMIT;
