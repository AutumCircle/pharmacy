import json
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from backend.v1.shared import pharmacy_mirror_admin as mirror
from backend.v1.shared.contract import ContractError
from backend.v1.admin_api.lambda_function import lambda_handler


class MirrorValidationTests(unittest.TestCase):
    def test_name_minimum_and_limit_allowlist(self):
        for query in ({'q': 'a'}, {'q': 'ab', 'limit': '100'}, {'q': 'ab', 'sql': 'x'},
                      {'q': 'ab', 'page': '0'}, {'q': 'ab', 'page': '10000'},
                      {'q': '1 OR 1=1', 'mode': 'id'}, {'q': 'ab\x00'}):
            with self.subTest(query=query), self.assertRaises(ContractError):
                mirror.search_options(query)
        self.assertEqual(mirror.search_options({'q': '1'}), ('1', 'number', 1))
        self.assertEqual(mirror.search_options({'q': '  abc  ', 'page': '2'}), ('abc', 'name', 2))

    def test_literal_wildcards_and_parameterized_injection(self):
        sql, values = mirror.search_predicate("a%_\\' OR true --", 'name')
        self.assertNotIn('OR true', sql)
        self.assertEqual(values, ["%a\\%\\_\\\\' OR true --%"])
        self.assertIn('ESCAPE', sql)
        sql, values = mirror.search_predicate('%_', 'name')
        self.assertIn('strpos(', sql)
        self.assertEqual(values, ['%_'])

    def test_numeric_auto_search_includes_product_and_batch_barcodes(self):
        sql, values = mirror.search_predicate('3000001000013', 'number')
        self.assertEqual(values, ['3000001000013'] * 3)
        self.assertIn('INCOME_SCAN_CODE', sql)
        self.assertIn('UNION', sql)

    def test_stale_and_missing_timestamps(self):
        now = datetime.now(timezone.utc)
        self.assertEqual(mirror.freshness(now - timedelta(seconds=179), now), 'current')
        self.assertEqual(mirror.freshness(now - timedelta(seconds=181), now), 'stale')
        self.assertEqual(mirror.freshness(None, now), 'stale')

    def test_safe_json_is_positive_allowlist(self):
        r = dict(row_key='1',change_id=1,source_generated_at='x',received_at='x',
                 data={'PRODUCT_ID': 1, 'EMPLOY_ID': 3, 'PASSWORD': 'private', 'TOKEN': 'private'})
        self.assertEqual(mirror.safe_row(r, mirror.PRODUCT_FIELDS)['oracle'], {'PRODUCT_ID': 1})

    def test_auth_happens_before_database(self):
        with patch('backend.v1.shared.authorization.os.environ', {}), patch.object(mirror, 'status') as read:
            for path in ('status','products','products/1'):
                r = lambda_handler({'httpMethod':'GET','path':'/v1/admin/pharmacy-mirror/'+path}, None)
                self.assertEqual(r['statusCode'], 403)
            read.assert_not_called()

    def test_authorized_mutations_blocked(self):
        for method in ('POST','PATCH','DELETE','PUT'):
            r = lambda_handler({'httpMethod':method,'path':'/v1/admin/pharmacy-mirror/products/1',
                'requestContext':{'authorizer':{'role':'admin','principalId':'owner'}}}, None)
            self.assertEqual(r['statusCode'], 405)

    def test_agent_or_staff_authorizer_cannot_read(self):
        for role in ('agent_sync','pharmacy_agent','staff'):
            r = lambda_handler({'httpMethod':'GET','path':'/v1/admin/pharmacy-mirror/status',
                'requestContext':{'authorizer':{'role':role,'principalId':'other'}}}, None)
            self.assertEqual(r['statusCode'], 403)


class Cursor:
    def __init__(self, responses): self.responses, self.sql = iter(responses), []
    def execute(self, query, params=()): self.sql.append((query, params))
    def fetchone(self): return next(self.responses)
    def fetchall(self): return next(self.responses)


class MirrorQueryTests(unittest.TestCase):
    def cursor(self, responses):
        cursor = Cursor(responses)
        @contextmanager
        def transaction(): yield cursor
        return cursor, transaction

    def test_pagination_and_aggregate_are_in_database(self):
        cur, transaction = self.cursor([[{'total':30,'product_id':None}]])
        with patch.object(mirror, 'transaction', transaction):
            result = mirror.products({'q':'парацетамол','page':'2'})
        self.assertEqual(result['total'], 30)
        self.assertEqual(cur.sql[-1][1][-2:], (25,25))
        self.assertIn('SUM(', cur.sql[-1][0])
        self.assertIn("s.data->>'PRODUCT_ID'=p.row_key", cur.sql[-1][0])
        self.assertIn("ORDER BY lower(name),row_key", cur.sql[-1][0])
        self.assertIn('transaction_read_only', cur.sql[0][0])
        self.assertEqual(len(cur.sql), 3)  # guard/timeout + single filter/count/page

    def test_status_always_has_twelve_tables(self):
        cur, transaction = self.cursor([{'name':'Аптека №1','last_seen_at':None,'last_batch_at':None}, [], None])
        with patch.object(mirror, 'transaction', transaction): result = mirror.status()
        self.assertEqual(len(result['tables']), 12)
        self.assertEqual(result['freshness'], 'stale')
        self.assertTrue(all(r['row_count']==0 for r in result['tables']))

    def test_detail_uses_product_and_income_join_and_bounded_pages(self):
        product = {'row_key':'1','data':{'PRODUCT_ID':1},'change_id':1,'received_at':'x','source_generated_at':'x',
            'total_stock':'7.5','stock_rows':2,'invalid_stock_rows':0,'stock_received_at':'x','stock_max_change_id':2,'stock_generated_at':'x'}
        product.update({k:None for k in mirror.PRICE_KEYS})
        product['price_basis'] = 'in_stock'
        cur, transaction = self.cursor([product, [], [], {'total':2}, []])
        with patch.object(mirror, 'transaction', transaction): result = mirror.detail('1', {'income_page':'2'})
        self.assertEqual(result['stock']['total_stock'], '7.5')
        self.assertFalse(result['site_comparison']['available'])
        self.assertEqual(cur.sql[-1][1], ('1',25,25))
        self.assertIn("i.data->>'PRODUCT_ID'=s.data->>'PRODUCT_ID'", cur.sql[4][0])
        self.assertEqual(len(cur.sql), 7)
        self.assertTrue(all(not any(word in sql.upper().split() for word in ('INSERT','UPDATE','DELETE')) for sql,_ in cur.sql))

    def test_missing_detail_is_404(self):
        cur, transaction = self.cursor([None])
        with patch.object(mirror, 'transaction', transaction), self.assertRaises(ContractError) as cm: mirror.detail('1', {})
        self.assertEqual(cm.exception.http_status,404)

    def test_income_fields_include_prices_and_sums_but_not_employee_identity(self):
        safe = mirror.safe_row({'row_key':'1','change_id':None,'received_at':'x','source_generated_at':'x',
            'data':{'INCOME_SUM_W_NDS':'100.5','INCOME_PRICE_W_NDS':'50.25','EMPLOY_ID':381,
                    'EXT_PARTNER_ID':563}},mirror.INCOME_FIELDS)
        self.assertEqual(safe['oracle'],{'INCOME_SUM_W_NDS':'100.5','INCOME_PRICE_W_NDS':'50.25'})


if __name__ == '__main__': unittest.main()
