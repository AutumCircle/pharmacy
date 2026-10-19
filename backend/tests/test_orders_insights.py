import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

from backend.v1.admin_api.lambda_function import orders_insights
from backend.v1.shared.contract import ContractError


class OrdersInsightsTests(unittest.TestCase):
    def run_insights(self, days='7'):
        today = datetime.now(ZoneInfo('Asia/Dushanbe')).date()
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'pending': 2, 'confirmed': 1, 'delivering': 1},
            {'ordered_count': 5, 'ordered_sum': Decimal('500'), 'website_ordered_count': 3, 'cancelled_count': 1},
            {'new_clients': 2, 'returning_clients': 1},
        ]
        cursor.fetchall.side_effect = [
            [{'id': 9, 'public_id': 'ord_' + 'a' * 32, 'order_reference': '1-009', 'customer_name': 'A',
              'phone': '+992900000000', 'address': 'x', 'order_total': Decimal('90'),
              'created_by_staff_account_id': None, 'fulfillment_pharmacy_id': 1, 'order_source': None,
              'created_at': datetime(2026, 10, 13, 5, tzinfo=timezone.utc)}],
            [{'day': today, 'website_orders': 2, 'courier_orders': 1, 'pharmacy_orders': 0,
              'website_sales': Decimal('200'), 'courier_sales': Decimal('100'), 'pharmacy_sales': Decimal('0'),
              'profit': Decimal('45'), 'courier_fee': Decimal('20'), 'owner_fee': Decimal('10'), 'owner_delivered': 1}],
            [{'medicine_name': 'Парацетамол', 'quantity': Decimal('3'), 'sales': Decimal('60'), 'orders': 2}],
            [{'hour': 10, 'orders': 4}, {'hour': 18, 'orders': 1}],
            [{'id': 5, 'public_id': None, 'order_reference': '1-005', 'customer_name': 'B',
              'delivered_at': datetime(2026, 10, 13, 6, tzinfo=timezone.utc), 'created_by_staff_account_id': 3,
              'delivery_courier_amount': Decimal('15'), 'delivery_owner_amount': Decimal('5'),
              'sales': Decimal('100'), 'base': Decimal('80')}],
        ]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            return orders_insights({'days': days}), cursor, today

    def test_fills_every_day_and_computes_totals(self):
        result, cursor, today = self.run_insights()
        self.assertEqual(len(result['daily']), 7)
        self.assertEqual(result['daily'][-1]['date'], today.isoformat())
        self.assertEqual(result['daily'][0]['date'], (today - timedelta(days=6)).isoformat())
        self.assertEqual(result['daily'][0]['website_orders'], 0)
        totals = result['totals']
        self.assertEqual((totals['delivered_count'], totals['delivered_sum']), (3, Decimal('300')))
        self.assertEqual(totals['average_check'], Decimal('100.00'))
        self.assertEqual((totals['owner_delivered'], totals['courier_fee']), (1, Decimal('20')))
        self.assertEqual(result['live']['new_orders'][0]['order_id'], 'ord_' + 'a' * 32)
        self.assertEqual(len(result['hours']), 24)
        self.assertEqual(result['hours'][10]['orders'], 4)
        self.assertEqual(result['clients'], {'new_clients': 2, 'returning_clients': 1})
        order = result['delivered_orders'][0]
        self.assertEqual(order['order_id'], 'legacy_5')
        self.assertEqual((order['profit'], order['owner_total']), (Decimal('20'), Decimal('25')))
        sql = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("AT TIME ZONE 'Asia/Dushanbe'", sql)
        self.assertIn('delivery_owner_amount > 0 AND delivery_courier_amount = 0', sql)

    def test_rejects_unknown_period_and_parameters(self):
        for query in ({'days': '14'}, {'days': 'x'}, {'days': '7', 'status': 'pending'}):
            with self.assertRaises(ContractError):
                orders_insights(query)


if __name__ == '__main__':
    unittest.main()
