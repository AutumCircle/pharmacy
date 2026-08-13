-- Read-only preflight for 0002_catalog_sync_v1.sql.
-- Returns counts and metadata only; it never returns medicine, order, or user rows.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH checks AS (
    SELECT
        'postgres_version'::text AS name,
        CASE WHEN current_setting('server_version_num')::integer >= 130000 THEN 'pass' ELSE 'fail' END AS status,
        to_jsonb(current_setting('server_version')) AS observed,
        'PostgreSQL 13 or newer is required by the supported deployment baseline.'::text AS message
    UNION ALL
    SELECT
        'required_base_tables',
        CASE WHEN (
            SELECT COUNT(*) FROM (VALUES ('public.medicines'), ('public.sync_logs')) required(table_name)
            WHERE to_regclass(required.table_name) IS NOT NULL
        ) = 2 THEN 'pass' ELSE 'fail' END,
        to_jsonb((
            SELECT COUNT(*) FROM (VALUES ('public.medicines'), ('public.sync_logs')) required(table_name)
            WHERE to_regclass(required.table_name) IS NOT NULL
        )),
        'Both medicines and sync_logs must exist.'
    UNION ALL
    SELECT
        'new_sync_tables_absent',
        CASE WHEN (
            SELECT COUNT(*) FROM (VALUES
                ('public.catalog_syncs'), ('public.catalog_sync_items'), ('public.catalog_sync_conflicts')
            ) candidate(table_name) WHERE to_regclass(candidate.table_name) IS NOT NULL
        ) = 0 THEN 'pass' ELSE 'fail' END,
        to_jsonb((
            SELECT COUNT(*) FROM (VALUES
                ('public.catalog_syncs'), ('public.catalog_sync_items'), ('public.catalog_sync_conflicts')
            ) candidate(table_name) WHERE to_regclass(candidate.table_name) IS NOT NULL
        )),
        'Existing sync tables indicate a prior or partial 0002 attempt.'
    UNION ALL
    SELECT
        'new_medicine_columns_absent',
        CASE WHEN COUNT(*) = 0 THEN 'pass' ELSE 'fail' END,
        to_jsonb(COUNT(*)),
        'Existing source columns indicate a prior or partial 0002 attempt.'
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'medicines'
      AND column_name IN ('source_system', 'source_sku', 'source_identity_key', 'last_seen_sync_id', 'source_row_hash')
    UNION ALL
    SELECT
        'pg_trgm_installed',
        CASE WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN 'pass' ELSE 'fail' END,
        to_jsonb(EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm')),
        'The existing public search requires pg_trgm.'
    UNION ALL
    SELECT
        'medicine_names_valid',
        CASE WHEN COUNT(*) = 0 THEN 'pass' ELSE 'fail' END,
        to_jsonb(COUNT(*)),
        'Blank medicine names must be corrected before source identity adoption.'
    FROM medicines WHERE name IS NULL OR btrim(name) = ''
    UNION ALL
    SELECT
        'medicine_prices_valid',
        CASE WHEN COUNT(*) = 0 THEN 'pass' ELSE 'fail' END,
        to_jsonb(COUNT(*)),
        'Null or non-positive base prices cannot be published.'
    FROM medicines WHERE price IS NULL OR price <= 0
    UNION ALL
    SELECT
        'normalized_identity_unique',
        CASE WHEN COUNT(*) = 0 THEN 'pass' ELSE 'warn' END,
        to_jsonb(COUNT(*)),
        'Fallback identity duplicates will be merged deterministically and recorded during sync.'
    FROM (
        SELECT lower(btrim(name)), lower(btrim(COALESCE(country, ''))), lower(btrim(COALESCE(vendor, '')))
        FROM medicines
        GROUP BY 1, 2, 3
        HAVING COUNT(*) > 1
    ) duplicate_groups
    UNION ALL
    SELECT
        'nullable_catalog_attributes',
        CASE WHEN COUNT(*) = 0 THEN 'pass' ELSE 'warn' END,
        to_jsonb(COUNT(*)),
        'Null country/vendor values are supported through normalization but should be monitored.'
    FROM medicines WHERE country IS NULL OR vendor IS NULL OR in_stock IS NULL
    UNION ALL
    SELECT
        'category_links_without_medicine_id',
        CASE WHEN COUNT(*) = 0 THEN 'pass' ELSE 'warn' END,
        to_jsonb(COUNT(*)),
        'Legacy category links without medicine_id remain invisible to API v1.'
    FROM category_medicines WHERE medicine_id IS NULL
    UNION ALL
    SELECT
        'rds_backup_schema_present',
        CASE WHEN to_regnamespace('vatan_pre_v1_20260806') IS NOT NULL THEN 'pass' ELSE 'warn' END,
        to_jsonb(to_regnamespace('vatan_pre_v1_20260806') IS NOT NULL),
        'The same-database backup schema is an extra safeguard, not a replacement for an RDS snapshot.'
    UNION ALL
    SELECT
        'medicine_row_count', 'info', to_jsonb(COUNT(*)), 'Count only; no catalogue rows are returned.'
    FROM medicines
    UNION ALL
    SELECT
        'active_database_connections', 'info', to_jsonb(COUNT(*)), 'Compare with max_connections before Lambda rollout.'
    FROM pg_stat_activity WHERE datname = current_database()
    UNION ALL
    SELECT
        'max_connections', 'info', to_jsonb(current_setting('max_connections')::integer), 'PostgreSQL connection ceiling.'
)
SELECT jsonb_build_object(
    'format', 'vatan-0002-preflight/v1',
    'ready', COALESCE(bool_and(status <> 'fail'), FALSE),
    'summary', jsonb_build_object(
        'pass', COUNT(*) FILTER (WHERE status = 'pass'),
        'warn', COUNT(*) FILTER (WHERE status = 'warn'),
        'fail', COUNT(*) FILTER (WHERE status = 'fail'),
        'info', COUNT(*) FILTER (WHERE status = 'info')
    ),
    'checks', jsonb_agg(
        jsonb_build_object('name', name, 'status', status, 'observed', observed, 'message', message)
        ORDER BY name
    )
) AS preflight_report
FROM checks;

COMMIT;
