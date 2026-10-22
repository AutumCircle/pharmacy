import json
import time
from decimal import Decimal
from psycopg2.extras import Json
from backend.v1.shared import pharmacy_mirror_admin as admin


def synthetic(rows):
    values=','.join(['(1,%s,%s,%s::jsonb,CURRENT_TIMESTAMP,1::bigint,CURRENT_TIMESTAMP)']*len(rows))
    sql='WITH pharmacy_mirror_rows(pharmacy_id,table_name,row_key,data,received_at,change_id,source_generated_at) AS (VALUES '+values+') SELECT a.* FROM (VALUES (\'1\')) p(row_key) LEFT JOIN LATERAL ('+admin.AGGREGATE+') a ON TRUE'
    with admin.read_cursor() as cur:
        cur.execute(sql,tuple(v for table,key,data in rows for v in (table,key,Json(data))))
        return dict(cur.fetchone())


def lambda_handler(event,context):
    rows=[('T_SKLAD_STATE','s1',{'PRODUCT_ID':1,'INCOME_ID':10,'PRODUCT_COUNT_SKLAD':2,'OUTCOME_PRICE_ONE_W_NDS':10}),
          ('T_SKLAD_STATE','s2',{'PRODUCT_ID':1,'INCOME_ID':11,'PRODUCT_COUNT_SKLAD':'0.5','OUTCOME_PRICE_ONE_W_NDS':12}),
          ('T_SKLAD_STATE','s3',{'PRODUCT_ID':1,'INCOME_ID':12,'PRODUCT_COUNT_SKLAD':0,'OUTCOME_PRICE_ONE_W_NDS':999}),
          ('T_INCOME','10',{'PRODUCT_ID':1,'INCOME_PRICE_W_NDS':6}),
          ('T_INCOME','11',{'PRODUCT_ID':1,'INCOME_PRICE_W_NDS':7}),
          ('T_INCOME','12',{'PRODUCT_ID':1,'INCOME_PRICE_W_NDS':888})]
    r=synthetic(rows)
    assert Decimal(r['total_stock'])==Decimal('2.5')
    assert Decimal(r['sale_value'])==Decimal('26')
    assert Decimal(r['purchase_value'])==Decimal('15.5')
    assert Decimal(r['sale_price_min'])==10 and Decimal(r['sale_price_max'])==12
    assert r['price_basis']=='in_stock'
    bad=[('T_SKLAD_STATE','s1',{'PRODUCT_ID':1,'INCOME_ID':10,'PRODUCT_COUNT_SKLAD':2,'OUTCOME_PRICE_ONE_W_NDS':10}),
         ('T_INCOME','10',{'PRODUCT_ID':2,'INCOME_PRICE_W_NDS':99})]
    r=synthetic(bad)
    assert r['purchase_value'] is None and r['purchase_price_min'] is None
    zero=[('T_SKLAD_STATE','s1',{'PRODUCT_ID':1,'INCOME_ID':10,'PRODUCT_COUNT_SKLAD':0,'OUTCOME_PRICE_ONE_W_NDS':10})]
    r=synthetic(zero)
    assert r['price_basis']=='historical' and Decimal(r['sale_value'])==0
    invalid=[('T_SKLAD_STATE','s1',{'PRODUCT_ID':1,'PRODUCT_COUNT_SKLAD':'bad','OUTCOME_PRICE_ONE_W_NDS':10})]
    r=synthetic(invalid)
    assert r['invalid_stock_rows']==1 and r['sale_value'] is None
    result={'sql_scenarios':'PASS: decimals, range, zero history, wrong-product income, missing price, malformed qty','requests':{}}
    for label,call in [('id',lambda:admin.products({'q':'440050','mode':'id'})),('name',lambda:admin.products({'q':'парацетамол'})),('detail',lambda:admin.detail('144403',{}))]:
        start=time.monotonic();data=call();result[label]=data;result['requests'][label]={'ms':round(1000*(time.monotonic()-start),2)}
    with admin.read_cursor() as cur:
        sql,params=admin.products_sql('парацетамол','name',1)
        cur.execute('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,params)
        result['explain']=cur.fetchone()['QUERY PLAN']
    return json.loads(json.dumps(result,default=str))
