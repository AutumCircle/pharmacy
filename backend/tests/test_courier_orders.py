import json
import sqlite3
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from decimal import Decimal

from backend.v1.admin_api.lambda_function import (
    add_courier_order_items, add_manual_order_items, courier_earnings, list_courier_orders, update_courier_order_status,
    get_courier_order, update_courier_order_checklist, update_courier_order_customer, update_courier_order_item,
    update_order_delivery, update_order_item_price,
    COURIER_CHECKLIST_MANUAL_STEPS, COURIER_CHECKLIST_MARKER, _COURIER_CHECKLIST_STEP_SQL, _COURIER_ORDER_SELECT,
    _checklist_steps,
)
from backend.v1.shared.contract import ContractError


class CourierOrderTests(unittest.TestCase):
    def test_manual_item_adds_to_delivered_order_without_catalog_or_delivery_mutation(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'delivered', 'items_subtotal': Decimal('10.00'), 'created_by_staff_account_id': 3},
            {'id': 99}, {'total': Decimal('35.00')},
        ]
        with self._tx(cursor):
            result = add_manual_order_items('ord_' + 'a' * 32,
                {'manual_items': [{'medicine_name': 'Витамин X', 'price': '12.50', 'quantity': 2}]},
                '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req', 'staff:3')
        self.assertEqual(result['items_subtotal'], '35.00')
        sql = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn('jsonb_to_recordset', sql)
        self.assertIn('SELECT %s, NULL, item.medicine_name', sql)
        self.assertNotIn('UPDATE medicines', sql)
        self.assertNotIn('delivery_courier_amount', sql)
        self.assertIn('order.manual_items_added', str(cursor.execute.call_args_list))

    def test_manual_item_rejects_cancelled_order_before_mutation(self):
        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'status': 'cancelled', 'items_subtotal': Decimal('0')}
        with self._tx(cursor), self.assertRaises(ContractError):
            add_manual_order_items('ord_' + 'a' * 32,
                {'manual_items': [{'medicine_name': 'Витамин X', 'price': '12.50', 'quantity': 1}]},
                '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req', 'admin')
        self.assertEqual(cursor.execute.call_count, 1)

    def test_add_items_uses_catalog_prices_and_one_transaction(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'confirmed', 'items_subtotal': Decimal('10'),
             'created_by_staff_account_id': None, 'pharmacy_id': 1},
            {'id': 99}, {'total': Decimal('35.00')},
        ]
        cursor.fetchall.side_effect = [
            [{'id': 44, 'name': 'NOW D3', 'price': Decimal('10'), 'selling_unit_price': 12, 'in_stock': True},
             {'id': 55, 'name': 'Old', 'price': Decimal('5'), 'selling_unit_price': 6, 'in_stock': True}],
            [{'id': 81, 'medicine_id': 55, 'quantity': 2}],
        ]
        with self._tx(cursor):
            result = add_courier_order_items('ord_' + 'a' * 32, {'items': [
                {'medicine_id': 44, 'quantity': 1}, {'medicine_id': 55, 'quantity': 2},
            ]}, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req_test', 'admin:owner')
        self.assertEqual((result['added'], result['quantity_increased']), (1, 1))
        self.assertEqual(result['items_subtotal'], '35.00')
        sql = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn('jsonb_to_recordset', sql)
        self.assertIn('UPDATE orders SET items_subtotal', sql)
        self.assertIn('admin.order.items_added', str(cursor.execute.call_args_list))

    def test_courier_cannot_change_website_order_items(self):
        for function, payload in ((add_courier_order_items, {'items': [{'medicine_id': 44, 'quantity': 1}]}),
                                  (add_manual_order_items, {'manual_items': [
                                      {'medicine_name': 'Витамин X', 'price': '12.50', 'quantity': 1}]})):
            cursor = Mock()
            cursor.fetchone.return_value = {'id': 7, 'status': 'pending', 'pharmacy_id': 1,
                'created_by_staff_account_id': None, 'items_subtotal': Decimal('0')}
            args = ('ord_' + 'a' * 32, payload, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req')
            with self._tx(cursor), self.assertRaises(ContractError) as raised:
                function(*args, 'staff:3') if function is add_manual_order_items else function(*args)
            self.assertEqual(raised.exception.http_status, 403)
            self.assertEqual(cursor.execute.call_count, 1)

    def test_add_items_rejects_cancelled_order(self):
        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'status': 'cancelled', 'pharmacy_id': 1,
            'created_by_staff_account_id': 3, 'items_subtotal': Decimal('0')}
        with self._tx(cursor), self.assertRaises(ContractError):
            add_courier_order_items('ord_' + 'a' * 32,
                {'items': [{'medicine_id': 44, 'quantity': 1}]},
                '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req_test')
        self.assertEqual(cursor.execute.call_count, 1)

    def test_pharmacy_two_order_uses_shared_catalogue_and_courier_client_price(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'pending', 'items_subtotal': Decimal('0'),
             'created_by_staff_account_id': 3, 'pharmacy_id': 2},
            {'id': 99}, {'total': Decimal('31.00')},
        ]
        cursor.fetchall.side_effect = [
            [{'id': 44, 'name': 'NOW D3', 'price': Decimal('10'), 'selling_unit_price': 12, 'in_stock': True},
             {'id': 55, 'name': 'Old', 'price': Decimal('5'), 'selling_unit_price': 6, 'in_stock': True}],
            [{'id': 81, 'medicine_id': 55, 'quantity': Decimal('1')}],
        ]
        with self._tx(cursor):
            result = add_courier_order_items('ord_' + 'a' * 32, {'items': [
                {'medicine_id': 44, 'quantity': 2, 'unit_price': '11,50'},
                {'medicine_id': 55, 'quantity': 1, 'unit_price': '4'},
            ]}, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req_test')
        self.assertEqual((result['added'], result['quantity_increased']), (1, 1))
        calls = cursor.execute.call_args_list
        insert = next(call for call in calls if 'INSERT INTO order_items' in call.args[0])
        inserted = json.loads(insert.args[1][1])[0]
        self.assertEqual((inserted['base_unit_price'], inserted['selling_unit_price'], inserted['line_total']),
                         ('10', '11.50', '23.00'))
        update = next(call for call in calls if 'UPDATE order_items oi' in call.args[0])
        self.assertIn('COALESCE(data.unit_price', update.args[0])
        self.assertEqual(json.loads(update.args[1][0])[0]['unit_price'], '4.00')

    def test_add_items_rejects_invalid_client_price_before_database(self):
        for price in ('0', '-1', 'abc', '1.234', True):
            cursor = Mock()
            with self._tx(cursor), self.assertRaises(ContractError):
                add_courier_order_items('ord_' + 'a' * 32,
                    {'items': [{'medicine_id': 44, 'quantity': 1, 'unit_price': price}]},
                    '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req_test')
            cursor.execute.assert_not_called()

    def test_add_items_to_delivered_order_preserves_delivery_amount(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'delivered', 'items_subtotal': Decimal('10'),
             'created_by_staff_account_id': None, 'pharmacy_id': 1},
            {'id': 99}, {'total': Decimal('22.00')},
        ]
        cursor.fetchall.side_effect = [
            [{'id': 44, 'name': 'NOW D3', 'price': Decimal('10'),
              'selling_unit_price': Decimal('12'), 'in_stock': True}],
            [],
        ]
        with self._tx(cursor):
            result = add_courier_order_items('ord_' + 'a' * 32,
                {'items': [{'medicine_id': 44, 'quantity': 1}]},
                '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req_test', 'admin:owner')
        self.assertEqual(result['items_subtotal'], '22.00')
        sql = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertNotIn('SET delivery_courier_amount', sql)
        self.assertIn('admin.order.items_added', str(cursor.execute.call_args_list))

    def test_add_items_repeated_request_returns_saved_result_without_new_items(self):
        import hashlib
        import json
        order_id = 'ord_' + 'a' * 32
        payload = {'items': [{'medicine_id': 44, 'quantity': 1}]}
        normalized = [{'medicine_id': 44, 'quantity': '1.00'}]
        request_hash = hashlib.sha256(json.dumps({'order_id': order_id, 'items': normalized},
            sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        saved = {'order_id': order_id, 'added': 1, 'quantity_increased': 0,
                 'items_subtotal': '12.00', 'currency': 'TJS'}
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'pending', 'pharmacy_id': 1, 'created_by_staff_account_id': 3,
             'items_subtotal': Decimal('12.00')},
            None,
            {'request_hash': request_hash, 'response_body': saved},
        ]
        with self._tx(cursor):
            result = add_courier_order_items(order_id, payload,
                '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req_test')
        self.assertEqual(result, saved)
        self.assertEqual(cursor.execute.call_count, 3)

    def test_list_is_paginated_and_shows_client_prices(self):
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
        sql, args = cursor.execute.call_args.args
        self.assertIn('ORDER BY o.created_at DESC, o.id DESC LIMIT %s', sql)
        self.assertIn("o.status <> 'cancelled'", sql)
        self.assertIn("'selling_unit_price'", sql)
        self.assertIn('o.order_total', sql)
        self.assertNotIn('delivery_owner_amount', sql)
        self.assertEqual(args, ('pending', 21))

    def test_delivered_orders_are_visible_but_cancelled_filter_is_rejected(self):
        cursor = Mock()
        cursor.fetchall.return_value = []
        with self._tx(cursor):
            list_courier_orders({'status': 'delivered'})
        self.assertIn("o.status = %s", cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], ('delivered', 21))
        with self.assertRaises(ContractError):
            list_courier_orders({'status': 'cancelled'})

    def test_courier_earnings_are_grouped_by_delivery_day(self):
        cursor = Mock()
        cursor.fetchone.return_value = {
            'total': Decimal('75.00'), 'today': Decimal('20.00'), 'yesterday': Decimal('15.00'),
        }
        from datetime import date
        cursor.fetchall.return_value = [
            {'date': date(2026, 10, 4), 'orders_count': 2, 'amount': Decimal('20.00')},
            {'date': date(2026, 10, 3), 'orders_count': 1, 'amount': Decimal('15.00')},
        ]
        with self._tx(cursor):
            result = courier_earnings({'limit': '31'})
        self.assertEqual(result['today'], Decimal('20.00'))
        self.assertEqual(result['daily'][0]['orders_count'], 2)
        statements = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("o.status = 'delivered'", statements)
        self.assertIn("Asia/Dushanbe", statements)
        self.assertIn('created_by_staff_account_id = 3) AS courier_orders_count', statements)
        self.assertIn('created_by_staff_account_id IS NULL) AS website_orders_count', statements)

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

    def test_courier_fixes_customer_data_in_own_order(self):
        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'customer_name': 'Старое', 'phone': '+992900000000',
            'address': 'Айни', 'landmark': 'школа', 'created_by_staff_account_id': 3}
        with self._tx(cursor):
            result = update_courier_order_customer('ord_' + 'a' * 32,
                {'customer_name': '  Анвар   Каримов ', 'phone': '917 12 34 56',
                 'address': ' Рудаки  10 ', 'landmark': 'ТЦ Пайкар'}, 'req')
        self.assertEqual(result['phone'], '+992917123456')
        self.assertEqual(result['address'], 'Рудаки 10')
        sql, args = cursor.execute.call_args_list[1].args
        self.assertIn('edit_revision = edit_revision + 1', sql)
        self.assertNotIn('status', sql)
        self.assertEqual(args, ('Анвар Каримов', '+992917123456', '+992917123456', 'Рудаки 10', 'ТЦ Пайкар', 7))
        self.assertIn('courier.order.customer_updated', str(cursor.execute.call_args_list))

    def test_courier_cannot_edit_customer_of_website_order(self):
        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'customer_name': 'Клиент', 'phone': '+992900000000',
            'address': 'Айни', 'landmark': None, 'created_by_staff_account_id': None}
        with self._tx(cursor), self.assertRaises(ContractError) as raised:
            update_courier_order_customer('ord_' + 'a' * 32, {'customer_name': 'A', 'phone': '917123456',
                                                               'address': 'Айни 1', 'landmark': 'школа'}, 'req')
        self.assertEqual(raised.exception.http_status, 403)
        self.assertEqual(cursor.execute.call_count, 1)

    def test_courier_customer_update_validates_fields_before_database(self):
        valid = {'customer_name': 'A', 'phone': '917123456', 'address': 'Айни 1', 'landmark': 'школа'}
        for payload in ({**valid, 'comment': 'x'}, {**valid, 'phone': '12345'}, {**valid, 'customer_name': 5},
                        {**valid, 'customer_name': 'x' * 121}, {**valid, 'address': 'a'}, {**valid, 'landmark': ''}):
            cursor = Mock()
            with self._tx(cursor), self.assertRaises(ContractError):
                update_courier_order_customer('ord_' + 'a' * 32, payload, 'req')
            cursor.execute.assert_not_called()

    def test_courier_changes_quantity_and_price_of_own_line(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'confirmed', 'items_subtotal': Decimal('36'), 'created_by_staff_account_id': 3},
            {'id': 81, 'medicine_id': 44, 'medicine_name': 'NOW D3', 'quantity': Decimal('2'),
             'selling_unit_price': Decimal('18'), 'price': Decimal('18')},
            {'total': Decimal('60.00')},
        ]
        with self._tx(cursor):
            result = update_courier_order_item('ord_' + 'a' * 32, 81, {'quantity': 3, 'unit_price': '20'}, 'req')
        self.assertEqual(result['order_total'], '60.00')
        update = next(call for call in cursor.execute.call_args_list if call.args[0].startswith('UPDATE order_items'))
        self.assertEqual(update.args[1], (Decimal('3.00'), Decimal('20.00'), Decimal('20.00'), Decimal('60.00'), 81, 7))
        self.assertIn('courier.order.item_updated', str(cursor.execute.call_args_list))

    def test_courier_removes_line_and_cannot_touch_website_or_cancelled_orders(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'pending', 'items_subtotal': Decimal('36'), 'created_by_staff_account_id': 3},
            {'id': 81, 'medicine_id': None, 'medicine_name': 'X', 'quantity': Decimal('1'),
             'selling_unit_price': None, 'price': Decimal('36')},
            {'total': Decimal('0')},
        ]
        with self._tx(cursor):
            result = update_courier_order_item('ord_' + 'a' * 32, 81, None, 'req')
        self.assertTrue(result['removed'])
        self.assertIn('DELETE FROM order_items', ' '.join(call.args[0] for call in cursor.execute.call_args_list))
        for order in ({'id': 7, 'status': 'pending', 'items_subtotal': 0, 'created_by_staff_account_id': None},
                      {'id': 7, 'status': 'cancelled', 'items_subtotal': 0, 'created_by_staff_account_id': 3}):
            cursor = Mock()
            cursor.fetchone.return_value = order
            with self._tx(cursor), self.assertRaises(ContractError):
                update_courier_order_item('ord_' + 'a' * 32, 81, {'quantity': 1}, 'req')
            self.assertEqual(cursor.execute.call_count, 1)

    def test_courier_line_edit_validates_payload(self):
        for payload in ({}, {'quantity': 0}, {'unit_price': '0'}, {'quantity': 1, 'medicine_id': 3}):
            cursor = Mock()
            with self._tx(cursor), self.assertRaises(ContractError):
                update_courier_order_item('ord_' + 'a' * 32, 81, payload, 'req')
            cursor.execute.assert_not_called()

    def test_get_courier_order_returns_one_order_with_ownership(self):
        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'public_id': 'ord_' + 'a' * 32, 'own_order': True,
            'created_at': datetime(2026, 10, 2, tzinfo=timezone.utc), 'medicines': []}
        with self._tx(cursor):
            result = get_courier_order('ord_' + 'a' * 32)
        self.assertEqual(result['order_id'], 'ord_' + 'a' * 32)
        self.assertNotIn('id', result)
        sql, args = cursor.execute.call_args.args
        self.assertIn('o.public_id = %s', sql)
        self.assertIn('own_order', sql)
        self.assertEqual(args, ('ord_' + 'a' * 32,))

    # --- courier delivery checklist -------------------------------------------------

    _WEBSITE_ORDER = {'id': 7, 'status': 'confirmed', 'created_by_staff_account_id': None}

    def test_checklist_tick_upserts_parameterized_and_audits(self):
        for step in (2, 6):
            cursor = Mock()
            cursor.fetchone.side_effect = [dict(self._WEBSITE_ORDER), {'step': step}, {'steps': [1, step]}]
            order_id = 'ord_' + 'a' * 32
            with self._tx(cursor):
                result = update_courier_order_checklist(order_id, {'step': step, 'done': True}, 'req')
            self.assertEqual(result, {'order_id': order_id, 'checklist_steps': [1, step]})
            calls = cursor.execute.call_args_list
            self.assertIn('FOR UPDATE', calls[0].args[0])
            self.assertEqual(calls[0].args[1], (order_id,))
            insert = calls[1]
            self.assertIn('INSERT INTO order_courier_checklist', insert.args[0])
            self.assertIn('VALUES (%s, %s, %s)', insert.args[0])
            self.assertIn('ON CONFLICT (order_id, step) DO UPDATE', insert.args[0])
            self.assertIn('SET completed_by = EXCLUDED.completed_by, completed_at = now()', insert.args[0])
            self.assertIn('WHERE order_courier_checklist.completed_by <> EXCLUDED.completed_by', insert.args[0])
            self.assertIn('RETURNING step', insert.args[0])
            self.assertEqual(insert.args[1], (7, step, 'staff:3/v2'))
            self.assertIn('courier.order.checklist_updated', str(calls))
            statements = ' '.join(call.args[0] for call in calls)
            self.assertNotIn('UPDATE orders', statements)
            self.assertNotIn('order_status_history', statements)

    def test_checklist_tick_converts_legacy_row_and_rereads_with_mapping(self):
        # Legacy (2, 'staff:3') is converted by the upsert; the re-read applies the legacy mapping in SQL.
        cursor = Mock()
        cursor.fetchone.side_effect = [dict(self._WEBSITE_ORDER), {'step': 2}, {'steps': [2, 1]}]
        with self._tx(cursor):
            result = update_courier_order_checklist('ord_' + 'a' * 32, {'step': 2, 'done': True}, 'req')
        self.assertEqual(result['checklist_steps'], [1, 2])
        calls = cursor.execute.call_args_list
        self.assertEqual(calls[1].args[1], (7, 2, 'staff:3/v2'))
        reread_sql, reread_args = calls[-1].args
        self.assertIn("WHEN c.completed_by = 'staff:3/v2'", reread_sql)
        self.assertIn('WHEN c.step = 4 THEN 2', reread_sql)
        self.assertIn('FILTER (WHERE', reread_sql)
        self.assertEqual(reread_args, (7,))

    def test_checklist_untick_deletes_parameterized_and_audits(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [dict(self._WEBSITE_ORDER), {'step': 6}, {'steps': []}]
        with self._tx(cursor):
            result = update_courier_order_checklist('legacy_7', {'step': 6, 'done': False}, 'req')
        self.assertEqual(result['checklist_steps'], [])
        delete = cursor.execute.call_args_list[1]
        self.assertIn('DELETE FROM order_courier_checklist WHERE order_id = %s AND step = %s', delete.args[0])
        self.assertEqual(delete.args[1], (7, 6))
        self.assertIn('courier.order.checklist_updated', str(cursor.execute.call_args_list))

    def test_checklist_untick_step_two_also_deletes_legacy_step_four(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [dict(self._WEBSITE_ORDER), {'step': 2}, {'steps': [1]}]
        with self._tx(cursor):
            result = update_courier_order_checklist('ord_' + 'a' * 32, {'step': 2, 'done': False}, 'req')
        self.assertEqual(result['checklist_steps'], [1])
        sql, args = cursor.execute.call_args_list[1].args
        self.assertIn('DELETE FROM order_courier_checklist', sql)
        self.assertIn('WHERE order_id = %s AND (step = %s OR (step = 4 AND completed_by <> %s))', sql)
        self.assertNotIn("'staff:3", sql)
        self.assertEqual(args, (7, 2, 'staff:3/v2'))
        self.assertIn('courier.order.checklist_updated', str(cursor.execute.call_args_list))

    def test_checklist_repeated_request_is_noop_success_without_audit(self):
        for done in (True, False):
            cursor = Mock()
            cursor.fetchone.side_effect = [dict(self._WEBSITE_ORDER), None, {'steps': [6] if done else []}]
            with self._tx(cursor):
                result = update_courier_order_checklist('ord_' + 'a' * 32, {'step': 6, 'done': done}, 'req')
            self.assertEqual(result['checklist_steps'], [6] if done else [])
            self.assertNotIn('admin_audit_log', ' '.join(call.args[0] for call in cursor.execute.call_args_list))

    def test_checklist_validates_payload_before_database(self):
        for payload in ({}, {'step': 2}, {'done': True}, {'step': 2, 'done': True, 'extra': 1},
                        {'step': '2', 'done': True}, {'step': 2.0, 'done': True}, {'step': True, 'done': True},
                        {'step': 0, 'done': True}, {'step': 8, 'done': True}, {'step': 9, 'done': True},
                        {'step': 2, 'done': 'yes'}, {'step': 2, 'done': 1},
                        {'step': 4, 'done': True}, {'step': 5, 'done': True}, {'step': 7, 'done': True},
                        {'step': 8, 'done': False}):
            cursor = Mock()
            with self._tx(cursor), self.assertRaises(ContractError) as raised:
                update_courier_order_checklist('ord_' + 'a' * 32, payload, 'req')
            self.assertEqual((raised.exception.code, raised.exception.http_status), ('VALIDATION_ERROR', 400))
            cursor.execute.assert_not_called()
        for step in (4, 5, 7):
            with self.assertRaises(ContractError) as raised:
                update_courier_order_checklist('ord_' + 'a' * 32, {'step': step, 'done': True}, 'req')
            self.assertIn('Этот шаг отмечается сменой статуса заказа', str(raised.exception.__dict__))
        with self.assertRaises(ContractError) as raised:
            update_courier_order_checklist('ord_' + 'a' * 32, {'step': 8, 'done': True}, 'req')
        self.assertIn('Шаг должен быть числом от 1 до 7', str(raised.exception.__dict__))

    def test_checklist_rejects_cancelled_own_and_missing_orders(self):
        cases = (({'id': 7, 'status': 'cancelled', 'created_by_staff_account_id': None}, 409, 'ORDER_STATUS_CONFLICT'),
                 ({'id': 7, 'status': 'pending', 'created_by_staff_account_id': 3}, 409, 'CHECKLIST_NOT_AVAILABLE'),
                 ({'id': 7, 'status': 'pending', 'created_by_staff_account_id': 1}, 409, 'CHECKLIST_NOT_AVAILABLE'),
                 (None, 404, 'ORDER_NOT_FOUND'))
        for order, status, code in cases:
            for step in (1, 2, 6):
                cursor = Mock()
                cursor.fetchone.return_value = order
                with self._tx(cursor), self.assertRaises(ContractError) as raised:
                    update_courier_order_checklist('ord_' + 'a' * 32, {'step': step, 'done': True}, 'req')
                self.assertEqual((raised.exception.http_status, raised.exception.code), (status, code))
                self.assertEqual(cursor.execute.call_count, 1)
                self.assertIn('deleted_at IS NULL', cursor.execute.call_args.args[0])

    def test_courier_select_projects_checklist_steps_without_n_plus_one(self):
        cursor = Mock()
        cursor.fetchall.return_value = [{'id': 7, 'public_id': 'ord_' + 'a' * 32,
            'created_at': datetime(2026, 10, 2, tzinfo=timezone.utc), 'checklist_steps': [6, 1, 2]}]
        with self._tx(cursor):
            result = list_courier_orders({})
        self.assertEqual(result['data'][0]['checklist_steps'], [1, 2, 6])
        self.assertEqual(cursor.execute.call_count, 1)
        sql = cursor.execute.call_args.args[0]
        self.assertIn('AS checklist_steps', sql)
        self.assertIn('FROM order_courier_checklist c WHERE c.order_id = o.id', sql)
        self.assertIn('LEFT JOIN LATERAL', sql)

        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'public_id': 'ord_' + 'a' * 32,
            'created_at': datetime(2026, 10, 2, tzinfo=timezone.utc), 'checklist_steps': None}
        with self._tx(cursor):
            result = get_courier_order('ord_' + 'a' * 32)
        self.assertEqual(result['checklist_steps'], [])
        self.assertIn('AS checklist_steps', cursor.execute.call_args.args[0])

    def test_courier_select_contains_legacy_case_mapping(self):
        sql = _COURIER_ORDER_SELECT
        self.assertIn("WHEN c.completed_by = 'staff:3/v2' THEN CASE WHEN c.step IN (1, 2, 6)", sql)
        self.assertIn('WHEN c.step = 1 THEN 1', sql)
        self.assertIn('WHEN c.step = 4 THEN 2', sql)
        self.assertIn('array_agg(DISTINCT CASE', sql)
        self.assertIn('IS NOT NULL)', sql)
        self.assertIn("'" + COURIER_CHECKLIST_MARKER + "'", _COURIER_CHECKLIST_STEP_SQL)

    def test_legacy_case_mapping_maps_old_rows_to_new_steps(self):
        # Evaluate the exact CASE expression on an in-memory table (portable SQL; array_agg is Postgres-only).
        def mapped(rows):
            db = sqlite3.connect(':memory:')
            db.execute('CREATE TABLE order_courier_checklist (step INTEGER, completed_by TEXT)')
            db.executemany('INSERT INTO order_courier_checklist VALUES (?, ?)', rows)
            expression = _COURIER_CHECKLIST_STEP_SQL.replace('::integer', '')
            values = db.execute('SELECT DISTINCT ' + expression + ' FROM order_courier_checklist c '
                                'WHERE ' + expression + ' IS NOT NULL').fetchall()
            db.close()
            return _checklist_steps([value for (value,) in values])

        legacy = [(1, 'staff:3'), (2, 'staff:3'), (4, 'staff:3'), (5, 'staff:3'), (7, 'staff:3')]
        self.assertEqual(mapped(legacy), [1, 2])
        self.assertEqual(mapped([(2, 'staff:3/v2'), (4, 'staff:3')]), [2])
        # A stored v2 step-3 row (ticked before job 010) is ignored: step 3 now derives from pharmacy answers.
        self.assertEqual(mapped([(1, 'staff:3/v2'), (3, 'staff:3/v2'), (6, 'staff:3/v2'), (5, 'staff:3/v2')]), [1, 6])
        self.assertEqual(mapped([(1, 'staff:3'), (2, 'staff:3')]), [1])
        # After unticking step 2 (v2 row 2 and legacy row 4 deleted) only the legacy step 1 remains.
        self.assertEqual(mapped([(1, 'staff:3'), (5, 'staff:3'), (7, 'staff:3')]), [1])

    def test_checklist_steps_drops_values_outside_manual_set(self):
        self.assertEqual(_checklist_steps([7, 6, 5, 4, 3, 2, 1, 8, 0, 2]), [1, 2, 6])
        self.assertEqual(_checklist_steps(None), [])

    # --- job 010: step 3 derived from pharmacy answers, confirmed amount ------------------

    def test_manual_steps_are_one_two_six(self):
        self.assertEqual(COURIER_CHECKLIST_MANUAL_STEPS, frozenset({1, 2, 6}))

    def test_step_three_patch_is_rejected_before_database(self):
        for done in (True, False):
            cursor = Mock()
            with self._tx(cursor), self.assertRaises(ContractError) as raised:
                update_courier_order_checklist('ord_' + 'a' * 32, {'step': 3, 'done': done}, 'req')
            self.assertEqual((raised.exception.code, raised.exception.http_status), ('VALIDATION_ERROR', 400))
            self.assertIn('Этот шаг отмечается ответом аптеки', str(raised.exception.__dict__))
            cursor.execute.assert_not_called()

    def test_stored_step_three_row_is_ignored_on_read(self):
        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'public_id': 'ord_' + 'a' * 32, 'medicines': [],
            'created_at': datetime(2026, 10, 2, tzinfo=timezone.utc), 'checklist_steps': [1, 3, 6]}
        with self._tx(cursor):
            result = get_courier_order('ord_' + 'a' * 32)
        self.assertEqual(result['checklist_steps'], [1, 6])

    def _courier_row(self, **extra):
        cursor = Mock()
        cursor.fetchone.return_value = {'id': 7, 'public_id': 'ord_' + 'a' * 32, 'medicines': [],
            'created_at': datetime(2026, 10, 2, tzinfo=timezone.utc), 'checklist_steps': [], **extra}
        with self._tx(cursor):
            return get_courier_order('ord_' + 'a' * 32), cursor

    def test_confirmed_total_is_null_until_answers_complete(self):
        result, _ = self._courier_row(pharmacy_answers_complete=False, confirmed_total=None,
                                      unavailable_count=0, answered_count=1, item_count=2)
        self.assertIs(result['pharmacy_answers_complete'], False)
        self.assertIsNone(result['confirmed_total'])
        self.assertEqual((result['answered_count'], result['item_count']), (1, 2))

    def test_confirmed_total_is_null_when_a_price_differs(self):
        # SQL returns NULL for confirmed_total when any current answer is price_differs.
        result, cursor = self._courier_row(pharmacy_answers_complete=True, confirmed_total=None,
                                           unavailable_count=0, answered_count=2, item_count=2)
        self.assertIs(result['pharmacy_answers_complete'], True)
        self.assertIsNone(result['confirmed_total'])
        sql = cursor.execute.call_args.args[0]
        self.assertIn("COUNT(*) FILTER (WHERE cur.answer = 'price_differs') = 0", sql)

    def test_confirmed_total_is_decimal_string_when_complete(self):
        result, cursor = self._courier_row(pharmacy_answers_complete=True, confirmed_total=Decimal('57.50'),
                                           unavailable_count=1, answered_count=3, item_count=3)
        self.assertEqual(result['confirmed_total'], '57.50')
        self.assertEqual(result['unavailable_count'], 1)
        sql = cursor.execute.call_args.args[0]
        self.assertIn("SUM(oi.line_total) FILTER (WHERE cur.answer = 'available')", sql)
        self.assertIn("COUNT(*) FILTER (WHERE cur.answer = 'unavailable') AS unavailable_count", sql)

    def test_old_rows_without_answer_fields_default_safely(self):
        result, _ = self._courier_row()
        self.assertIs(result['pharmacy_answers_complete'], False)
        self.assertIsNone(result['confirmed_total'])
        self.assertEqual(result['unavailable_count'], 0)

    def test_courier_select_projects_item_pharmacy_and_answers_without_n_plus_one(self):
        sql = _COURIER_ORDER_SELECT
        self.assertIn("'pharmacy_id', COALESCE(oi.fulfillment_pharmacy_id,", sql)
        self.assertIn("'answers', COALESCE(answers.list, '[]'::json)", sql)
        self.assertIn('FROM order_item_pharmacy_answers a WHERE a.order_item_id = oi.id', sql)
        self.assertIn('LEFT JOIN order_item_pharmacy_answers cur', sql)
        self.assertEqual(sql.count('LEFT JOIN LATERAL'), 4)
        cursor = Mock()
        cursor.fetchall.return_value = []
        with self._tx(cursor):
            list_courier_orders({})
        self.assertEqual(cursor.execute.call_count, 1)

    # --- job 011: assembly marks in the courier projection ------------------------------

    def test_assembly_single_pharmacy(self):
        waiting, _ = self._courier_row(status='confirmed', website_order=True,
                                       assembly=[{'pharmacy_id': 1, 'state': 'waiting',
                                                  'started_at': None, 'assembled_at': None}])
        self.assertEqual(waiting['assembly'], [{'pharmacy_id': 1, 'state': 'waiting',
                                                'started_at': None, 'assembled_at': None}])
        self.assertIs(waiting['assembly_complete'], False)
        done, _ = self._courier_row(status='confirmed', website_order=True, assembly=[
            {'pharmacy_id': 1, 'state': 'assembled', 'started_at': '2026-10-16T08:00:00+00:00',
             'assembled_at': '2026-10-16T08:20:00+00:00'}])
        self.assertEqual(done['assembly'][0]['state'], 'assembled')
        self.assertEqual(done['assembly'][0]['assembled_at'], '2026-10-16T08:20:00+00:00')
        self.assertIs(done['assembly_complete'], True)

    def test_assembly_routed_order_lists_both_pharmacies(self):
        result, _ = self._courier_row(status='confirmed', website_order=True, assembly=json.dumps([
            {'pharmacy_id': 2, 'state': 'waiting', 'started_at': None, 'assembled_at': None},
            {'pharmacy_id': 1, 'state': 'assembled', 'started_at': '2026-10-16T08:00:00+00:00',
             'assembled_at': '2026-10-16T08:20:00+00:00'}]))
        self.assertEqual([(entry['pharmacy_id'], entry['state']) for entry in result['assembly']],
                         [(1, 'assembled'), (2, 'waiting')])
        self.assertIs(result['assembly_complete'], False)
        both, _ = self._courier_row(status='confirmed', website_order=True, assembly=[
            {'pharmacy_id': 1, 'state': 'assembled', 'started_at': None, 'assembled_at': None},
            {'pharmacy_id': 2, 'state': 'assembling', 'started_at': None, 'assembled_at': None}])
        self.assertIs(both['assembly_complete'], False)

    def test_assembly_complete_does_not_depend_on_confirmed(self):
        # Rework 1: assembly happens while the order is pending; «Согласовано» waits for it.
        done = [{'pharmacy_id': 1, 'state': 'assembled', 'started_at': None, 'assembled_at': None}]
        waiting = [{'pharmacy_id': 1, 'state': 'assembling', 'started_at': None, 'assembled_at': None}]
        for status in ('pending', 'confirmed', 'delivering', 'delivered'):
            with self.subTest(status=status):
                result, _ = self._courier_row(status=status, website_order=True, assembly=done)
                self.assertIs(result['assembly_complete'], True)
                self.assertEqual(len(result['assembly']), 1)  # marks stay visible read-only
                result, _ = self._courier_row(status=status, website_order=True, assembly=waiting)
                self.assertIs(result['assembly_complete'], False)
        cancelled, _ = self._courier_row(status='cancelled', website_order=True, assembly=done)
        self.assertIs(cancelled['assembly_complete'], False)

    def test_assembly_sql_excludes_pharmacies_with_only_unavailable_items(self):
        sql = _COURIER_ORDER_SELECT
        self.assertIn("COALESCE(assembly.list, '[]'::json) AS assembly", sql)
        self.assertIn("AND cur.answer IS DISTINCT FROM 'unavailable'", sql)
        self.assertIn('SELECT DISTINCT COALESCE(oi.fulfillment_pharmacy_id,', sql)
        self.assertIn("'state', COALESCE(asm.state, 'waiting')", sql)
        self.assertIn('LEFT JOIN order_pharmacy_assembly asm ON asm.order_id = o.id AND asm.pharmacy_id = ph.pharmacy_id', sql)
        self.assertIn('ORDER BY ph.pharmacy_id', sql)
        self.assertIn('WHERE oi.order_id = o.id AND o.created_by_staff_account_id IS NULL', sql)
        # Pharmacy 2 answered every item «Нет в наличии»: SQL returns only pharmacy 1.
        result, _ = self._courier_row(status='confirmed', website_order=True, assembly=[
            {'pharmacy_id': 1, 'state': 'assembling', 'started_at': None, 'assembled_at': None}])
        self.assertEqual([entry['pharmacy_id'] for entry in result['assembly']], [1])

    def test_assembly_empty_for_courier_created_and_old_rows(self):
        own, _ = self._courier_row(status='confirmed', website_order=False, own_order=True, assembly=[])
        self.assertEqual(own['assembly'], [])
        self.assertIs(own['assembly_complete'], True)  # nothing to wait for: no warning
        # Even if SQL returned marks, a non-website order never shows them.
        forced, _ = self._courier_row(status='confirmed', website_order=False, assembly=[
            {'pharmacy_id': 1, 'state': 'waiting', 'started_at': None, 'assembled_at': None}])
        self.assertEqual(forced['assembly'], [])
        old, _ = self._courier_row()
        self.assertEqual(old['assembly'], [])
        self.assertIs(old['assembly_complete'], True)  # nothing to assemble

    # --- job 013: stage on courier rows ------------------------------------------------------

    def test_courier_rows_carry_the_shared_stage(self):
        done = [{'pharmacy_id': 1, 'state': 'assembled', 'started_at': None, 'assembled_at': None}]
        waiting = [{'pharmacy_id': 1, 'state': 'assembled', 'started_at': None, 'assembled_at': None},
                   {'pharmacy_id': 2, 'state': 'waiting', 'started_at': None, 'assembled_at': None}]
        cases = [
            (dict(status='pending', website_order=True, assembly=done), 'assembled'),
            (dict(status='pending', website_order=True, assembly=waiting), 'assembling'),
            (dict(status='pending', website_order=True, assembly=[]), 'assembling'),
            (dict(status='pending', website_order=False, own_order=True, assembly=[]), 'assembling'),
            (dict(status='confirmed', website_order=True, assembly=waiting), 'confirmed'),
            (dict(status='delivering', website_order=True, assembly=done), 'delivering'),
            (dict(status='delivered', website_order=False, assembly=[]), 'delivered'),
        ]
        for extra, stage in cases:
            with self.subTest(extra=extra):
                result, _ = self._courier_row(**extra)
                self.assertEqual(result['stage'], stage)
                self.assertEqual(result['status'], extra['status'])

    def test_courier_list_rows_have_stage_without_extra_queries(self):
        cursor = Mock()
        cursor.fetchall.return_value = [{'id': 7, 'public_id': 'ord_' + 'a' * 32, 'medicines': [], 'status': 'pending',
            'website_order': True, 'created_at': datetime(2026, 10, 2, tzinfo=timezone.utc), 'checklist_steps': [],
            'assembly': [{'pharmacy_id': 1, 'state': 'assembled', 'started_at': None, 'assembled_at': None}]}]
        with self._tx(cursor):
            result = list_courier_orders({})
        self.assertEqual(result['data'][0]['stage'], 'assembled')
        self.assertEqual(cursor.execute.call_count, 1)

    def test_item_price_requires_a_price(self):
        with self.assertRaises(ContractError):
            update_order_item_price('ord_' + 'a' * 32, {'order_item_id': 3}, 'admin', 'req')


if __name__ == '__main__':
    unittest.main()
