"""IAM-only fixed read verification. Bundle with shared backend modules.

No SQL or data accepted from the caller; no row mutations. No credentials logged.
"""
import json
import time
import psycopg2
from backend.v1.shared import pharmacy_mirror_admin as admin
from backend.v1.shared.database import get_connection


def lambda_handler(event, context):
    result = {'verification': {}}
    for label, call in (
        ('status', lambda: admin.status()),
        ('name', lambda: admin.products({'q':'парацетамол'})),
        ('short_name', lambda: admin.products({'q':'па'})),
        ('id', lambda: admin.products({'q':'440050','mode':'id'})),
        ('barcode', lambda: admin.products({'q':'3600542427456','mode':'barcode'})),
        ('batch_barcode', lambda: admin.products({'q':'3000001000013','mode':'barcode'})),
        ('literal', lambda: admin.products({'q':'%_','mode':'name'})),
        ('detail', lambda: admin.detail('144403',{})),
        ('detail_next', lambda: admin.detail('144403',{'income_page':'2','stock_page':'2'})),
    ):
        start = time.monotonic()
        data = call()
        result['verification'][label] = {'ms':round((time.monotonic()-start)*1000,2),
            'total':data.get('total'), 'items':len(data.get('items',[])),
            'stock':data.get('stock'), 'tables':len(data.get('tables',[]))}
        if label=='detail':result['detail_fixture']=data
        if label=='id':result['products_fixture']=data
        if label=='status':result['status_fixture']=data
    conn=get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('SET LOCAL transaction_read_only=on')
            cur.execute("SET LOCAL statement_timeout='15000ms'")
            cur.execute("""SELECT c.relname,i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
                WHERE c.relname LIKE 'pharmacy_mirror_%'""")
            result['indexes']=cur.fetchall()
            cur.execute("""SELECT count(*) FROM pharmacy_mirror_rows
                WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND row_key<>data->>'PRODUCT_ID'""")
            result['product_key_mismatches']=cur.fetchone()[0]
            queries = {
                'products_full_short': admin.products_sql('па','name',1),
                'products_full_name': admin.products_sql('парацетамол','name',1),
                'products_full_barcode': admin.products_sql('3600542427456','barcode',1),
                'product_id': ("SELECT data FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND row_key=%s", ('440050',)),
                'product_barcode': ("SELECT row_key FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND data->>'SCAN_CODE'=%s", ('3600542427456',)),
                'income_barcode': ("SELECT data->>'PRODUCT_ID' FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_INCOME' AND data->>'INCOME_SCAN_CODE'=%s", ('3000001000013',)),
                'short_name': ("SELECT row_key FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND strpos(lower(data->>'PRODUCT_NAME'),lower(%s))>0 ORDER BY lower(data->>'PRODUCT_NAME'),row_key LIMIT 25", ('па',)),
                'status': ("SELECT table_name,COUNT(*),MAX(change_id),MAX(received_at),MAX(source_generated_at) FROM pharmacy_mirror_rows WHERE pharmacy_id=1 GROUP BY table_name", ()),
                'product_name': ("SELECT row_key FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_PRODUCT' AND lower(data->>'PRODUCT_NAME') LIKE %s ORDER BY lower(data->>'PRODUCT_NAME'),row_key LIMIT 25", ('%парацетамол%',)),
                'stock_product': ("SELECT SUM((data->>'PRODUCT_COUNT_SKLAD')::numeric) FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_SKLAD_STATE' AND data->>'PRODUCT_ID'=%s", ('144403',)),
                'income_product': ("SELECT data FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_INCOME' AND data->>'PRODUCT_ID'=%s ORDER BY row_key LIMIT 25", ('144403',)),
            }
            result['plans']={}
            for name,(sql,params) in queries.items():
                cur.execute('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,params)
                result['plans'][name]=cur.fetchone()[0]
        return json.loads(json.dumps(result,default=str))
    finally: conn.rollback()
