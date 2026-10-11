import unittest
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import adjust_admin_order_item, preview_order_notifications
from backend.v1.telegram_notifier.lambda_function import format_configured_message as notifier_formatter
from backend.v1.shared.contract import ContractError
from backend.v1.shared.order_notification_settings import default_policies
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

    def test_preview_uses_delivery_formatter_and_removes_hidden_fields(self):
        policies = default_policies()
        policies['owner_telegram']['phone'] = False
        preview = preview_order_notifications({'courier_enabled': True, 'policies': policies, 'revision': 1})
        self.assertNotIn('Телефон', preview['telegram']['owner_telegram'])
        self.assertIn('Новый заказ VAT-1042', preview['telegram']['owner_telegram'])
        self.assertIs(format_configured_message, notifier_formatter)


if __name__ == '__main__':
    unittest.main()
