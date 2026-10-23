"""Job 013: public tracking returns the derived `stage` next to the unchanged `status`."""
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import Mock, patch

from backend.v1.public_api import lambda_function as public_api
from backend.v1.shared.contract import ContractError


def order_row(order_id, status, assembled):
    return {'id': order_id, 'public_id': f'ord_{order_id:032x}', 'order_reference': f'1910-{order_id:03d}',
            'status': status, 'items_subtotal': Decimal('100'), 'order_total': Decimal('100'),
            'created_at': datetime(2026, 10, 19, 6, 0, tzinfo=timezone.utc), 'stage_assembled': assembled}


class PublicTrackingStageTests(unittest.TestCase):
    def _track(self, orders, items=()):
        cursor = Mock()
        cursor.fetchall.side_effect = [orders, list(items)]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch.object(public_api, 'transaction', fake_transaction):
            result = public_api.track_orders({'phone': '+992900000001'})
        return result, cursor

    def test_stage_is_returned_per_order_with_fixed_query_count(self):
        orders = [order_row(1, 'pending', False), order_row(2, 'pending', True), order_row(3, 'confirmed', False),
                  order_row(4, 'delivering', False), order_row(5, 'delivered', False),
                  order_row(6, 'cancelled', False)]
        result, cursor = self._track(orders, [{'order_id': 2, 'medicine_id': 7, 'medicine_name': 'A',
                                               'selling_unit_price': 50, 'quantity': 2, 'line_total': 100}])
        self.assertEqual([(row['status'], row['stage']) for row in result['data']], [
            ('pending', 'assembling'), ('pending', 'assembled'), ('confirmed', 'confirmed'),
            ('delivering', 'delivering'), ('delivered', 'delivered'), ('cancelled', 'cancelled')])
        self.assertEqual(result['data'][1]['items'][0]['medicine_name'], 'A')
        # Checkout redesign: the item photo comes from the catalogue (missing for legacy rows) and the
        # payment method from the order row (rows without it read as cash).
        self.assertIsNone(result['data'][1]['items'][0]['image_url'])
        self.assertEqual(result['data'][0]['payment_method'], 'cash_on_delivery')
        self.assertIn('LEFT JOIN medicines m ON m.id = oi.medicine_id', cursor.execute.call_args_list[1].args[0])
        for row in result['data']:
            self.assertNotIn('stage_assembled', row)
        # Two statements whatever the number of orders: the stage is computed inside the order SELECT.
        self.assertEqual(cursor.execute.call_count, 2)
        sql = cursor.execute.call_args_list[0].args[0]
        self.assertIn('AS stage_assembled', sql)
        self.assertIn('LEFT JOIN order_pharmacy_assembly stage_asm', sql)
        self.assertIn('LIMIT 20', sql)
        for call in cursor.execute.call_args_list:
            self.assertTrue(call.args[0].lstrip().startswith('SELECT'))
            self.assertNotIn('INSERT', call.args[0])
            self.assertNotIn('UPDATE', call.args[0])

    def test_item_photo_and_e_wallet_are_returned(self):
        row = {**order_row(1, 'pending', False), 'payment_method': 'e_wallet'}
        result, _ = self._track([row], [{'order_id': 1, 'medicine_id': 7, 'medicine_name': 'A', 'selling_unit_price': 50,
                                         'quantity': 2, 'line_total': 100, 'image_url': 'https://img.example/a.jpg'}])
        self.assertEqual(result['data'][0]['payment_method'], 'e_wallet')
        self.assertEqual(result['data'][0]['items'][0]['image_url'], 'https://img.example/a.jpg')

    def test_one_order_uses_the_same_two_statements(self):
        _, cursor = self._track([order_row(1, 'pending', True)])
        self.assertEqual(cursor.execute.call_count, 2)

    def test_only_phone_is_accepted(self):
        for payload in ({'phone': '+992900000001', 'stage': 'assembled'}, {}, None):
            with self.subTest(payload=payload), self.assertRaises(ContractError):
                public_api.track_orders(payload)

    def test_order_response_stage_is_optional(self):
        row = order_row(1, 'pending', False)
        self.assertNotIn('stage', public_api._order_response(row, []))
        self.assertEqual(public_api._order_response(row, [], 'assembling')['stage'], 'assembling')


if __name__ == '__main__':
    unittest.main()
