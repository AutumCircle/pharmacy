import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import delivered_orders_by_day
from backend.v1.shared.contract import ContractError


class DeliveredDayOrderTests(unittest.TestCase):
    def _transaction(self, cursor):
        @contextmanager
        def fake_transaction():
            yield cursor
        return patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction)

    def test_day_summary_is_independent_of_paginated_rows(self):
        cursor = Mock()
        cursor.fetchone.return_value = {'total': 3, 'website': 1, 'courier': 2,
            'pharmacy': 0, 'whatsapp': 1, 'instagram': 1, 'phone': 0}
        delivered = datetime(2026, 10, 12, 8, 30, tzinfo=timezone.utc)
        cursor.fetchall.return_value = [
            {'id': 20, 'public_id': 'ord_' + 'a' * 32, 'delivered_at': delivered},
            {'id': 19, 'public_id': 'ord_' + 'b' * 32, 'delivered_at': delivered},
        ]
        with self._transaction(cursor):
            result = delivered_orders_by_day({'date': '2026-10-12', 'limit': '1'})
        self.assertEqual(result['summary']['total'], 3)
        self.assertEqual(result['summary']['website'], 1)
        self.assertEqual(len(result['data']), 1)
        self.assertTrue(result['page']['has_more'])
        self.assertIsNotNone(result['page']['next_cursor'])
        self.assertEqual(cursor.execute.call_args_list[0].args[1][0].utcoffset().total_seconds(), 18000)
        sql = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("h.to_status = 'delivered'", sql)
        self.assertIn('ORDER BY e.delivered_at DESC, e.id DESC', sql)
        self.assertNotIn('UPDATE orders', sql)

    def test_bad_date_and_foreign_cursor_are_rejected(self):
        for query in ({'date': '2026-02-30'}, {'date': '2026-10-12', 'unknown': 'x'},
                      {'date': '2026-10-12', 'cursor': 'invalid'}):
            with self.assertRaises(ContractError):
                delivered_orders_by_day(query)


if __name__ == '__main__':
    unittest.main()
