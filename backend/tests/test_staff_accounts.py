import json
import os
import unittest
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import Mock, patch

from backend.v1.shared import staff_accounts as staff
from backend.v1.shared.contract import ContractError, validate_staff_order_request
from backend.v1.admin_api.lambda_function import create_staff_order, lambda_handler, list_pharmacy_preparation_orders


class StaffTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'ADMIN_SESSION_SECRET': 'test-session-key-' * 3,
            'STAFF_API_BEARER_TOKEN': 'test-staff-service-' * 3,
            'ADMIN_API_BEARER_TOKEN': 'test-admin-service-' * 3,
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.account = {'account_id': 1, 'username': 'employee_one', 'credential_version': 3,
                        'catalog_access': True, 'password_set': True}
        self.cursor = Mock()

        @contextmanager
        def fake_transaction():
            yield self.cursor

        self.db = patch.object(staff, 'transaction', fake_transaction)
        self.db.start()
        self.addCleanup(self.db.stop)

    def event(self, path, method='GET', token=None, admin=False, body=None):
        headers = {'Authorization': 'Bearer ' + os.environ['ADMIN_API_BEARER_TOKEN' if admin else 'STAFF_API_BEARER_TOKEN']}
        if token:
            headers['x-staff-session'] = token
        return {'path': path, 'httpMethod': method, 'headers': headers, 'body': json.dumps(body or {})}

    def test_hash_is_salted_and_verifies(self):
        password = 'Example-only-strong7!'
        one, two = staff.hash_password(password), staff.hash_password(password)
        self.assertNotEqual(one, two)
        self.assertNotIn(password, one)
        self.assertTrue(staff.verify_password(password, one))
        self.assertFalse(staff.verify_password('wrong', one))
        self.assertFalse(staff.verify_password(password, 'broken'))

    def test_strong_password_and_username_validation(self):
        for value in ('short', 'X' * 129, None):
            with self.assertRaises(ContractError):
                staff.validate_password(value)
        self.assertEqual(staff.validate_password('simple6'), 'simple6')
        for value in ('ab', 'name with spaces', "bad'login", None):
            with self.assertRaises(ContractError):
                staff.username(value)

    def test_valid_session_checks_version_in_database(self):
        self.cursor.fetchone.return_value = self.account
        result = staff.session_account(self.event('/v1/staff/session', token=staff.create_session(self.account)))
        self.assertEqual(result, self.account)
        self.assertEqual(self.cursor.execute.call_args.args[1], (1, 3))

    def test_revoked_session_denied(self):
        self.cursor.fetchone.return_value = None
        response = lambda_handler(self.event('/v1/staff/session', token=staff.create_session(self.account)), None)
        self.assertEqual(response['statusCode'], 401)

    def test_expired_tampered_and_legacy_sessions_denied(self):
        with patch.object(staff.time, 'time', return_value=1):
            expired = staff.create_session(self.account)
        for token in (expired, staff.create_session(self.account) + 'x', 'broken'):
            response = lambda_handler(self.event('/v1/staff/session', token=token), None)
            self.assertEqual(response['statusCode'], 401)
        self.cursor.execute.assert_not_called()

    def test_second_employee_can_authenticate_without_catalog(self):
        second = {**self.account, 'account_id': 2, 'catalog_access': False, 'locked': False,
                  'password_hash': staff.hash_password('Example-only-strong7!')}
        self.cursor.fetchone.return_value = second
        response = lambda_handler(self.event('/v1/staff/login', 'POST', body={'username': 'employee_two', 'password': 'Example-only-strong7!'}), None)
        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(set(json.loads(response['body'])['data']), {'token'})

    def test_pharmacy_employees_cannot_create_orders(self):
        second = {**self.account, 'account_id': 2, 'username': 'vatan_2', 'catalog_access': False}
        payload = {'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                   'landmark': 'напротив школы', 'source': 'phone', 'items': []}
        for account in (self.account, second):
            with self.assertRaises(ContractError) as caught:
                create_staff_order(payload, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', account, 'req_test')
            self.assertEqual(caught.exception.http_status, 403)

    def test_courier_creates_attributed_order_without_medicines(self):
        courier = {**self.account, 'account_id': 3, 'username': 'courier',
                   'catalog_access': False, 'role': 'courier'}
        order_cursor = Mock()
        order_cursor.fetchone.side_effect = [
            {'id': 1},
            {'id': 12, 'public_id': 'ord_test', 'status': 'pending', 'created_at': '2026-10-02T10:00:00Z'},
        ]

        @contextmanager
        def order_transaction():
            yield order_cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', order_transaction):
            response, status, notification = create_staff_order({
                'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                'landmark': 'напротив школы', 'source': 'phone', 'items': [], 'pharmacy_id': 2,
                'comment': 'Позвонить перед выездом',
            }, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', courier, 'req_test')
        self.assertEqual(status, 201)
        self.assertEqual(response['created_by_staff_account_id'], 3)
        self.assertEqual(response['fulfillment_pharmacy_id'], 2)
        self.assertEqual(notification['fulfillment_pharmacy_id'], 2)
        self.assertEqual(notification['comment'], 'Позвонить перед выездом')
        order_insert = next(call for call in order_cursor.execute.call_args_list
                            if 'INSERT INTO orders (' in call.args[0])
        self.assertEqual(order_insert.args[1][4], 'Позвонить перед выездом')
        self.assertNotIn('jsonb_to_recordset', ' '.join(call.args[0] for call in order_cursor.execute.call_args_list))

    def test_courier_creates_pharmacy_two_order_with_manual_medicine(self):
        courier = {**self.account, 'account_id': 3, 'username': 'courier', 'role': 'courier'}
        order_cursor = Mock()
        order_cursor.fetchone.side_effect = [
            {'id': 1}, {'id': 12, 'public_id': 'ord_test', 'status': 'pending',
                        'created_at': '2026-10-11T10:00:00Z'},
        ]

        @contextmanager
        def order_transaction():
            yield order_cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', order_transaction):
            response, _, notification = create_staff_order({
                'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                'landmark': 'школа', 'source': 'phone', 'pharmacy_id': 2, 'items': [],
                'manual_items': [{'medicine_name': 'Витамин X', 'price': '12.50', 'quantity': 2}],
            }, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', courier, 'req_test')
        self.assertEqual(response['order_total'], '25.00')
        self.assertEqual(notification['items'][0]['medicine_id'], None)
        self.assertEqual(notification['items'][0]['medicine_name'], 'Витамин X')
        self.assertNotIn('FROM medicines WHERE', ' '.join(call.args[0] for call in order_cursor.execute.call_args_list))

    def test_courier_can_create_pharmacy_one_order_with_base_price_medicines(self):
        courier = {**self.account, 'account_id': 3, 'username': 'courier', 'role': 'courier'}
        order_cursor = Mock()
        order_cursor.fetchone.side_effect = [
            {'id': 1}, {'id': 12, 'public_id': 'ord_test', 'status': 'pending',
                        'created_at': '2026-10-10T10:00:00Z'},
        ]
        order_cursor.fetchall.return_value = [{
            'id': 44, 'name': 'NOW D3', 'price': '10.00', 'selling_unit_price': 12, 'in_stock': True,
        }]

        @contextmanager
        def order_transaction():
            yield order_cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', order_transaction):
            response, _, notification = create_staff_order({
                'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                'landmark': 'напротив школы', 'source': 'phone', 'pharmacy_id': 1,
                'items': [{'medicine_id': 44, 'quantity': 2}],
            }, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', courier, 'req_test')
        self.assertEqual(response['order_total'], '20.00')
        self.assertEqual(notification['profit'], '0.00')
        self.assertEqual(response['items'][0]['selling_unit_price'], '10.00')

    def test_manual_order_comment_is_optional_and_bounded(self):
        payload = {'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                   'landmark': 'напротив школы', 'source': 'phone', 'items': []}
        self.assertNotIn('comment', validate_staff_order_request(payload))
        self.assertNotIn('comment', validate_staff_order_request({**payload, 'comment': '  '}))
        self.assertEqual(validate_staff_order_request({**payload, 'comment': '  Вход со двора  '})['comment'],
                         'Вход со двора')
        with self.assertRaises(ContractError):
            validate_staff_order_request({**payload, 'comment': 'x' * 501})

    def test_courier_must_choose_pharmacy(self):
        courier = {**self.account, 'account_id': 3}
        base = {'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                'landmark': 'напротив школы', 'source': 'phone', 'items': []}
        with self.assertRaises(ContractError):
            create_staff_order(base, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', courier, 'req_test')

    def test_pharmacy_two_order_uses_catalogue_with_courier_client_price(self):
        courier = {**self.account, 'account_id': 3, 'username': 'courier', 'role': 'courier'}
        order_cursor = Mock()
        order_cursor.fetchone.side_effect = [
            {'id': 1}, {'id': 12, 'public_id': 'ord_test', 'status': 'pending',
                        'created_at': '2026-10-10T10:00:00Z'},
        ]
        order_cursor.fetchall.return_value = [
            {'id': 44, 'name': 'NOW D3', 'price': '10.00', 'selling_unit_price': 12, 'in_stock': True},
            {'id': 45, 'name': 'Omega', 'price': '20.00', 'selling_unit_price': 23, 'in_stock': True},
        ]

        @contextmanager
        def order_transaction():
            yield order_cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', order_transaction):
            response, _, notification = create_staff_order({
                'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                'landmark': 'напротив школы', 'source': 'phone', 'pharmacy_id': 2,
                'items': [{'medicine_id': 44, 'quantity': 2, 'unit_price': '12.5'},
                          {'medicine_id': 45, 'quantity': 1}],
            }, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', courier, 'req_test')
        self.assertEqual(response['fulfillment_pharmacy_id'], 2)
        self.assertEqual(response['items'][0]['selling_unit_price'], '12.50')
        self.assertEqual(response['items'][0]['base_unit_price'], '10.00')
        self.assertEqual(response['items'][1]['selling_unit_price'], '20.00')
        self.assertEqual(response['order_total'], '45.00')
        self.assertEqual(notification['profit'], '5.00')

    def test_staff_order_item_price_is_validated(self):
        base = {'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                'landmark': 'напротив школы', 'source': 'phone'}
        self.assertEqual(validate_staff_order_request({**base, 'items': [
            {'medicine_id': 44, 'quantity': 1, 'unit_price': 7}]})['items'][0]['unit_price'], '7.00')
        for price in ('0', 'x', '1.001', None):
            with self.assertRaises(ContractError):
                validate_staff_order_request({**base, 'items': [{'medicine_id': 44, 'quantity': 1, 'unit_price': price}]})

    def test_employee_without_catalog_cannot_read_catalog(self):
        without_catalog = {**self.account, 'account_id': 1, 'catalog_access': False}
        self.cursor.fetchone.return_value = without_catalog
        for path in ('/v1/staff/medicines', '/v1/staff/catalog/stats'):
            with patch('backend.v1.admin_api.lambda_function.list_medicines') as medicines:
                response = lambda_handler(self.event(path, token=staff.create_session(without_catalog)), None)
                self.assertEqual(response['statusCode'], 403)
                medicines.assert_not_called()

    def test_courier_can_search_order_medicines_but_not_catalog(self):
        courier = {**self.account, 'account_id': 3, 'catalog_access': False, 'role': 'courier'}
        self.cursor.fetchone.return_value = courier
        token = staff.create_session(courier)
        for path in ('/v1/staff/medicines', '/v1/staff/catalog/stats'):
            response = lambda_handler(self.event(path, token=token), None)
            self.assertEqual(response['statusCode'], 403)
        with patch('backend.v1.admin_api.lambda_function.search_staff_order_medicines',
                   return_value={'data': [], 'page': {}}):
            response = lambda_handler(self.event('/v1/staff/order-medicines', token=token), None)
        self.assertEqual(response['statusCode'], 200)

    def test_pharmacy_only_sees_own_website_preparation_orders(self):
        from datetime import datetime, timezone
        order_cursor = Mock()
        order_cursor.fetchall.return_value = [{
            'id': 12, 'public_id': 'ord_test', 'order_reference': '3456-012',
            'status': 'pending', 'created_at': datetime(2026, 10, 10, tzinfo=timezone.utc),
            'notes': None, 'customer_name': 'Клиент', 'phone': 'SECRET',
            'address': 'SECRET-ADDRESS', 'landmark': None, 'order_source': None, 'utm_source': None,
            'order_total': Decimal('120'), 'base_total': Decimal('100'),
            'created_by_staff_account_id': None,
            'medicines': [{'medicine_name': 'NOW D3', 'quantity': 2}],
        }]
        order_cursor.fetchone.return_value = {'courier_enabled': True, 'policies': {}, 'revision': 1}

        @contextmanager
        def order_transaction():
            yield order_cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', order_transaction):
            result = list_pharmacy_preparation_orders({}, 1)
        self.assertEqual(result['data'][0]['medicines'][0]['medicine_name'], 'NOW D3')
        self.assertNotIn('phone', result['data'][0])
        self.assertNotIn('customer_name', result['data'][0])
        self.assertNotIn('profit', result['data'][0])
        sql, args = order_cursor.execute.call_args_list[-2].args
        self.assertIn('o.created_by_staff_account_id IS NULL', sql)
        self.assertIn('COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1) = %s', sql)
        self.assertEqual(args, (1, 1, 1, 1, 1, 1, 21))
        self.assertIn('o.phone', sql)

    def test_pharmacy_web_policy_is_enforced_by_lambda(self):
        from datetime import datetime, timezone
        from backend.v1.shared.order_notification_settings import default_policies
        policies = default_policies()
        policies['pharmacy_web']['phone'] = True
        policies['pharmacy_web']['items'] = False
        policies['pharmacy_web']['status'] = False
        cursor = Mock()
        cursor.fetchall.return_value = [{
            'id': 12, 'public_id': 'ord_test', 'order_reference': '3456-012',
            'status': 'pending', 'created_at': datetime(2026, 10, 10, tzinfo=timezone.utc),
            'notes': 'NOTE', 'customer_name': 'PRIVATE', 'phone': '+992917123456',
            'address': 'PRIVATE ADDRESS', 'landmark': None, 'order_source': None, 'utm_source': None,
            'order_total': Decimal('120'), 'base_total': Decimal('100'),
            'created_by_staff_account_id': None,
            'medicines': [{'medicine_name': 'NOW D3', 'quantity': 2}],
        }]
        cursor.fetchone.return_value = {'courier_enabled': True, 'policies': policies, 'revision': 1}
        @contextmanager
        def order_transaction():
            yield cursor
        with patch('backend.v1.admin_api.lambda_function.transaction', order_transaction):
            row = list_pharmacy_preparation_orders({}, 1)['data'][0]
        self.assertEqual(row['phone'], '+992917123456')
        self.assertNotIn('medicines', row)
        self.assertNotIn('status', row)
        self.assertNotIn('customer_name', row)

    def _pharmacy_rows(self, policies=None, status='pending', pharmacy_id=1, query=None, extra=None):
        from datetime import datetime, timezone
        cursor = Mock()
        cursor.fetchall.return_value = [{
            'id': 12, 'public_id': 'ord_test', 'order_reference': '3456-012',
            'status': status, 'created_at': datetime(2026, 10, 10, 8, 30, tzinfo=timezone.utc),
            'notes': None, 'customer_name': 'PRIVATE', 'phone': '+992917123456',
            'address': 'PRIVATE ADDRESS', 'landmark': 'PRIVATE LANDMARK', 'order_source': None,
            'utm_source': None, 'order_total': Decimal('120.00'), 'base_total': Decimal('100.00'),
            'created_by_staff_account_id': None,
            'medicines': [{'order_item_id': 81, 'medicine_name': 'NOW D3', 'quantity': 2, 'line_total': 120,
                           'base_unit_price': '50.00', 'base_line_total': '100.00',
                           'my_answer': None, 'my_problem': None}],
            'unanswered_count': 1, 'unanswered_unrouted': True, 'unanswered_routed_since': None,
            'routed_away_count': 0, **(extra or {}),
        }]
        cursor.fetchone.return_value = {'courier_enabled': True, 'policies': policies or {}, 'revision': 1}

        @contextmanager
        def order_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', order_transaction):
            result = list_pharmacy_preparation_orders(query or {}, pharmacy_id)
        return result, cursor

    def test_pharmacy_default_row_has_base_prices_and_waiting_fields_only(self):
        result, cursor = self._pharmacy_rows()
        row = result['data'][0]
        for key in ('order_reference', 'created_at', 'status', 'waiting_since', 'awaiting_response', 'base_total'):
            self.assertIn(key, row)
        self.assertEqual(row['base_total'], Decimal('100.00'))
        self.assertEqual(row['waiting_since'], row['created_at'])
        self.assertEqual(row['created_at'], '2026-10-10T08:30:00+00:00')
        item = row['medicines'][0]
        self.assertEqual(item['medicine_name'], 'NOW D3')
        self.assertEqual(item['quantity'], 2)
        self.assertEqual(item['base_unit_price'], '50.00')
        self.assertEqual(item['base_line_total'], '100.00')
        self.assertNotIn('line_total', item)
        for key in ('customer_name', 'phone', 'address', 'landmark', 'order_total', 'line_total',
                    'profit', 'created_by_staff_account_id'):
            self.assertNotIn(key, row)
        sql = cursor.execute.call_args_list[-2].args[0]
        self.assertIn("'base_unit_price', COALESCE(oi.base_unit_price, oi.price)::text", sql)

    def test_pharmacy_awaiting_response_follows_pending_status(self):
        self.assertTrue(self._pharmacy_rows(status='pending')[0]['data'][0]['awaiting_response'])
        self.assertFalse(self._pharmacy_rows(status='confirmed')[0]['data'][0]['awaiting_response'])

    def test_pharmacy_queue_sql_uses_effective_item_assignment(self):
        _, cursor = self._pharmacy_rows()
        sql, args = cursor.execute.call_args_list[-2].args
        effective = 'COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)'
        # Items: only those effectively assigned to this pharmacy; base_total summed over them only.
        self.assertIn(f'WHERE oi.order_id = o.id AND {effective} = %s', sql)
        # Orders: at least one item effectively assigned to this pharmacy.
        self.assertIn('AND EXISTS (SELECT 1 FROM order_items oi', sql)
        self.assertIn(f'WHERE oi.order_id = o.id AND {effective} = %s)', sql)
        # Routed-away items: answered by this pharmacy and now assigned elsewhere.
        self.assertIn(f'WHERE oi.order_id = o.id AND {effective} <> %s', sql)
        self.assertIn('mine.pharmacy_id = %s', sql)
        self.assertIn("'order_item_id', oi.id", sql)
        self.assertIn("'my_answer', mine.answer, 'my_problem', mine.problem", sql)
        self.assertNotIn('COALESCE(o.fulfillment_pharmacy_id, 1) = %s', sql)
        self.assertEqual(args, (1, 1, 1, 1, 1, 1, 21))

    def test_pharmacy_item_fields_and_routed_away_count(self):
        row = self._pharmacy_rows(extra={'routed_away_count': 1})[0]['data'][0]
        self.assertEqual(row['routed_away_count'], 1)
        item = row['medicines'][0]
        self.assertEqual((item['order_item_id'], item['my_answer'], item['my_problem']), (81, None, None))
        for key in ('unanswered_count', 'unanswered_unrouted', 'unanswered_routed_since'):
            self.assertNotIn(key, row)

    def test_pharmacy_awaiting_response_follows_unanswered_items(self):
        one_open = self._pharmacy_rows(extra={'unanswered_count': 1})[0]['data'][0]
        self.assertTrue(one_open['awaiting_response'])
        all_answered = self._pharmacy_rows(extra={
            'unanswered_count': 0, 'unanswered_unrouted': None, 'unanswered_routed_since': None})[0]['data'][0]
        self.assertFalse(all_answered['awaiting_response'])
        self.assertEqual(all_answered['waiting_since'], all_answered['created_at'])
        self.assertFalse(self._pharmacy_rows(status='confirmed')[0]['data'][0]['awaiting_response'])

    def test_pharmacy_waiting_since_uses_routing_time_for_routed_items(self):
        from datetime import datetime, timezone
        routed_at = datetime(2026, 10, 10, 9, 15, tzinfo=timezone.utc)
        row = self._pharmacy_rows(pharmacy_id=2, extra={
            'unanswered_count': 1, 'unanswered_unrouted': False, 'unanswered_routed_since': routed_at,
        })[0]['data'][0]
        self.assertTrue(row['awaiting_response'])
        self.assertEqual(row['waiting_since'], '2026-10-10T09:15:00+00:00')
        self.assertEqual(row['created_at'], '2026-10-10T08:30:00+00:00')
        # An unanswered item that was never routed keeps the order creation time.
        mixed = self._pharmacy_rows(pharmacy_id=2, extra={
            'unanswered_count': 2, 'unanswered_unrouted': True, 'unanswered_routed_since': routed_at,
        })[0]['data'][0]
        self.assertEqual(mixed['waiting_since'], mixed['created_at'])

    def test_pharmacy_price_fields_hidden_when_policy_disables_them(self):
        from backend.v1.shared.order_notification_settings import default_policies
        policies = default_policies()
        policies['pharmacy_web']['item_base_total'] = False
        policies['pharmacy_web']['base_total'] = False
        row = self._pharmacy_rows(policies=policies)[0]['data'][0]
        self.assertNotIn('base_total', row)
        self.assertNotIn('base_unit_price', row['medicines'][0])
        self.assertNotIn('base_line_total', row['medicines'][0])
        self.assertIn('quantity', row['medicines'][0])
        self.assertIn('waiting_since', row)
        self.assertIn('awaiting_response', row)

    def test_pharmacy_client_fields_returned_when_owner_turns_them_on(self):
        from backend.v1.shared.order_notification_settings import FIELDS
        policies = {'pharmacy_web': {field: True for field in FIELDS}}
        row = self._pharmacy_rows(policies=policies)[0]['data'][0]
        self.assertEqual(row['customer_name'], 'PRIVATE')
        self.assertEqual(row['phone'], '+992917123456')
        self.assertEqual(row['address'], 'PRIVATE ADDRESS')
        self.assertEqual(row['landmark'], 'PRIVATE LANDMARK')
        self.assertEqual(row['order_total'], Decimal('120.00'))
        self.assertEqual(row['profit'], Decimal('20.00'))
        self.assertIn('created_by_staff_account_id', row)
        self.assertEqual(row['source'], 'Сайт')
        self.assertEqual(row['medicines'][0]['line_total'], 120)

    # --- job 011: assembly marks in the pharmacy queue ------------------------------------

    def test_pharmacy_queue_assembly_fields(self):
        cases = [
            # (status, assemblable_count, assembly_state) -> (assembly_state, assembly_available)
            (('pending', 1, None), (None, False)),
            (('confirmed', 1, None), (None, True)),
            (('confirmed', 2, 'assembling'), ('assembling', True)),
            (('confirmed', 1, 'assembled'), ('assembled', True)),
            (('confirmed', 0, None), (None, False)),  # only «Нет в наличии» items: nothing to assemble
        ]
        for (status, assemblable, state), expected in cases:
            with self.subTest(status=status, assemblable=assemblable, state=state):
                row = self._pharmacy_rows(status=status, extra={
                    'assemblable_count': assemblable, 'assembly_state': state})[0]['data'][0]
                self.assertEqual((row['assembly_state'], row['assembly_available']), expected)
                self.assertNotIn('assemblable_count', row)

    def test_pharmacy_queue_assembly_fields_survive_all_off_policy(self):
        from backend.v1.shared.order_notification_settings import FIELDS
        policies = {'pharmacy_web': {field: False for field in FIELDS}}
        row = self._pharmacy_rows(policies=policies, status='confirmed', extra={
            'assemblable_count': 1, 'assembly_state': 'assembling'})[0]['data'][0]
        self.assertNotIn('status', row)
        self.assertEqual(row['assembly_state'], 'assembling')
        self.assertIs(row['assembly_available'], True)
        for key in ('routed_away_count', 'awaiting_response', 'waiting_since'):
            self.assertIn(key, row)

    def test_pharmacy_queue_old_rows_default_assembly_fields(self):
        row = self._pharmacy_rows(status='confirmed')[0]['data'][0]
        self.assertIsNone(row['assembly_state'])
        self.assertIs(row['assembly_available'], False)

    def test_pharmacy_queue_sql_reads_own_assembly_mark(self):
        _, cursor = self._pharmacy_rows(pharmacy_id=2)
        sql, args = cursor.execute.call_args_list[-2].args
        self.assertIn('LEFT JOIN order_pharmacy_assembly asm ON asm.order_id = o.id AND asm.pharmacy_id = %s', sql)
        self.assertIn("COUNT(*) FILTER (WHERE mine.answer IS DISTINCT FROM 'unavailable') AS assemblable_count", sql)
        self.assertEqual(args, (2, 2, 2, 2, 2, 2, 21))

    def test_pharmacy_two_queue_is_scoped_by_session_account(self):
        _, cursor = self._pharmacy_rows(pharmacy_id=2)
        sql, args = cursor.execute.call_args_list[-2].args
        self.assertIn('COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1) = %s', sql)
        self.assertEqual(args, (2, 2, 2, 2, 2, 2, 21))
        pharmacy_two = {**self.account, 'account_id': 2, 'catalog_access': False}
        self.cursor.fetchone.return_value = pharmacy_two
        with patch('backend.v1.admin_api.lambda_function.list_pharmacy_preparation_orders',
                   return_value={'data': [], 'page': {'has_more': False, 'next_cursor': None}}) as preparation:
            response = lambda_handler(self.event('/v1/staff/orders', token=staff.create_session(pharmacy_two)), None)
        self.assertEqual(response['statusCode'], 200)
        preparation.assert_called_once_with({}, 2)
        for key in ('pharmacy_id', 'account_id'):
            with self.assertRaises(ContractError) as raised:
                list_pharmacy_preparation_orders({key: '1'}, 2)
            self.assertEqual(raised.exception.code, 'VALIDATION_ERROR')
            event = self.event('/v1/staff/orders', token=staff.create_session(pharmacy_two))
            event['queryStringParameters'] = {key: '1'}
            response = lambda_handler(event, None)
            self.assertEqual(response['statusCode'], 400)
            self.assertIn('VALIDATION_ERROR', response['body'])

    def test_pharmacy_reads_preparation_list_but_cannot_change_status(self):
        courier = {**self.account, 'account_id': 3, 'catalog_access': False, 'role': 'courier'}
        self.cursor.fetchone.return_value = self.account
        with patch('backend.v1.admin_api.lambda_function.list_pharmacy_preparation_orders',
                   return_value={'data': [], 'page': {'has_more': False, 'next_cursor': None}}) as preparation:
            response = lambda_handler(self.event('/v1/staff/orders', token=staff.create_session(self.account)), None)
        self.assertEqual(response['statusCode'], 200)
        preparation.assert_called_once_with({}, 1)
        self.cursor.fetchone.return_value = courier
        with patch('backend.v1.admin_api.lambda_function.list_courier_orders',
                   return_value={'data': [], 'page': {'has_more': False, 'next_cursor': None}}):
            response = lambda_handler(self.event('/v1/staff/orders', token=staff.create_session(courier)), None)
            self.assertEqual(response['statusCode'], 200)
        path = '/v1/staff/orders/ord_' + 'a' * 32 + '/status'
        self.cursor.fetchone.return_value = self.account
        response = lambda_handler(self.event(path, 'PATCH', token=staff.create_session(self.account),
                                           body={'status': 'confirmed', 'expected_current_status': 'pending'}), None)
        self.assertEqual(response['statusCode'], 403)

    def test_only_courier_can_add_items_to_existing_order(self):
        path = '/v1/staff/orders/ord_' + 'a' * 32 + '/items'
        self.cursor.fetchone.return_value = self.account
        response = lambda_handler(self.event(path, 'POST', token=staff.create_session(self.account),
            body={'items': [{'medicine_id': 44, 'quantity': 1}]}), None)
        self.assertEqual(response['statusCode'], 403)
        courier = {**self.account, 'account_id': 3, 'role': 'courier'}
        self.cursor.fetchone.return_value = courier
        with patch('backend.v1.admin_api.lambda_function.add_courier_order_items',
                   return_value={'order_id': 'ord_' + 'a' * 32}) as add_items:
            response = lambda_handler(self.event(path, 'POST', token=staff.create_session(courier),
                body={'items': [{'medicine_id': 44, 'quantity': 1}]}), None)
        self.assertEqual(response['statusCode'], 200)
        add_items.assert_called_once()

    def test_only_courier_can_tick_checklist(self):
        path = '/v1/staff/orders/ord_' + 'a' * 32 + '/checklist'
        body = {'step': 2, 'done': True}
        self.cursor.fetchone.return_value = self.account
        with patch('backend.v1.admin_api.lambda_function.update_courier_order_checklist') as update:
            response = lambda_handler(self.event(path, 'PATCH', token=staff.create_session(self.account), body=body), None)
        self.assertEqual(response['statusCode'], 403)
        update.assert_not_called()
        courier = {**self.account, 'account_id': 3, 'role': 'courier'}
        self.cursor.fetchone.return_value = courier
        with patch('backend.v1.admin_api.lambda_function.update_courier_order_checklist',
                   return_value={'order_id': 'ord_' + 'a' * 32, 'checklist_steps': [2]}) as update:
            response = lambda_handler(self.event(path, 'PATCH', token=staff.create_session(courier), body=body), None)
        self.assertEqual(response['statusCode'], 200)
        update.assert_called_once()
        self.assertEqual(update.call_args.args[:2], ('ord_' + 'a' * 32, body))

    def test_employee_with_catalog_can_read_catalog(self):
        with_catalog = {**self.account, 'account_id': 2, 'catalog_access': True}
        self.cursor.fetchone.return_value = with_catalog
        with patch('backend.v1.admin_api.lambda_function.list_medicines', return_value={'data': [], 'page': {}}) as medicines:
            response = lambda_handler(self.event('/v1/staff/medicines', token=staff.create_session(with_catalog)), None)
            self.assertEqual(response['statusCode'], 200)
            medicines.assert_called_once()

    def test_staff_service_cannot_access_admin_or_mutate(self):
        for path, method in (('/v1/admin/staff', 'GET'), ('/v1/admin/staff/1', 'PATCH'), ('/v1/admin/orders', 'GET')):
            response = lambda_handler(self.event(path, method, token=staff.create_session(self.account)), None)
            self.assertEqual(response['statusCode'], 403)
        response = lambda_handler(self.event('/v1/staff/medicines', 'PATCH', token=staff.create_session(self.account)), None)
        self.assertEqual(response['statusCode'], 404)
        self.cursor.execute.assert_not_called()

    def test_api_key_alone_cannot_login(self):
        response = lambda_handler({'path': '/v1/staff/login', 'httpMethod': 'POST', 'headers': {'x-api-key': 'not-auth'}}, None)
        self.assertEqual(response['statusCode'], 403)

    def test_derived_service_token_works_without_extra_vercel_variable(self):
        self.cursor.fetchone.return_value = self.account
        with patch.dict(os.environ, {'STAFF_API_BEARER_TOKEN': ''}):
            event = self.event('/v1/staff/session', token=staff.create_session(self.account))
            event['headers']['Authorization'] = 'Bearer ' + staff._derived_service_token()
            response = lambda_handler(event, None)
        self.assertEqual(response['statusCode'], 200)

    def test_shared_admin_and_staff_service_credential_is_rejected(self):
        with patch.dict(os.environ, {'STAFF_API_BEARER_TOKEN': os.environ['ADMIN_API_BEARER_TOKEN']}):
            response = lambda_handler(self.event('/v1/staff/login', 'POST'), None)
            self.assertEqual(response['statusCode'], 403)

    def test_admin_list_never_selects_hash(self):
        self.cursor.fetchall.return_value = [self.account]
        response = lambda_handler(self.event('/v1/admin/staff', admin=True), None)
        self.assertEqual(response['statusCode'], 200)
        self.assertIn('password_hash IS NOT NULL AS password_set', self.cursor.execute.call_args.args[0])
        self.assertNotIn('password_hash', response['body'])

    def test_update_increments_version_and_audits_no_secrets(self):
        self.cursor.fetchone.side_effect = [{'username': 'before'}, self.account]
        audit = Mock()
        staff.update_account(1, {'username': 'after', 'password': 'Example-only-strong7!'}, 'admin', 'request', audit)
        sql, args = self.cursor.execute.call_args.args
        self.assertIn('credential_version = credential_version + 1', sql)
        self.assertTrue(staff.verify_password('Example-only-strong7!', args[1]))
        self.assertEqual(audit.call_args.kwargs['details'], {'username_changed': True, 'password_changed': True})
        self.assertNotIn('Example-only-strong7!', str(audit.call_args))
        self.assertNotIn('pbkdf2', str(audit.call_args))

    def test_username_only_does_not_replace_password(self):
        self.cursor.fetchone.side_effect = [{'username': 'before'}, self.account]
        staff.update_account(1, {'username': 'after'}, 'admin', 'request', Mock())
        self.assertIsNone(self.cursor.execute.call_args.args[1][1])

    def test_reject_permission_changes_and_unknown_account(self):
        for account_id, payload in ((4, {'username': 'fourth'}), (2, {'catalog_access': True}), (1, {'password': ''})):
            with self.assertRaises(ContractError):
                staff.update_account(account_id, payload, 'admin', 'request', Mock())
        self.cursor.execute.assert_not_called()

    def test_database_uniqueness_conflict_returns_409(self):
        import psycopg2
        self.cursor.execute.side_effect = psycopg2.IntegrityError('private database details')
        response = lambda_handler(self.event('/v1/admin/staff/1', 'PATCH', admin=True, body={'username': 'duplicate'}), None)
        self.assertEqual(response['statusCode'], 409)
        self.assertNotIn('private', response['body'])

    def test_failed_login_persists_counter(self):
        self.cursor.fetchone.return_value = {**self.account, 'locked': False, 'password_hash': staff.hash_password('Example-only-strong7!')}
        with self.assertRaises(ContractError):
            staff.login({'username': 'employee_one', 'password': 'wrong'})
        self.assertIn('failed_attempts + 1', self.cursor.execute.call_args.args[0])

    def test_locked_account_rejects_even_correct_password(self):
        self.cursor.fetchone.return_value = {**self.account, 'locked': True}
        with self.assertRaises(ContractError) as error:
            staff.login({'username': 'employee_one', 'password': 'Example-only-strong7!'})
        self.assertEqual(error.exception.http_status, 429)


if __name__ == '__main__':
    unittest.main()
