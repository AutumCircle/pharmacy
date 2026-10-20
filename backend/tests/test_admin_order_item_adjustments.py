import unittest
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import (
    add_courier_order_items, adjust_admin_order_item, preview_order_notifications, update_order_item_price,
)
from backend.v1.telegram_notifier.lambda_function import format_configured_message as notifier_formatter
from backend.v1.shared.contract import ContractError
from backend.v1.shared.order_notification_settings import default_pharmacy_alarm, default_policies
from backend.v1.shared.order_notification_messages import format_configured_message


class AdminOrderItemAdjustmentTests(unittest.TestCase):
    def _tx(self, cursor):
        @contextmanager
        def fake_transaction():
            yield cursor
        return patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction)

    def test_quantity_on_delivered_order_recalculates_total_and_audits(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'delivered', 'items_subtotal': Decimal('20'), 'reference': 'VAT-7'},
            {'id': 5, 'medicine_id': 8, 'medicine_name': 'Пример', 'quantity': 2,
             'selling_unit_price': Decimal('10'), 'price': Decimal('10')},
            {'total': Decimal('30')},
        ]
        with self._tx(cursor):
            result = adjust_admin_order_item('ord_' + 'a' * 32,
                {'order_item_id': 5, 'expected_quantity': 2, 'quantity': 3}, 'admin:test', 'req')
        self.assertEqual(result['quantity'], 3)
        self.assertEqual(result['order_total'], Decimal('30'))
        sql = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn('UPDATE order_items SET quantity', sql)
        self.assertIn('UPDATE orders SET items_subtotal', sql)
        self.assertNotIn('delivery_courier_amount', sql)
        self.assertIn('order.item_quantity_set', str(cursor.execute.call_args_list))

    def test_remove_from_cancelled_order_only_deletes_order_line(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'cancelled', 'items_subtotal': Decimal('20'), 'reference': 'VAT-7'},
            {'id': 5, 'medicine_id': None, 'medicine_name': 'Вне каталога', 'quantity': 2,
             'selling_unit_price': Decimal('10'), 'price': Decimal('10')},
            {'total': Decimal('0')},
        ]
        with self._tx(cursor):
            result = adjust_admin_order_item('ord_' + 'a' * 32,
                {'order_item_id': 5, 'expected_quantity': 2, 'quantity': 0}, 'admin:test', 'req')
        self.assertTrue(result['removed'])
        sql = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn('DELETE FROM order_items WHERE id = %s AND order_id = %s', sql)
        self.assertNotIn('DELETE FROM medicines', sql)
        self.assertIn('order.item_removed', str(cursor.execute.call_args_list))

    def test_stale_quantity_rejected_before_mutation(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'pending', 'items_subtotal': Decimal('20'), 'reference': 'VAT-7'},
            {'id': 5, 'medicine_id': 8, 'medicine_name': 'Пример', 'quantity': 3,
             'selling_unit_price': Decimal('10'), 'price': Decimal('10')},
        ]
        with self._tx(cursor), self.assertRaises(ContractError):
            adjust_admin_order_item('ord_' + 'a' * 32,
                {'order_item_id': 5, 'expected_quantity': 2, 'quantity': 0}, 'admin:test', 'req')
        self.assertEqual(cursor.execute.call_count, 2)

    # --- job 010: admin edits void the item's current pharmacy answer -----------------

    @staticmethod
    def _answer_deletes(cursor):
        return [call for call in cursor.execute.call_args_list
                if 'DELETE FROM order_item_pharmacy_answers' in call.args[0]]

    def test_quantity_change_clears_current_pharmacy_answer(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'pending', 'items_subtotal': Decimal('20'), 'reference': 'VAT-7'},
            {'id': 5, 'medicine_id': 8, 'medicine_name': 'Пример', 'quantity': 2,
             'selling_unit_price': Decimal('10'), 'price': Decimal('10')},
            {'total': Decimal('30')},
        ]
        with self._tx(cursor):
            adjust_admin_order_item('ord_' + 'a' * 32,
                {'order_item_id': 5, 'expected_quantity': 2, 'quantity': 3}, 'admin:test', 'req')
        deletes = self._answer_deletes(cursor)
        self.assertEqual(len(deletes), 1)
        sql, args = deletes[0].args
        self.assertIn('a.pharmacy_id = COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)', sql)
        self.assertEqual(args, (7, [5]))
        self.assertNotIn('fulfillment_pharmacy_id =', ' '.join(call.args[0] for call in cursor.execute.call_args_list
                                                               if call.args[0].lstrip().startswith('UPDATE')))

    def test_same_quantity_keeps_answer(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'pending', 'items_subtotal': Decimal('20'), 'reference': 'VAT-7'},
            {'id': 5, 'medicine_id': 8, 'medicine_name': 'Пример', 'quantity': 2,
             'selling_unit_price': Decimal('10'), 'price': Decimal('10')},
            {'total': Decimal('20')},
        ]
        with self._tx(cursor):
            adjust_admin_order_item('ord_' + 'a' * 32,
                {'order_item_id': 5, 'expected_quantity': 2, 'quantity': 2}, 'admin:test', 'req')
        self.assertEqual(self._answer_deletes(cursor), [])

    def _price_edit(self, payload):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'reference': '3456-007'},
            {'id': 3, 'medicine_name': 'X', 'selling_unit_price': Decimal('30.00'),
             'base_unit_price': Decimal('20.00'), 'quantity': 2},
            {'items_subtotal': Decimal('60.00')},
        ]
        with self._tx(cursor):
            update_order_item_price('ord_' + 'a' * 32, {'order_item_id': 3, **payload}, 'admin', 'req')
        return cursor

    def test_base_price_change_clears_current_pharmacy_answer(self):
        deletes = self._answer_deletes(self._price_edit({'base_unit_price': '25'}))
        self.assertEqual(len(deletes), 1)
        self.assertEqual(deletes[0].args[1], (7, [3]))

    def test_client_price_only_change_keeps_answer(self):
        self.assertEqual(self._answer_deletes(self._price_edit({'selling_unit_price': '35'})), [])
        # Re-sending the same base price is not a change.
        self.assertEqual(self._answer_deletes(self._price_edit({'base_unit_price': '20.00'})), [])

    def test_admin_add_items_increasing_quantity_clears_answer_of_that_item(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'id': 7, 'status': 'pending', 'items_subtotal': Decimal('10'),
             'created_by_staff_account_id': None, 'pharmacy_id': 1},
            {'id': 99}, {'total': Decimal('35.00')},
        ]
        cursor.fetchall.side_effect = [
            [{'id': 44, 'name': 'NOW D3', 'price': Decimal('10'), 'selling_unit_price': 12, 'in_stock': True},
             {'id': 55, 'name': 'Old', 'price': Decimal('5'), 'selling_unit_price': 6, 'in_stock': True}],
            [{'id': 81, 'medicine_id': 55, 'quantity': 2}],
        ]
        with self._tx(cursor):
            add_courier_order_items('ord_' + 'a' * 32, {'items': [
                {'medicine_id': 44, 'quantity': 1}, {'medicine_id': 55, 'quantity': 2},
            ]}, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', 'req_test', 'admin:owner')
        deletes = self._answer_deletes(cursor)
        self.assertEqual(len(deletes), 1)
        self.assertEqual(deletes[0].args[1], (7, [81]))

    def test_preview_uses_delivery_formatter_and_removes_hidden_fields(self):
        policies = default_policies()
        policies['owner_telegram']['phone'] = False
        preview = preview_order_notifications({'courier_enabled': True, 'policies': policies, 'revision': 1,
                                               'pharmacy_alarm': default_pharmacy_alarm()})
        self.assertNotIn('Телефон', preview['telegram']['owner_telegram'])
        self.assertIn('Новый заказ VAT-1042', preview['telegram']['owner_telegram'])
        self.assertIs(format_configured_message, notifier_formatter)


if __name__ == '__main__':
    unittest.main()
