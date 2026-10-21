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
    def _get(self, order, fulfillment=None, items=None, history=None, audit=None, removed=None):
        cursor = Mock()
        cursor.fetchone.side_effect = [order, fulfillment]
        # items, status history, then (job 016) the order/current-item audit rows and removed-item rows.
        cursor.fetchall.side_effect = [items or [], history or [], audit or [], removed or []]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            return get_order(ORDER_ID), cursor

    def test_website_order_gets_read_only_fulfillment_with_one_extra_query(self):
        result, cursor = self._get(order_row(), courier_row())
        self.assertEqual(cursor.execute.call_count, 6)
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
                self.assertEqual(cursor.execute.call_count, 5)
        delivered, _ = self._get(order_row(created_by=3, status='delivered'))
        self.assertEqual(delivered['stage'], 'delivered')

    def test_get_order_returns_timeline_with_parameterized_bounded_audit_reads(self):
        items = [{'order_item_id': 81, 'medicine_id': 1, 'medicine_name': 'A', 'base_unit_price': Decimal('8'),
                  'selling_unit_price': Decimal('10'), 'quantity': 1, 'line_total': Decimal('10')}]
        history = [{'id': 1, 'from_status': None, 'to_status': 'pending', 'actor_type': 'customer',
                    'actor_id': None, 'reason': None, 'created_at': CREATED}]
        audit = [{'id': 5, 'actor_id': 'staff:2', 'action': 'pharmacy.order.item_price_changed',
                  'resource_type': 'order', 'resource_id': ORDER_ID, 'created_at': CREATED.replace(minute=5),
                  'details': {'pharmacy_id': 2, 'secret': 'x', 'items': [
                      {'order_item_id': 81, 'previous_base_unit_price': '25.00', 'new_base_unit_price': '28.00'}]}},
                 {'id': 6, 'actor_id': 'admin', 'action': 'order.customer_updated', 'resource_type': 'order',
                  'resource_id': ORDER_ID, 'created_at': CREATED.replace(minute=7),
                  'details': {'previous': {'phone': '+992900000001'}, 'current': {'phone': '+992900000002'}}}]
        removed = [{'id': 4, 'actor_id': 'admin', 'action': 'order.item_removed', 'resource_type': 'order_item',
                    'resource_id': '79', 'created_at': CREATED.replace(minute=3),
                    'details': {'order_reference': '1910-009', 'medicine_name': 'Старое'}}]
        result, cursor = self._get(order_row(), courier_row(), items=items, history=history, audit=audit,
                                   removed=removed)
        self.assertEqual([event['kind'] for event in result['timeline']],
                         ['created', 'item_removed', 'pharmacy_price_changed', 'customer_updated'])
        self.assertIs(result['timeline_truncated'], False)
        self.assertEqual(result['timeline'][2]['medicine_name'], 'A')
        self.assertEqual(result['timeline'][3]['fields'][0]['previous'], '+992900000001')
        self.assertNotIn('id', result['status_history'][0])
        for event in result['timeline']:
            self.assertNotIn('details', event)
            self.assertNotIn('secret', event)
        current_sql, current_args = cursor.execute.call_args_list[4].args
        removed_sql, removed_args = cursor.execute.call_args_list[5].args
        for sql in (current_sql, removed_sql):
            self.assertIn('FROM admin_audit_log', sql)
            self.assertIn('LIMIT %s', sql)
            self.assertNotIn(ORDER_ID, sql)
            self.assertNotIn('1910-009', sql)
        self.assertEqual(current_args, (ORDER_ID, ['81'], 201))
        self.assertIn("details->>'order_reference' = %s", removed_sql)
        self.assertIn('created_at >= %s', removed_sql)
        self.assertEqual(removed_args, (CREATED, ['81'], ORDER_ID, '1910-009', '1910-009', 201))

    def test_timeline_truncated_when_a_read_hits_the_limit(self):
        many = [{'id': index, 'actor_id': 'staff:3', 'action': 'courier.order.checklist_updated',
                 'resource_type': 'order', 'resource_id': ORDER_ID, 'created_at': CREATED,
                 'details': {'step': 1, 'done': True}} for index in range(201)]
        result, _ = self._get(order_row(created_by=3), audit=many)
        self.assertIs(result['timeline_truncated'], True)
        self.assertEqual(len(result['timeline']), 200)

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
