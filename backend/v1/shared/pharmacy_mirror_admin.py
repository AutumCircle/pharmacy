"""Bounded read-only queries over the existing Oracle shadow mirror (pharmacy 1).

Field mapping was checked against production JSONB on 2026-10-22. No writes,
agent credentials, inferred catalogue matches, or client-selected SQL identifiers.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import re

from .contract import ContractError
from .database import transaction
from .pharmacy_mirror import DEFAULT_MIRROR_TABLES

PAGE_SIZE = 25
STALE_SECONDS = 180
PRODUCT_FIELDS = frozenset('CHANGE_ID COUNTRY_ID DEFAULT_NDS FLAG_NO_SKIDKA FLAG_NO_ZAKAZ IS_ANGRO IS_DESINFECT IS_IMMUNO IS_KEEP_RECEPT IS_LIFE IS_NO_DIVISION IS_NO_LIFE IS_NO_RECEPT IS_OVERSIZE IS_PSYCHO IS_SPIRT IS_STRONG MARKETING_ID MEASURE_ID PRODUCT_GROUP_ID PRODUCT_ID PRODUCT_IN_PACK PRODUCT_IN_PACK_SUB PRODUCT_MIN PRODUCT_MNN_ID PRODUCT_NAME PRODUCT_NAME_DIVISION PRODUCT_PRICE PRODUCT_REESTR_PRICE PRODUCT_REESTR_PRICE_DATE PRODUCT_SOSTAV_ID PRODUCT_STELAZ PRODUCT_STORE_PLACE_ID PRODUCT_TEMPERATURA PRODUCT_TYPE_ID SCAN_CODE SYNONYM_ID VENDOR_ID'.split())
STOCK_FIELDS = frozenset('SKLAD_STATE_ID PRODUCT_ID INCOME_ID SKLAD_ID CHANGE_ID PRODUCT_COUNT_SKLAD PRODUCT_COUNT_REZERV PRODUCT_COUNT_SALE PRODUCT_COUNT_INCOME PRODUCT_COUNT_MOVED PRODUCT_COUNT_SHET PRODUCT_COUNT_WAY OUTCOME_PRICE_ONE_W_NDS OUTCOME_PRICE_ONE_NO_NDS OUTCOME_PRICE_TWO_W_NDS OUTCOME_PRICE_TWO_NO_NDS OUTCOME_PRICE_TH_W_NDS OUTCOME_PRICE_TH_NO_NDS OUTCOME_PRICE_FO_W_NDS OUTCOME_PRICE_FO_NO_NDS OUTCOME_NDS_SIZE'.split())
INCOME_FIELDS = frozenset('DATE_SALE_FROM_VENDOR EXTERNAL_OUTCOME_ID EXT_ANALIT_ID EXT_INCOME_COUNT EXT_INCOME_DATE_SALE EXT_INCOME_HEAD_DATE EXT_INCOME_HEAD_ID EXT_INCOME_HEAD_NUMBER EXT_INCOME_ID EXT_INCOME_NDS_SIZE EXT_INCOME_PRICE_NO_NDS EXT_INCOME_PRICE_W_NDS EXT_INCOME_PROVIDER_PROCENT EXT_INCOME_SUM_NDS EXT_INCOME_SUM_NO_NDS EXT_INCOME_SUM_W_NDS EXT_INCOME_VENDOR_PRICE EXT_INCOME_VENDOR_PRICE_NO_NDS EXT_INCOME_VENDOR_PRICE_W_NDS EXT_OPERATION_ID EXT_SKLAD_ID FIRST_INCOME_HEAD_ID FIRST_INCOME_ID INCOME_COUNT INCOME_DATE_MADE INCOME_DATE_OLD INCOME_HEAD_ID INCOME_ID INCOME_NDS_SIZE INCOME_OPRIX_FLAG INCOME_PRICE_NO_NDS INCOME_PRICE_W_NDS INCOME_PROVIDER_PROCENT INCOME_REAL_COUNT INCOME_REAL_PRICE INCOME_REESTR_PRICE INCOME_SCAN_CODE INCOME_SERIA INCOME_SERTIF_NUMBER INCOME_SUM_NDS INCOME_SUM_NO_NDS INCOME_SUM_W_NDS INCOME_VENDOR_PRICE INCOME_VENDOR_PRICE_NO_NDS INCOME_VENDOR_PRICE_W_NDS IS_GIS_MT LABEL_COUNT PRICE_CHECK_FLAG PRODUCT_ID SKLAD_ID'.split())


@contextmanager
def read_cursor():
    with transaction() as cur:
        # get_connection can already have run SELECT 1; SET LOCAL still applies
        # before any data read. Never affects the next request's transaction.
        cur.execute('SET LOCAL transaction_read_only = on')
        cur.execute("SET LOCAL statement_timeout = '8000ms'")
        yield cur


def invalid(message):
    return ContractError('VALIDATION_ERROR', message)


def page_number(value):
    text = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,3}', text):
        raise invalid('page must be between 1 and 9999')
    return int(text)


def product_key(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9]{1,18}', value):
        raise invalid('Invalid PRODUCT_ID')
    return value


def search_options(query):
    if set(query) - {'q', 'mode', 'page', 'limit'}:
        raise invalid('Unknown query parameter')
    q = query.get('q', '')
    mode = query.get('mode', 'auto')
    if not isinstance(q, str) or len(q) > 120 or any(ord(c) < 32 for c in q):
        raise invalid('Invalid search query')
    q = q.strip()
    if mode not in {'auto', 'name', 'id', 'barcode'} or str(query.get('limit', PAGE_SIZE)) != '25':
        raise invalid('Invalid search mode or limit (25 required)')
    if mode == 'auto':
        mode = 'number' if re.fullmatch(r'[0-9]+', q) else 'name'
    if mode == 'name' and len(q) < 2:
        raise invalid('Enter at least two characters')
    if mode in {'id', 'number'}:
        product_key(q)
    if mode == 'barcode' and not 2 <= len(q) <= 80:
        raise invalid('Invalid barcode')
    return q, mode, page_number(query.get('page', '1'))


def escape_like(value):
    return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')


def search_predicate(q, mode):
    if mode == 'name':
        # pg_trgm cannot narrow a pattern with no three consecutive word
        # characters (e.g. two-letter searches or literal %_). Its full GIN
        # scan took ~8s in production. A bounded SQL sequential projection is
        # faster here; strpos treats every search character literally.
        if not re.search(r'[^\W_]{3}', q, re.UNICODE):
            return "strpos(lower(p.data->>'PRODUCT_NAME'), lower(%s)) > 0", [q]
        return "lower(p.data->>'PRODUCT_NAME') LIKE lower(%s) ESCAPE E'\\\\'", ['%' + escape_like(q) + '%']
    if mode == 'id':
        return 'p.row_key=%s', [q]
    barcode = """p.row_key IN (
        SELECT row_key FROM pharmacy_mirror_rows WHERE pharmacy_id=1 AND table_name='T_PRODUCT'
            AND data->>'SCAN_CODE'=%s
        UNION SELECT data->>'PRODUCT_ID' FROM pharmacy_mirror_rows
            WHERE pharmacy_id=1 AND table_name='T_INCOME' AND data->>'INCOME_SCAN_CODE'=%s
    )"""
    return ('(p.row_key=%s OR ' + barcode + ')', [q, q, q]) if mode == 'number' else (barcode, [q, q])


def freshness(value, now=None):
    now = now or datetime.now(timezone.utc)
    return 'current' if value and (now - value).total_seconds() <= STALE_SECONDS else 'stale'


def safe_row(row, fields):
    return {**{k: row[k] for k in ('row_key', 'change_id', 'source_generated_at', 'received_at')},
            'oracle': {k: v for k, v in row['data'].items() if k in fields}}


def status():
    with read_cursor() as cur:
        cur.execute('SELECT name,last_seen_at,last_batch_at FROM pharmacy_sources WHERE pharmacy_id=1')
        source = cur.fetchone()
        cur.execute("""SELECT table_name,COUNT(*) AS row_count,MAX(change_id) AS max_change_id,
            MAX(received_at) AS last_received_at,MAX(source_generated_at) AS source_generated_at
            FROM pharmacy_mirror_rows WHERE pharmacy_id=1 GROUP BY table_name""")
        by_name = {r['table_name']: dict(r) for r in cur.fetchall()}
        cur.execute('''SELECT batch_id::text,table_name,upserted_count,deleted_count,received_at
            FROM pharmacy_mirror_batches WHERE pharmacy_id=1 ORDER BY received_at DESC,batch_id DESC LIMIT 1''')
        batch = cur.fetchone()
    source = dict(source or {})
    tables = []
    for name in sorted(DEFAULT_MIRROR_TABLES):
        row = by_name.get(name, {'table_name': name, 'row_count': 0, 'max_change_id': None,
                               'last_received_at': None, 'source_generated_at': None})
        tables.append({**row, 'freshness': freshness(row['last_received_at'])})
    return {'pharmacy_id': 1, 'name': source.get('name', 'Аптека №1'), **source,
            'freshness': freshness(source.get('last_seen_at')), 'stale_seconds': STALE_SECONDS,
            'last_batch': dict(batch) if batch else None, 'tables': tables,
            'checked_at': datetime.now(timezone.utc)}


# All identifiers here are server-owned constants, never request values.
def decimal_sql(alias, field):
    value = f"{alias}.data->>'{field}'"
    return f"CASE WHEN {value} ~ '^-?[0-9]{{1,18}}([.][0-9]{{1,12}})?$' THEN ({value})::numeric END"


STOCK_NUMBER = decimal_sql('s', 'PRODUCT_COUNT_SKLAD')
SALE_NUMBER = decimal_sql('s', 'OUTCOME_PRICE_ONE_W_NDS')
PURCHASE_NUMBER = decimal_sql('i', 'INCOME_PRICE_W_NDS')
PRICE_KEYS = ('sale_price_min','sale_price_max','purchase_price_min','purchase_price_max',
              'sale_value','purchase_value','price_basis')
STOCK_KEYS = ('total_stock','stock_rows','invalid_stock_rows','stock_received_at',
              'stock_max_change_id','stock_generated_at') + PRICE_KEYS
AGGREGATE = f"""SELECT SUM(qty)::text AS total_stock,COUNT(*) AS stock_rows,
    COUNT(*) FILTER (WHERE qty IS NULL) AS invalid_stock_rows,
    MAX(received_at) AS stock_received_at,MAX(change_id) AS stock_max_change_id,
    MAX(source_generated_at) AS stock_generated_at,
    CASE WHEN COUNT(*) FILTER (WHERE qty>0)>0 THEN 'in_stock'
         WHEN COUNT(*)>0 THEN 'historical' ELSE 'none' END AS price_basis,
    (CASE WHEN COUNT(*) FILTER (WHERE qty>0)>0 THEN MIN(sale_price) FILTER (WHERE qty>0)
         ELSE MIN(sale_price) END)::text AS sale_price_min,
    (CASE WHEN COUNT(*) FILTER (WHERE qty>0)>0 THEN MAX(sale_price) FILTER (WHERE qty>0)
         ELSE MAX(sale_price) END)::text AS sale_price_max,
    (CASE WHEN COUNT(*) FILTER (WHERE qty>0)>0 THEN MIN(purchase_price) FILTER (WHERE qty>0)
         ELSE MIN(purchase_price) END)::text AS purchase_price_min,
    (CASE WHEN COUNT(*) FILTER (WHERE qty>0)>0 THEN MAX(purchase_price) FILTER (WHERE qty>0)
         ELSE MAX(purchase_price) END)::text AS purchase_price_max,
    CASE WHEN COUNT(*)=0 OR COUNT(*) FILTER (WHERE qty IS NULL OR (qty<>0 AND sale_price IS NULL))>0
         THEN NULL ELSE COALESCE(SUM(qty*sale_price),0)::text END AS sale_value,
    CASE WHEN COUNT(*)=0 OR COUNT(*) FILTER (WHERE qty IS NULL OR (qty<>0 AND purchase_price IS NULL))>0
         THEN NULL ELSE COALESCE(SUM(qty*purchase_price),0)::text END AS purchase_value
    FROM (
        SELECT {STOCK_NUMBER} AS qty,{SALE_NUMBER} AS sale_price,
            {PURCHASE_NUMBER} AS purchase_price,s.received_at,s.change_id,s.source_generated_at
        FROM pharmacy_mirror_rows s
        LEFT JOIN pharmacy_mirror_rows i ON i.pharmacy_id=1 AND i.table_name='T_INCOME'
            AND i.row_key=s.data->>'INCOME_ID' AND i.data->>'PRODUCT_ID'=s.data->>'PRODUCT_ID'
        WHERE s.pharmacy_id=1 AND s.table_name='T_SKLAD_STATE' AND s.data->>'PRODUCT_ID'=p.row_key
    ) stock_prices"""


def products_sql(q, mode, page):
    where, params = search_predicate(q, mode)
    sql = """WITH matched AS MATERIALIZED (
        SELECT p.row_key,p.data->>'PRODUCT_NAME' AS name,p.data->>'SCAN_CODE' AS barcode,
            p.data->>'VENDOR_ID' AS vendor_id,p.change_id,p.received_at,p.source_generated_at
        FROM pharmacy_mirror_rows p WHERE p.pharmacy_id=1 AND p.table_name='T_PRODUCT' AND """ + where + """
        ), page AS (
            SELECT * FROM matched ORDER BY lower(name),row_key LIMIT %s OFFSET %s
        ), items AS (
            SELECT p.row_key AS product_id,p.name,p.barcode,v.data->>'VENDOR_NAME' AS vendor,
                p.received_at,p.source_generated_at,p.change_id,a.* FROM page p
            LEFT JOIN pharmacy_mirror_rows v ON v.pharmacy_id=1 AND v.table_name='T_VENDOR'
                AND v.row_key=p.vendor_id
            LEFT JOIN LATERAL (""" + AGGREGATE + """) a ON TRUE
        ), totals AS (SELECT COUNT(*) AS total FROM matched)
        SELECT totals.total,item.* FROM totals LEFT JOIN items item ON TRUE
        ORDER BY lower(item.name),item.product_id"""
    return sql, tuple(params + [PAGE_SIZE, (page - 1) * PAGE_SIZE])


def products(query):
    q, mode, page = search_options(query)
    sql, params = products_sql(q, mode, page)
    with read_cursor() as cur:
        cur.execute(sql, params)
        result = [dict(r) for r in cur.fetchall()]
    # LEFT JOIN retains the exact total even for an empty/out-of-range page.
    total = result[0]['total']
    rows = [{k:v for k,v in r.items() if k != 'total'} for r in result if r['product_id'] is not None]
    return {'items': rows, 'total': total, 'page': page, 'limit': PAGE_SIZE, 'mode': mode}


def detail(key, query):
    key = product_key(key)
    if set(query) - {'stock_page', 'income_page'}:
        raise invalid('Unknown query parameter')
    stock_page, income_page = (page_number(query.get(k, '1')) for k in ('stock_page', 'income_page'))
    with read_cursor() as cur:
        cur.execute(f"""SELECT p.*,a.* FROM pharmacy_mirror_rows p
            LEFT JOIN LATERAL ({AGGREGATE}) a ON TRUE
            WHERE p.pharmacy_id=1 AND p.table_name='T_PRODUCT' AND p.row_key=%s""", (key,))
        product = cur.fetchone()
        if not product:
            raise ContractError('NOT_FOUND', 'Product was not found', http_status=404)
        dictionaries = {}
        # Fixed small dictionary lookup in ONE query; primary-key index, no query per dictionary.
        specs = [('vendor','T_VENDOR','VENDOR_ID','VENDOR_NAME'), ('country','T_COUNTRY','COUNTRY_ID','COUNTRY_NAME'),
                 ('mnn','T_PRODUCT_MNN','PRODUCT_MNN_ID','PRODUCT_MNN_NAME'),
                 ('group','T_PRODUCT_GROUP','PRODUCT_GROUP_ID','PRODUCT_GROUP_NAME'),
                 ('measure','T_MEASURE','MEASURE_ID','MEASURE_NAME'),
                 ('type','T_PRODUCT_TYPE','PRODUCT_TYPE_ID','PRODUCT_TYPE_NAME')]
        cur.execute('''SELECT table_name,row_key,data FROM pharmacy_mirror_rows WHERE pharmacy_id=1
            AND (table_name,row_key) IN (''' + ','.join(['(%s,%s)'] * len(specs)) + ')',
            tuple(v for _, table, id_field, _ in specs for v in (table, str(product['data'].get(id_field, '')))))
        lookup = {(r['table_name'], r['row_key']): r['data'] for r in cur.fetchall()}
        for label, table, id_field, name_field in specs:
            value = product['data'].get(id_field)
            dictionaries[label] = {'id': value, 'name': lookup.get((table, str(value)), {}).get(name_field)}
        cur.execute('''SELECT s.*,w.data->>'SKLAD_NAME' AS warehouse_name,
            i.data->>'PRODUCT_ID' AS income_product_id,i.data->>'INCOME_DATE_OLD' AS income_date_old,
            i.data->>'INCOME_PRICE_W_NDS' AS purchase_price,i.data->>'INCOME_SCAN_CODE' AS income_barcode
            FROM pharmacy_mirror_rows s
            LEFT JOIN pharmacy_mirror_rows w ON w.pharmacy_id=1 AND w.table_name='T_SKLAD' AND w.row_key=s.data->>'SKLAD_ID'
            LEFT JOIN pharmacy_mirror_rows i ON i.pharmacy_id=1 AND i.table_name='T_INCOME'
                AND i.row_key=s.data->>'INCOME_ID' AND i.data->>'PRODUCT_ID'=s.data->>'PRODUCT_ID'
            WHERE s.pharmacy_id=1 AND s.table_name='T_SKLAD_STATE' AND s.data->>'PRODUCT_ID'=%s
            ORDER BY s.row_key LIMIT %s OFFSET %s''', (key, PAGE_SIZE, (stock_page-1)*PAGE_SIZE))
        stocks = [{**safe_row(r, STOCK_FIELDS), 'warehouse_name': r['warehouse_name'],
                   'income_product_id': r['income_product_id'], 'income_date_old': r['income_date_old'],
                   'purchase_price': r['purchase_price'], 'income_barcode': r['income_barcode']} for r in cur.fetchall()]
        cur.execute("""SELECT COUNT(*) AS total FROM pharmacy_mirror_rows WHERE pharmacy_id=1
            AND table_name='T_INCOME' AND data->>'PRODUCT_ID'=%s""", (key,))
        income_total = cur.fetchone()['total']
        cur.execute("""SELECT row_key,data,change_id,source_generated_at,received_at FROM pharmacy_mirror_rows
            WHERE pharmacy_id=1 AND table_name='T_INCOME' AND data->>'PRODUCT_ID'=%s
            ORDER BY row_key LIMIT %s OFFSET %s""", (key, PAGE_SIZE, (income_page-1)*PAGE_SIZE))
        incomes = [safe_row(r, INCOME_FIELDS) for r in cur.fetchall()]
    return {'product': safe_row(product, PRODUCT_FIELDS), 'dictionaries': dictionaries,
            'checked_at': datetime.now(timezone.utc),
            'stock': {k: product[k] for k in STOCK_KEYS},
            'stocks': {'items': stocks, 'total': product['stock_rows'], 'page': stock_page, 'limit': PAGE_SIZE},
            'incomes': {'items': incomes, 'total': income_total, 'page': income_page, 'limit': PAGE_SIZE},
            'site_comparison': {'available': False, 'reason': 'В каталоге сайта нет подтверждённого source ID или штрихкода. Автоматическое сопоставление не выполняется.'}}
