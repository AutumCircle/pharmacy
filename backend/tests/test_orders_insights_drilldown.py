import json
import unittest
from contextlib import contextmanager
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

from backend.v1.admin_api import lambda_function as admin
from backend.v1.admin_api.lambda_function import (
    DELIVERED_DAY_CTE,
    _ORDER_CREATED_TZ,
    _encode_cursor,
    lambda_handler,
    orders_insights,
    orders_insights_drilldown,
)
from backend.v1.shared.contract import ContractError

ZONE = ZoneInfo('Asia/Dushanbe')
PUBLIC_ID = 'ord_' + 'b' * 32


def period_start(days):
    today = datetime.now(ZONE).date()
    return datetime.combine(today - timedelta(days=days - 1), time.min, tzinfo=ZONE)


def order_row(internal_id, *, public_id=None, sales='100', base='80', order_total=None, status='delivered',
              delivered=True):
    created = datetime(2026, 10, 13, 4, tzinfo=timezone.utc)
    return {
        'id': internal_id, 'public_id': public_id, 'order_reference': f'1-{internal_id:03d}',
        'customer_name': 'Клиент', 'status': status, 'created_at': created,
        'delivered_at': created + timedelta(hours=2) if delivered else None,
        'created_by_staff_account_id': 3, 'order_total': Decimal(order_total or sales),
        'delivery_courier_amount': Decimal('15'), 'delivery_owner_amount': Decimal('0'),
        'sales': Decimal(sales), 'base': Decimal(base), 'profit': Decimal(sales) - Decimal(base),
    }


class DrilldownHarness(unittest.TestCase):
    def run_drill(self, query, *, summary, rows):
        cursor = Mock()
        cursor.fetchone.return_value = summary
        cursor.fetchall.return_value = rows

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            return orders_insights_drilldown(query), cursor


class OrderMetricSqlTests(DrilldownHarness):
    def test_ordered_uses_creation_time_and_excludes_cancelled(self):
        result, cursor = self.run_drill({'days': '30', 'metric': 'ordered'},
                                        summary={'count': 1, 'sum': Decimal('90'), 'profit': Decimal('10')},
                                        rows=[order_row(7, public_id=PUBLIC_ID, sales='90', base='80',
                                                        status='pending', delivered=False)])
        since = period_start(30)
        summary_sql, summary_params = cursor.execute.call_args_list[0].args
        page_sql, page_params = cursor.execute.call_args_list[1].args
        for sql in (summary_sql, page_sql):
            self.assertIn("o.status <> 'cancelled'", sql)
            self.assertIn(f'o.deleted_at IS NULL AND {_ORDER_CREATED_TZ} >= %s', sql)
            self.assertNotIn('delivery_history', sql)
        self.assertIn('COALESCE(SUM(order_total), 0) AS sum', summary_sql)
        self.assertIn('ORDER BY created_at DESC, id DESC', page_sql)
        self.assertEqual(summary_params, (since,))
        self.assertEqual(page_params, (since, 51))
        row = result['data'][0]
        self.assertEqual(row['order_id'], PUBLIC_ID)
        self.assertEqual(row['status'], 'pending')
        self.assertNotIn('delivered_at', row)
        self.assertNotIn('id', row)
        self.assertEqual(row['created_at'], order_time_iso_for(datetime(2026, 10, 13, 4, tzinfo=timezone.utc)))
        self.assertEqual((result['metric'], result['period_days'], result['currency']), ('ordered', 30, 'TJS'))

    def test_cancelled_uses_creation_time_and_only_cancelled(self):
        _, cursor = self.run_drill({'metric': 'cancelled'},
                                   summary={'count': 0, 'sum': Decimal('0'), 'profit': Decimal('0')}, rows=[])
        for call in cursor.execute.call_args_list:
            sql = call.args[0]
            self.assertIn("o.status = 'cancelled'", sql)
            self.assertNotIn("o.status <> 'cancelled'", sql)
            self.assertIn(f'{_ORDER_CREATED_TZ} >= %s', sql)
            self.assertEqual(call.args[1][0], period_start(7))

    def test_delivered_and_average_check_use_delivery_day_cte(self):
        for metric in ('delivered', 'average_check'):
            with self.subTest(metric=metric):
                result, cursor = self.run_drill({'days': '1', 'metric': metric},
                                                summary={'count': 1, 'sum': Decimal('100'), 'profit': Decimal('20')},
                                                rows=[order_row(5)])
                summary_sql = cursor.execute.call_args_list[0].args[0]
                page_sql = cursor.execute.call_args_list[1].args[0]
                for sql in (summary_sql, page_sql):
                    self.assertTrue(sql.startswith(DELIVERED_DAY_CTE))
                    self.assertIn('e.delivered_at >= %s', sql)
                    self.assertIn('COALESCE(items.sales, e.order_total, 0)', sql)
                    self.assertIn('SUM(COALESCE(oi.base_unit_price, 0) * oi.quantity)', sql)
                self.assertIn('COALESCE(SUM(sales), 0) AS sum', summary_sql)
                self.assertIn('ORDER BY delivered_at DESC, id DESC', page_sql)
                self.assertEqual(cursor.execute.call_args_list[0].args[1], (period_start(1),))
                row = result['data'][0]
                self.assertEqual(row['order_id'], 'legacy_5')
                self.assertEqual(row['delivered_at'], order_time_iso_for(datetime(2026, 10, 13, 6, tzinfo=timezone.utc)))
                self.assertEqual(row['created_at'], order_time_iso_for(datetime(2026, 10, 13, 4, tzinfo=timezone.utc)))
                self.assertIsInstance(row['delivered_at'], str)

    def test_profit_orders_lowest_first_and_maps_negative_profit(self):
        result, cursor = self.run_drill({'metric': 'profit'},
                                        summary={'count': 2, 'sum': Decimal('150'), 'profit': Decimal('-105')},
                                        rows=[order_row(4, sales='50', base='175'), order_row(9, sales='100', base='80')])
        page_sql = cursor.execute.call_args_list[1].args[0]
        self.assertIn('ORDER BY profit ASC, id ASC', page_sql)
        self.assertEqual([row['profit'] for row in result['data']], [Decimal('-125'), Decimal('20')])
        self.assertEqual(result['data'][0]['sales'] - result['data'][0]['base'], result['data'][0]['profit'])
        self.assertEqual(result['summary'], {'count': 2, 'sum': Decimal('150'), 'profit': Decimal('-105')})

    def test_metric_is_never_interpolated(self):
        for metric in ("profit'; DROP TABLE orders; --", 'PROFIT', '', None):
            with self.subTest(metric=metric):
                query = {'metric': metric} if metric is not None else {}
                with self.assertRaises(ContractError) as error:
                    orders_insights_drilldown(query)
                self.assertEqual(error.exception.code, 'VALIDATION_ERROR')


class PaginationTests(DrilldownHarness):
    def test_has_more_and_cursor_round_trip_for_delivered(self):
        rows = [order_row(index) for index in (12, 11, 10)]
        result, _ = self.run_drill({'metric': 'delivered', 'limit': '2'},
                                   summary={'count': 3, 'sum': Decimal('300'), 'profit': Decimal('60')}, rows=rows)
        self.assertTrue(result['page']['has_more'])
        self.assertEqual(len(result['data']), 2)
        token = result['page']['next_cursor']
        _, cursor = self.run_drill({'metric': 'delivered', 'limit': '2', 'cursor': token},
                                   summary={'count': 3, 'sum': Decimal('300'), 'profit': Decimal('60')},
                                   rows=rows[2:])
        page_sql, page_params = cursor.execute.call_args_list[1].args
        self.assertIn('WHERE (delivered_at, id) < (%s, %s)', page_sql)
        self.assertEqual(page_params[1:], (rows[1]['delivered_at'], 11, 3))
        # The summary is over every row, not only the page.
        self.assertEqual(cursor.execute.call_args_list[0].args[1], (period_start(7),))

    def test_profit_cursor_is_decimal_keyset_ascending(self):
        rows = [order_row(4, sales='50', base='175'), order_row(9, sales='100', base='80')]
        result, _ = self.run_drill({'metric': 'profit', 'limit': '1'},
                                   summary={'count': 2, 'sum': Decimal('150'), 'profit': Decimal('-105')}, rows=rows)
        token = result['page']['next_cursor']
        _, cursor = self.run_drill({'metric': 'profit', 'limit': '1', 'cursor': token},
                                   summary={'count': 2, 'sum': Decimal('150'), 'profit': Decimal('-105')}, rows=rows[1:])
        page_sql, page_params = cursor.execute.call_args_list[1].args
        self.assertIn('WHERE (profit, id) > (%s, %s)', page_sql)
        self.assertEqual(page_params[1:], (Decimal('-125'), 4, 2))

    def test_last_page_has_no_cursor(self):
        result, _ = self.run_drill({'metric': 'ordered'},
                                   summary={'count': 1, 'sum': Decimal('1'), 'profit': Decimal('0')},
                                   rows=[order_row(1, delivered=False)])
        self.assertEqual(result['page'], {'next_cursor': None, 'has_more': False})


class ClientsTests(DrilldownHarness):
    def test_clients_summary_matches_insights_and_rows_hide_internal_ids(self):
        since = period_start(7)
        rows = [
            {'first_at': since + timedelta(hours=3), 'first_order_id': 40, 'customer_name': 'Новый',
             'phone': '+992900000001', 'orders_in_period': 2},
            {'first_at': since - timedelta(days=40), 'first_order_id': 3, 'customer_name': 'Старый',
             'phone': '+992900000002', 'orders_in_period': 1},
        ]
        result, cursor = self.run_drill({'metric': 'clients', 'limit': '1'},
                                        summary={'new_clients': 1, 'returning_clients': 1}, rows=rows)
        summary_sql, summary_params = cursor.execute.call_args_list[0].args
        page_sql, page_params = cursor.execute.call_args_list[1].args
        self.assertIn('COUNT(*) FILTER (WHERE first_at >= %s) AS new_clients', summary_sql)
        self.assertEqual(summary_params, (since, since, since))
        self.assertIn('ORDER BY first_at DESC, first_order_id DESC', page_sql)
        self.assertEqual(page_params, (since, since, 2))
        self.assertEqual(result['summary'], {'new_clients': 1, 'returning_clients': 1})
        self.assertEqual(result['data'], [{
            'customer_name': 'Новый', 'phone': '+992900000001', 'orders_in_period': 2,
            'first_order_at': order_time_iso_for(rows[0]['first_at']), 'is_new': True,
        }])
        token = result['page']['next_cursor']
        self.assertNotIn('9929', json.dumps(token))
        _, cursor = self.run_drill({'metric': 'clients', 'cursor': token},
                                   summary={'new_clients': 1, 'returning_clients': 1}, rows=rows[1:])
        page_sql, page_params = cursor.execute.call_args_list[1].args
        self.assertIn('WHERE (first_at, first_order_id) < (%s, %s)', page_sql)
        self.assertEqual(page_params[2:4], (rows[0]['first_at'], 40))


def order_time_iso_for(value):
    from backend.v1.shared.order_time import order_time_iso
    return order_time_iso(value)


class CardMatchesDrilldownTests(unittest.TestCase):
    """Given the same mocked aggregate rows, the card and its list summary agree."""

    def test_totals_equal_drilldown_summaries(self):
        today = datetime.now(ZONE).date()
        insights_cursor = Mock()
        insights_cursor.fetchone.side_effect = [
            {'pending': 0, 'confirmed': 0, 'delivering': 0},
            {'ordered_count': 5, 'ordered_sum': Decimal('500'), 'website_ordered_count': 3, 'cancelled_count': 2},
            {'new_clients': 2, 'returning_clients': 1},
        ]
        insights_cursor.fetchall.side_effect = [
            [],
            [{'day': today, 'website_orders': 2, 'courier_orders': 1, 'pharmacy_orders': 0,
              'website_sales': Decimal('200'), 'courier_sales': Decimal('100'), 'pharmacy_sales': Decimal('0'),
              'profit': Decimal('-105'), 'courier_fee': Decimal('20'), 'owner_fee': Decimal('0'), 'owner_delivered': 0}],
            [], [], [],
        ]

        @contextmanager
        def insights_transaction():
            yield insights_cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', insights_transaction):
            totals = orders_insights({'days': '7'})['totals']
        insights_sql = [call.args for call in insights_cursor.execute.call_args_list]

        # The database would return the same aggregate for the same filter; feed the same numbers.
        drill_summaries = {
            'ordered': {'count': 5, 'sum': Decimal('500'), 'profit': Decimal('0')},
            'cancelled': {'count': 2, 'sum': Decimal('0'), 'profit': Decimal('0')},
            'delivered': {'count': 3, 'sum': Decimal('300'), 'profit': Decimal('-105')},
            'profit': {'count': 3, 'sum': Decimal('300'), 'profit': Decimal('-105')},
            'clients': {'new_clients': 2, 'returning_clients': 1},
        }
        results = {}
        for metric, summary in drill_summaries.items():
            cursor = Mock()
            cursor.fetchone.return_value = summary
            cursor.fetchall.return_value = []

            @contextmanager
            def drill_transaction():
                yield cursor

            with patch('backend.v1.admin_api.lambda_function.transaction', drill_transaction):
                results[metric] = (orders_insights_drilldown({'days': '7', 'metric': metric}), cursor)

        self.assertEqual((results['ordered'][0]['summary']['count'], results['ordered'][0]['summary']['sum']),
                         (totals['ordered_count'], totals['ordered_sum']))
        self.assertEqual(results['cancelled'][0]['summary']['count'], totals['cancelled_count'])
        self.assertEqual((results['delivered'][0]['summary']['count'], results['delivered'][0]['summary']['sum']),
                         (totals['delivered_count'], totals['delivered_sum']))
        self.assertEqual(results['profit'][0]['summary']['profit'], totals['profit'])
        self.assertEqual(results['clients'][0]['summary'], {'new_clients': 2, 'returning_clients': 1})

        # Same period start and the same filter fragments as the cards.
        since = insights_sql[2][1][0]
        self.assertEqual(since, period_start(7))
        for metric, (_, cursor) in results.items():
            self.assertEqual(cursor.execute.call_args_list[0].args[1][0], since, metric)
        ordered_card_sql = insights_sql[2][0]
        self.assertIn(admin._CREATED_IN_PERIOD, ordered_card_sql)
        self.assertIn(admin._CREATED_IN_PERIOD, results['ordered'][1].execute.call_args_list[0].args[0])
        self.assertIn(admin._CREATED_IN_PERIOD, results['cancelled'][1].execute.call_args_list[0].args[0])
        self.assertIn(admin._ITEM_TOTALS_JOIN, insights_sql[3][0])
        self.assertIn(admin._ITEM_TOTALS_JOIN, results['profit'][1].execute.call_args_list[0].args[0])
        self.assertEqual(insights_sql[6][0], results['clients'][1].execute.call_args_list[0].args[0])


class ValidationTests(unittest.TestCase):
    def assert_invalid(self, query):
        with self.assertRaises(ContractError) as error:
            orders_insights_drilldown(query)
        self.assertEqual(error.exception.code, 'VALIDATION_ERROR')

    def test_rejects_bad_parameters(self):
        for query in (
            {'metric': 'ordered', 'status': 'pending'},
            {'metric': 'ordered', 'days': '14'},
            {'metric': 'ordered', 'days': 'x'},
            {'metric': 'repeat_medicines'},
            {'metric': 'ordered', 'limit': '101'},
            {'metric': 'ordered', 'limit': '0'},
            {'metric': 'ordered', 'limit': '-1'},
            {'metric': 'ordered', 'limit': 'ten'},
        ):
            with self.subTest(query=query):
                self.assert_invalid(query)

    def test_rejects_malformed_cursors(self):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        old = (datetime.now(timezone.utc) - timedelta(days=400)).isoformat()
        cases = [
            ('ordered', '!!!not-base64'),
            ('ordered', _encode_cursor({'created_at': future})),
            ('ordered', _encode_cursor({'created_at': future, 'id': '5'})),
            ('ordered', _encode_cursor({'created_at': future, 'id': True})),
            ('ordered', _encode_cursor({'created_at': '2026-10-13T00:00:00', 'id': 5})),
            ('ordered', _encode_cursor({'created_at': old, 'id': 5})),
            ('ordered', _encode_cursor({'delivered_at': future, 'id': 5})),
            ('profit', _encode_cursor({'profit': 'NaN', 'id': 5})),
            ('profit', _encode_cursor({'profit': 'abc', 'id': 5})),
            ('profit', _encode_cursor({'profit': -5, 'id': 5})),
            ('clients', _encode_cursor({'first_order_at': 'yesterday', 'id': 5})),
        ]
        for metric, token in cases:
            with self.subTest(metric=metric, token=token):
                self.assert_invalid({'metric': metric, 'cursor': token})


class RoutingTests(unittest.TestCase):
    def test_route_dispatches_to_drilldown_not_get_order(self):
        event = {
            'httpMethod': 'GET', 'path': '/v1/admin/orders/insights/orders',
            'queryStringParameters': {'days': '7', 'metric': 'profit'},
            'requestContext': {'authorizer': {'role': 'admin', 'principalId': 'operator-1'}},
        }
        payload = {'metric': 'profit', 'summary': {}, 'data': [], 'page': {'next_cursor': None, 'has_more': False}}
        with patch.object(admin, 'orders_insights_drilldown', return_value=payload) as drill, \
                patch.object(admin, 'get_order') as get_order:
            response = lambda_handler(event, None)
        self.assertEqual(response['statusCode'], 200)
        drill.assert_called_once_with({'days': '7', 'metric': 'profit'})
        get_order.assert_not_called()
        body = json.loads(response['body'])
        self.assertEqual(body['metric'], 'profit')
        self.assertIn('request_id', body)

    def test_route_requires_admin_authorization(self):
        response = lambda_handler({'httpMethod': 'GET', 'path': '/v1/admin/orders/insights/orders',
                                   'queryStringParameters': {'metric': 'profit'}}, None)
        self.assertEqual(response['statusCode'], 403)

    def test_validation_error_is_400(self):
        response = lambda_handler({
            'httpMethod': 'GET', 'path': '/v1/admin/orders/insights/orders',
            'queryStringParameters': {'metric': 'nope'},
            'requestContext': {'authorizer': {'role': 'admin', 'principalId': 'operator-1'}},
        }, None)
        self.assertEqual(response['statusCode'], 400)
        self.assertEqual(json.loads(response['body'])['error']['code'], 'VALIDATION_ERROR')


if __name__ == '__main__':
    unittest.main()
