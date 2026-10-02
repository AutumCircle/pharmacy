import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from decimal import Decimal

from backend.v1.admin_api.lambda_function import (
    list_courier_orders, update_courier_order_status, update_order_delivery, update_order_item_price,
)
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

    def _tx(self, cursor):
        @contextmanager
        def fake_transaction():
            yield cursor
        return patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction)

    def test_courier_sets_only_own_delivery_amount(self):
        cursor = Mock()
        cursor.fetchone.return_value = {
            'id': 7, 'status': 'delivering',
            'delivery_courier_amount': Decimal('0'), 'delivery_owner_amount': Decimal('10.00'),
        }
        with self._tx(cursor):
            result = update_order_delivery('ord_' + 'a' * 32, {'delivery_courier_amount': '20'},
                                           'staff:3', 'req', courier=True)
        update_args = cursor.execute.call_args_list[1].args[1]
        self.assertEqual(update_args[:2], (Decimal('20.00'), Decimal('10.00')))
        self.assertNotIn('delivery_fee', result)
        self.assertNotIn('delivery_owner_amount', result)

    def test_courier_cannot_send_owner_amount(self):
        with self.assertRaises(ContractError):
            update_order_delivery('ord_' + 'a' * 32, {'delivery_courier_amount': 5, 'delivery_owner_amount': 5},
                                  'staff:3', 'req', courier=True)

    def test_courier_cannot_edit_cancelled_order(self):
        cursor = Mock()
        cursor.fetchone.return_value = {
            'id': 7, 'status': 'cancelled',
            'delivery_courier_amount': Decimal('0'), 'delivery_owner_amount': Decimal('0'),
        }
        with self._tx(cursor), self.assertRaises(ContractError) as raised:
            update_order_delivery('ord_' + 'a' * 32, {'delivery_courier_amount': 5}, 'staff:3', 'req', courier=True)
        self.assertEqual(raised.exception.http_status, 409)

    def test_admin_splits_delivery_fee(self):
        cursor = Mock()
        cursor.fetchone.return_value = {
            'id': 7, 'status': 'delivered',
            'delivery_courier_amount': Decimal('0'), 'delivery_owner_amount': Decimal('0'),
        }
        with self._tx(cursor):
            result = update_order_delivery('ord_' + 'a' * 32,
                                           {'delivery_courier_amount': 12, 'delivery_owner_amount': '8.50'},
                                           'admin', 'req')
        self.assertEqual(result['delivery_fee'], Decimal('20.50'))

    def test_delivery_amount_validation(self):
        for bad in (-1, 'abc', True, 2000000, 'NaN'):
            with self.assertRaises(ContractError):
                update_order_delivery('ord_' + 'a' * 32,
                                      {'delivery_courier_amount': bad, 'delivery_owner_amount': 0}, 'admin', 'req')

    def test_admin_can_edit_base_price_alone(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'reference': '3456-007'},
            {'id': 3, 'medicine_name': 'X', 'selling_unit_price': Decimal('30.00'),
             'base_unit_price': Decimal('20.00'), 'quantity': 2},
            {'items_subtotal': Decimal('60.00')},
        ]
        with self._tx(cursor):
            result = update_order_item_price('ord_' + 'a' * 32, {'order_item_id': 3, 'base_unit_price': '25'},
                                             'admin', 'req')
        self.assertEqual(result['base_unit_price'], Decimal('25.00'))
        self.assertEqual(result['selling_unit_price'], Decimal('30.00'))
        self.assertEqual(result['line_total'], Decimal('60.00'))

    def test_item_price_requires_a_price(self):
        with self.assertRaises(ContractError):
            update_order_item_price('ord_' + 'a' * 32, {'order_item_id': 3}, 'admin', 'req')


if __name__ == '__main__':
    unittest.main()
