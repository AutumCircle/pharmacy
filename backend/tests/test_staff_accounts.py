import json
import os
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

from backend.v1.shared import staff_accounts as staff
from backend.v1.shared.contract import ContractError
from backend.v1.admin_api.lambda_function import create_staff_order, lambda_handler


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

    def test_second_employee_can_create_manual_order_without_catalog(self):
        second = {**self.account, 'account_id': 2, 'username': 'vatan_2', 'catalog_access': False}
        order_cursor = Mock()
        order_cursor.fetchone.side_effect = [
            {'id': 1},
            {'id': 12, 'public_id': 'ord_test', 'status': 'pending', 'created_at': '2026-09-28T10:00:00Z'},
        ]
        order_cursor.fetchall.return_value = [{
            'id': 44, 'name': 'Test medicine', 'price': '10.00',
            'selling_unit_price': 11, 'in_stock': True,
        }]

        @contextmanager
        def order_transaction():
            yield order_cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', order_transaction):
            response, status, notification = create_staff_order({
                'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                'landmark': 'напротив школы', 'source': 'phone',
                'items': [{'medicine_id': 44, 'quantity': 2}],
            }, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', second, 'req_test')
        self.assertEqual(status, 201)
        self.assertEqual(response['created_by_staff_account_id'], 2)
        self.assertEqual(notification['created_by_staff_username'], 'vatan_2')
        sql_calls = ' '.join(call.args[0] for call in order_cursor.execute.call_args_list)
        self.assertIn('created_by_staff_account_id', sql_calls)
        self.assertIn('jsonb_to_recordset', sql_calls)
        self.assertIn('staff.order.created', str(order_cursor.execute.call_args_list))

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
            }, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', courier, 'req_test')
        self.assertEqual(status, 201)
        self.assertEqual(response['created_by_staff_account_id'], 3)
        self.assertEqual(response['fulfillment_pharmacy_id'], 2)
        self.assertEqual(notification['fulfillment_pharmacy_id'], 2)
        self.assertNotIn('jsonb_to_recordset', ' '.join(call.args[0] for call in order_cursor.execute.call_args_list))

    def test_courier_cannot_add_medicines_or_skip_pharmacy(self):
        courier = {**self.account, 'account_id': 3}
        base = {'customer_name': '', 'phone': '917123456', 'address': 'Айни 29',
                'landmark': 'напротив школы', 'source': 'phone', 'items': []}
        for payload in (base, {**base, 'pharmacy_id': 1, 'items': [{'medicine_id': 44, 'quantity': 1}]}):
            with self.assertRaises(ContractError):
                create_staff_order(payload, '2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32', courier, 'req_test')

    def test_employee_without_catalog_cannot_read_catalog(self):
        without_catalog = {**self.account, 'account_id': 1, 'catalog_access': False}
        self.cursor.fetchone.return_value = without_catalog
        for path in ('/v1/staff/medicines', '/v1/staff/catalog/stats'):
            with patch('backend.v1.admin_api.lambda_function.list_medicines') as medicines:
                response = lambda_handler(self.event(path, token=staff.create_session(without_catalog)), None)
                self.assertEqual(response['statusCode'], 403)
                medicines.assert_not_called()

    def test_courier_cannot_read_catalog_or_medicine_picker(self):
        courier = {**self.account, 'account_id': 3, 'catalog_access': False, 'role': 'courier'}
        self.cursor.fetchone.return_value = courier
        token = staff.create_session(courier)
        for path in ('/v1/staff/medicines', '/v1/staff/catalog/stats', '/v1/staff/order-medicines'):
            response = lambda_handler(self.event(path, token=token), None)
            self.assertEqual(response['statusCode'], 403)

    def test_only_courier_can_list_and_change_order_status(self):
        courier = {**self.account, 'account_id': 3, 'catalog_access': False, 'role': 'courier'}
        self.cursor.fetchone.return_value = self.account
        response = lambda_handler(self.event('/v1/staff/orders', token=staff.create_session(self.account)), None)
        self.assertEqual(response['statusCode'], 403)
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
