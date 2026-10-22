"""IAM-only one-off Lambda for reviewed additive migration 0028.

Bundle migration.sql alongside this handler. The release operator must check an
AVAILABLE RDS snapshot before invoking. No public API integration, no row writes.
"""
import os
from pathlib import Path
import psycopg2
from psycopg2 import sql as identifiers


def lambda_handler(event, context):
    if event != {'confirmation': 'APPLY_ADDITIVE_MIRROR_INDEXES_0028'}:
        raise ValueError('Explicit migration confirmation required')
    conn = psycopg2.connect(host=os.environ['DB_HOST'], dbname=os.environ['DB_NAME'],
        user=os.environ['DB_USER'], password=os.environ['DB_PASSWORD'],
        port=os.environ.get('DB_PORT','5432'),sslmode='require',connect_timeout=5)
    conn.autocommit = True  # CREATE INDEX CONCURRENTLY cannot run in a transaction
    try:
        with conn.cursor() as cur:
            cur.execute("SET lock_timeout='10s'")
            cur.execute("SET statement_timeout='180s'")
            cur.execute('SELECT pg_try_advisory_lock(28281022)')
            if not cur.fetchone()[0]: raise RuntimeError('Migration already running')
            # CONCURRENTLY can leave an unusable index after lock timeout. Only
            # repair those exact migration-owned INVALID artifacts, never a
            # valid index or any source row. Valid indexes remain untouched.
            cur.execute("""SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND NOT i.indisvalid AND c.relname IN
                ('pharmacy_mirror_product_name_trgm','pharmacy_mirror_product_barcode',
                'pharmacy_mirror_stock_product','pharmacy_mirror_income_product','pharmacy_mirror_income_barcode','pharmacy_mirror_admin_status')""")
            for (name,) in cur.fetchall():
                cur.execute(identifiers.SQL('DROP INDEX CONCURRENTLY {}').format(identifiers.Identifier(name)))
            sql = '\n'.join(line for line in Path('migration.sql').read_text().splitlines()
                            if not line.lstrip().startswith('--'))
            for statement in sql.split(';'):
                if statement.strip(): cur.execute(statement)
            cur.execute("""SELECT c.relname,i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                WHERE c.relname IN ('pharmacy_mirror_product_name_trgm','pharmacy_mirror_product_barcode',
                'pharmacy_mirror_stock_product','pharmacy_mirror_income_product','pharmacy_mirror_income_barcode','pharmacy_mirror_admin_status')""")
            return {'indexes': cur.fetchall()}
    finally: conn.close()
