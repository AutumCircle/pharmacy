"""One-off IAM-invoked inspection Lambda. Fixed SELECTs in a read-only transaction.

Never accepts SQL, credentials, row payloads or mutations from the event.
Only sampled catalogue/stock fields and schema metadata leave the Lambda.
"""
import os
import json
import psycopg2
from psycopg2.extras import RealDictCursor

TABLES = ('T_PRODUCT', 'T_SKLAD_STATE', 'T_INCOME', 'T_INCOME_HEAD', 'T_VENDOR',
          'T_COUNTRY', 'T_PRODUCT_MNN', 'T_PRODUCT_GROUP', 'T_PRODUCT_SOSTAV',
          'T_SKLAD', 'T_MEASURE', 'T_PRODUCT_TYPE')


def lambda_handler(event, context):
    conn = psycopg2.connect(host=os.environ['DB_HOST'], dbname=os.environ['DB_NAME'],
                            user=os.environ['DB_USER'], password=os.environ['DB_PASSWORD'],
                            port=os.environ.get('DB_PORT', '5432'), sslmode='require', connect_timeout=5)
    conn.set_session(readonly=True, autocommit=False)
    result = {}
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SET LOCAL statement_timeout='15000ms'")
            for table in TABLES:
                cur.execute('''SELECT row_key, data FROM pharmacy_mirror_rows
                    WHERE pharmacy_id=1 AND table_name=%s ORDER BY row_key LIMIT 3''', (table,))
                rows = [dict(r) for r in cur.fetchall()]
                result[table] = {'keys': sorted(set(k for r in rows for k in r['data'])),
                                 'samples': ([{'row_key':r['row_key'],'data':{k:v for k,v in r['data'].items() if k in ('INCOME_ID','PRODUCT_ID','SKLAD_ID','INCOME_SCAN_CODE','INCOME_DATE_OLD','INCOME_COUNT','INCOME_PRICE_W_NDS')}} for r in rows] if table=='T_INCOME' else rows if table != 'T_INCOME_HEAD' else [])}
            cur.execute('''SELECT table_name, count(*) AS rows, max(change_id) AS max_change_id,
                max(received_at) AS received_at FROM pharmacy_mirror_rows WHERE pharmacy_id=1 GROUP BY table_name''')
            result['counts'] = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT indexname,indexdef FROM pg_indexes WHERE tablename IN ('pharmacy_mirror_rows','medicines')")
            result['indexes'] = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='medicines'")
            result['medicine_columns'] = [dict(r) for r in cur.fetchall()]
            for table in ('T_PRODUCT','T_INCOME','T_PRODUCT_GROUP'):
                cur.execute('''SELECT k,count(*) AS present FROM pharmacy_mirror_rows r,
                    LATERAL jsonb_object_keys(r.data) k WHERE pharmacy_id=1 AND table_name=%s
                    GROUP BY k ORDER BY k''', (table,))
                result[table]['key_counts'] = [dict(r) for r in cur.fetchall()]
            cur.execute('''SELECT p.row_key,p.data FROM pharmacy_mirror_rows p
                WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND
                (data ? 'SCAN_CODE' OR data ? 'PRODUCT_MNN_ID') LIMIT 3''')
            result['product_optional_samples'] = [dict(r) for r in cur.fetchall()]
            cur.execute('''SELECT s.data->>'PRODUCT_ID' AS product_id,
                p.row_key AS product_key,s.data->>'INCOME_ID' AS income_id,
                i.data->>'PRODUCT_ID' AS income_product_id,s.data->>'PRODUCT_COUNT_SKLAD' AS stock,
                i.data->>'INCOME_DATE_OLD' AS income_date_old,
                g.data AS product_group
                FROM pharmacy_mirror_rows s
                LEFT JOIN pharmacy_mirror_rows p ON p.pharmacy_id=1 AND p.table_name='T_PRODUCT'
                    AND p.row_key=s.data->>'PRODUCT_ID'
                LEFT JOIN pharmacy_mirror_rows i ON i.pharmacy_id=1 AND i.table_name='T_INCOME'
                    AND i.row_key=s.data->>'INCOME_ID'
                LEFT JOIN pharmacy_mirror_rows g ON g.pharmacy_id=1 AND g.table_name='T_PRODUCT_GROUP'
                    AND g.row_key=p.data->>'PRODUCT_GROUP_ID'
                WHERE s.pharmacy_id=1 AND s.table_name='T_SKLAD_STATE'
                    AND s.data->>'PRODUCT_COUNT_SKLAD' NOT IN ('0','0.0') LIMIT 5''')
            result['join_samples'] = [dict(r) for r in cur.fetchall()]
            cur.execute('''SELECT source_system, count(*) AS rows,count(source_sku) AS with_sku
                FROM public.medicines GROUP BY source_system''')
            result['site_sources'] = [dict(r) for r in cur.fetchall()]
            cur.execute('SELECT pharmacy_id,last_seen_at,last_batch_at,agent_version FROM pharmacy_sources')
            result['sources'] = [dict(r) for r in cur.fetchall()]
            cur.execute("""SELECT count(*) AS mismatch FROM pharmacy_mirror_rows
                WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND row_key<>data->>'PRODUCT_ID'""")
            result['product_key_evidence'] = dict(cur.fetchone())
            result['plans'] = {}
            queries = {
                'product_id': ("SELECT data FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND row_key=%s", ('440050',)),
                'product_barcode': ("SELECT row_key FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND data->>'SCAN_CODE'=%s", ('3600542427456',)),
                'income_barcode': ("SELECT data->>'PRODUCT_ID' FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_INCOME' AND data->>'INCOME_SCAN_CODE'=%s", ('3000001000013',)),
                'product_name': ("SELECT row_key FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND lower(data->>'PRODUCT_NAME') LIKE %s ORDER BY lower(data->>'PRODUCT_NAME'),row_key LIMIT 25", ('%парацетамол%',)),
                'stock_product': ("SELECT SUM((data->>'PRODUCT_COUNT_SKLAD')::numeric) FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_SKLAD_STATE' AND data->>'PRODUCT_ID'=%s", ('144403',)),
                'income_product': ("SELECT data FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_INCOME' AND data->>'PRODUCT_ID'=%s ORDER BY row_key LIMIT 25", ('144403',)),
            }
            for name,(sql,params) in queries.items():
                cur.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,params)
                result['plans'][name] = cur.fetchone()['QUERY PLAN']
        return json.loads(json.dumps(result,default=str))
    finally:
        conn.rollback()
        conn.close()
