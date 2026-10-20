"""Job 013: admin order card gets the read-only courier/pharmacy `fulfillment` block and `stage`."""
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import get_order, list_orders

ORDER_ID = 'ord_' + 'e' * 32
CREATED = datetime(2026, 10, 19, 6, 0, tzinfo=timezone.utc)


def order_row(created_by=None, status='pending'):
    return {'id': 9, 'public_id': ORDER_ID, 'order_reference': '1910-009', 'customer_name': 'Клиент',
            'phone': '+992900000001', 'address': 'Адрес', 'status': status, 'created_at': CREATED,
            'created_by_staff_account_id': created_by, 'fulfillment_pharmacy_id': None}


def courier_row(status='pending', assembly=None):
    return {'id': 9, 'public_id': ORDER_ID, 'status': status, 'created_at': CREATED, 'website_order': True,
            'checklist_steps': [1, 3, 6], 'pharmacy_answers_complete': True, 'confirmed_total': Decimal('57.50'),
            'unavailable_count': 1, 'answered_count': 2, 'item_count': 2,
            'customer_name': 'Клиент', 'phone': '+992900000001',
            'assembly': assembly if assembly is not None else [
                {'pharmacy_id': 1, 'state': 'assembled', 'started_at': None, 'assembled_at': None},
                {'pharmacy_id': 2, 'state': 'assembling', 'started_at': None, 'assembled_at': None}],
            'medicines': [
                {'order_item_id': 81, 'medicine_name': 'A', 'quantity': 1, 'pharmacy_id': 1,
                 'answers': [{'pharmacy_id': 1, 'answer': 'available', 'problem': None, 'answered_at': None}]},
                {'order_item_id': 82, 'medicine_name': 'B', 'quantity': 1, 'pharmacy_id': 2,
                 'answers': [{'pharmacy_id': 1, 'answer': 'unavailable', 'problem': None, 'answered_at': None},
                             {'pharmacy_id': 2, 'answer': 'available', 'problem': None, 'answered_at': None}]}]}


class AdminOrderFulfillmentTests(unittest.TestCase):
    def _get(self, order, fulfillment=None):
        cursor = Mock()
        cursor.fetchone.side_effect = [order, fulfillment]
        cursor.fetchall.side_effect = [[], []]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            return get_order(ORDER_ID), cursor

    def test_website_order_gets_read_only_fulfillment_with_one_extra_query(self):
        result, cursor = self._get(order_row(), courier_row())
        self.assertEqual(cursor.execute.call_count, 4)
        extra = cursor.execute.call_args_list[3]
        self.assertIn('order_courier_checklist', extra.args[0])
        self.assertIn('WHERE o.id = %s', extra.args[0])
        self.assertEqual(extra.args[1], (9,))
        for call in cursor.execute.call_args_list:
            self.assertTrue(call.args[0].lstrip().startswith('SELECT'))
        fulfillment = result['fulfillment']
        self.assertEqual(fulfillment['checklist_steps'], [1, 6])
        self.assertEqual([(entry['pharmacy_id'], entry['state']) for entry in fulfillment['assembly']],
                         [(1, 'assembled'), (2, 'assembling')])
        self.assertIs(fulfillment['assembly_complete'], False)
        self.assertIs(fulfillment['pharmacy_answers_complete'], True)
        self.assertEqual(fulfillment['confirmed_total'], '57.50')
        self.assertEqual(fulfillment['unavailable_count'], 1)
        self.assertEqual([(item['order_item_id'], item['pharmacy_id'], len(item['answers']))
                          for item in fulfillment['items']], [(81, 1, 1), (82, 2, 2)])
        for key in ('customer_name', 'phone', 'address'):
            self.assertNotIn(key, fulfillment)
        self.assertEqual((result['status'], result['stage']), ('pending', 'assembling'))

    def test_stage_is_assembled_when_every_pharmacy_marked(self):
        done = [{'pharmacy_id': 1, 'state': 'assembled', 'started_at': None, 'assembled_at': None}]
        result, _ = self._get(order_row(), courier_row(assembly=done))
        self.assertEqual(result['stage'], 'assembled')
        self.assertIs(result['fulfillment']['assembly_complete'], True)

    def test_staff_orders_have_null_fulfillment_and_no_extra_query(self):
        for creator in (1, 2, 3):
            with self.subTest(creator=creator):
                result, cursor = self._get(order_row(created_by=creator))
                self.assertIsNone(result['fulfillment'])
                self.assertEqual(result['stage'], 'assembling')
                self.assertEqual(cursor.execute.call_count, 3)
        delivered, _ = self._get(order_row(created_by=3, status='delivered'))
        self.assertEqual(delivered['stage'], 'delivered')

    def test_list_orders_has_stage_from_the_same_query(self):
        cursor = Mock()
        cursor.fetchall.return_value = [{**order_row(), 'stage_assembled': True},
                                        {**order_row(status='confirmed'), 'id': 8, 'stage_assembled': False}]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            result = list_orders({})
        self.assertEqual([row['stage'] for row in result['data']], ['assembled', 'confirmed'])
        self.assertNotIn('stage_assembled', result['data'][0])
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertIn('AS stage_assembled', cursor.execute.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
