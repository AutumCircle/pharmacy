import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import list_courier_orders, update_courier_order_status
from backend.v1.shared.contract import ContractError


class CourierOrderTests(unittest.TestCase):
    def test_list_is_paginated_and_omits_prices(self):
        cursor = Mock()
        cursor.fetchall.return_value = [{
            'id': 7, 'public_id': 'ord_' + 'a' * 32, 'order_reference': '3456-007',
            'customer_name': 'Клиент', 'phone': '+992917123456', 'address': 'Айни 29',
            'landmark': 'школа', 'notes': None, 'order_source': 'phone',
            'status': 'pending', 'created_at': datetime(2026, 10, 2, tzinfo=timezone.utc),
            'pharmacy_id': 2,
        }]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            result = list_courier_orders({'status': 'pending', 'limit': '20'})
        self.assertEqual(result['data'][0]['pharmacy_id'], 2)
        self.assertNotIn('id', result['data'][0])
        self.assertNotIn('order_total', result['data'][0])
        sql, args = cursor.execute.call_args.args
        self.assertIn('ORDER BY o.created_at DESC, o.id DESC LIMIT %s', sql)
        self.assertIn("o.status IN ('pending', 'confirmed', 'delivering')", sql)
        self.assertNotIn('selling_unit_price', sql)
        self.assertEqual(args, ('pending', 21))

    def test_terminal_orders_cannot_be_requested(self):
        for status in ('delivered', 'cancelled'):
            with self.assertRaises(ContractError):
                list_courier_orders({'status': status})

    def test_status_change_checks_current_value_and_audits(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [{'id': 7, 'status': 'confirmed'},
                                       {'created_at': datetime(2026, 10, 2, tzinfo=timezone.utc)}]

        @contextmanager
        def fake_transaction():
            yield cursor

        order_id = 'ord_' + 'a' * 32
        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            result = update_courier_order_status(order_id, {
                'status': 'delivering', 'expected_current_status': 'confirmed',
            }, 'req_test')
        self.assertEqual(result['status'], 'delivering')
        statements = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn('FOR UPDATE', statements)
        self.assertIn('order_status_history', statements)
        self.assertIn('courier.order.status_changed', str(cursor.execute.call_args_list))

    def test_stale_status_cannot_update(self):
        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'status': 'delivered'}

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            with self.assertRaises(ContractError) as raised:
                update_courier_order_status('ord_' + 'a' * 32, {
                    'status': 'delivering', 'expected_current_status': 'confirmed',
                }, 'req_test')
        self.assertEqual(raised.exception.http_status, 409)
        self.assertEqual(cursor.execute.call_count, 1)


if __name__ == '__main__':
    unittest.main()
