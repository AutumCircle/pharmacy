"""Add an inactive smartphone banner without changing desktop banners."""
from __future__ import annotations

import json
import os
import psycopg2

SQL = """
ALTER TABLE categories ALTER COLUMN icon TYPE TEXT;
ALTER TABLE homepage_banners DROP CONSTRAINT IF EXISTS homepage_banners_slot_check;
ALTER TABLE homepage_banners ADD CONSTRAINT homepage_banners_slot_check
    CHECK (slot IN ('left', 'center', 'right_top', 'right_bottom', 'mobile'));
INSERT INTO homepage_banners (slot, title, is_active)
VALUES ('mobile', NULL, FALSE) ON CONFLICT (slot) DO NOTHING;
"""


def lambda_handler(event, context):
    if event.get('action') not in ('inspect', 'apply'):
        return {'statusCode': 403, 'body': 'Invalid action'}
    if event['action'] == 'apply' and event.get('confirmation') != 'VATAN-0011-MOBILE-BANNER':
        return {'statusCode': 403, 'body': 'Invalid confirmation'}
    connection = psycopg2.connect(
        host=os.environ['DB_HOST'], port=int(os.environ.get('DB_PORT', '5432')),
        dbname=os.environ['DB_NAME'], user=os.environ['DB_USER'],
        password=os.environ['DB_PASSWORD'], sslmode=os.environ.get('DB_SSLMODE', 'require'),
        connect_timeout=5,
    )
    try:
        with connection:
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '3s'")
                cursor.execute("SET LOCAL statement_timeout = '15s'")
                if event['action'] == 'apply':
                    cursor.execute(SQL)
                cursor.execute('SELECT slot, is_active FROM homepage_banners ORDER BY slot')
                rows = cursor.fetchall()
                cursor.execute("SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categories' AND column_name = 'icon'")
                icon_type = cursor.fetchone()[0]
        return {'statusCode': 200, 'body': json.dumps({'banners': rows, 'category_icon_type': icon_type})}
    finally:
        connection.close()
