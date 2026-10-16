"""Job 011: pharmacy assembly marks «Начать сборку» / «Собран» per (order, pharmacy)."""
import json
import os
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import lambda_handler, mark_pharmacy_assembly, validate_assembly_request
from backend.v1.shared import staff_accounts as staff
from backend.v1.shared.contract import ContractError

ORDER_ID = 'ord_' + 'b' * 32
CONFIRMED = {'id': 9, 'status': 'confirmed', 'created_by_staff_account_id': None, 'fulfillment_pharmacy_id': None}
STARTED = datetime(2026, 10, 16, 8, 0, tzinfo=timezone.utc)
DONE = datetime(2026, 10, 16, 8, 20, tzinfo=timezone.utc)


def counts(assigned=2, assemblable=2):
    return {'assigned_count': assigned, 'assemblable_count': assemblable}


def mark(state):
    return {'state': state, 'started_at': STARTED, 'assembled_at': DONE if state == 'assembled' else None}


class PharmacyAssemblyTests(unittest.TestCase):
    def _run(self, state, pharmacy_id=1, order=None, item_counts=None, current=None, saved=None):
        cursor = self.last_cursor = Mock()
        sequence = [dict(CONFIRMED) if order is None else order,
                    counts() if item_counts is None else item_counts,
                    current,
                    saved if saved is not None else mark(state)]
        cursor.fetchone.side_effect = sequence

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            result = mark_pharmacy_assembly(ORDER_ID, {'state': state} if isinstance(state, str) else state,
                                            pharmacy_id, 'req_test')
        return result, cursor

    def _error(self, state, **kwargs):
        self.last_cursor = None
        with self.assertRaises(ContractError) as raised:
            self._run(state, **kwargs)
        if self.last_cursor is not None:
            self._assert_no_writes(self.last_cursor)
        return raised.exception

    @staticmethod
    def _statements(cursor):
        return [call.args[0] for call in cursor.execute.call_args_list]

    def _assert_no_writes(self, cursor):
        for sql in self._statements(cursor):
            self.assertTrue(sql.lstrip().startswith('SELECT'), sql)

    def _assert_never_touches_status(self, cursor):
        joined = ' '.join(self._statements(cursor))
        self.assertNotIn('UPDATE orders', joined)
        self.assertNotIn('order_status_history', joined)
        self.assertNotIn('UPDATE order_items', joined)

    # --- validation --------------------------------------------------------------------

    def test_body_validation_rejects_everything_but_exact_state(self):
        bad = [None, [], {}, ['assembling'], {'state': None}, {'state': ''}, {'state': 'waiting'},
               {'state': 'ASSEMBLED'}, {'state': 1}, {'state': ['assembled']},
               {'state': 'assembled', 'pharmacy_id': 2}, {'state': 'assembling', 'extra': 1},
               {'pharmacy_id': 1}, {'status': 'assembled'}]
        for payload in bad:
            with self.subTest(payload=payload):
                exception = self._error(payload)
                self.assertEqual((exception.code, exception.http_status), ('VALIDATION_ERROR', 400))
                # Validation happens before any database access.
                self.assertIsNone(self.last_cursor.execute.call_args)
        with self.assertRaises(ContractError):
            validate_assembly_request('assembling')
        self.assertEqual(validate_assembly_request({'state': 'assembling'}), 'assembling')
        self.assertEqual(validate_assembly_request({'state': 'assembled'}), 'assembled')

    def test_non_pharmacy_account_is_forbidden(self):
        exception = self._error('assembling', pharmacy_id=3)
        self.assertEqual((exception.code, exception.http_status), ('FORBIDDEN', 403))

    # --- authorization / state ------------------------------------------------------------

    def test_missing_deleted_and_non_website_orders_are_404(self):
        for order in (None, {**CONFIRMED, 'created_by_staff_account_id': 3},
                      {**CONFIRMED, 'created_by_staff_account_id': 1}):
            with self.subTest(order=order):
                cursor = Mock()
                cursor.fetchone.return_value = order

                @contextmanager
                def fake_transaction():
                    yield cursor

                with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction), \
                        self.assertRaises(ContractError) as raised:
                    mark_pharmacy_assembly(ORDER_ID, {'state': 'assembling'}, 1, 'req')
                self.assertEqual((raised.exception.code, raised.exception.http_status), ('ORDER_NOT_FOUND', 404))
                self.assertEqual(cursor.execute.call_count, 1)
                self.assertIn('deleted_at IS NULL', cursor.execute.call_args.args[0])

    def test_order_without_items_of_this_pharmacy_is_404(self):
        exception = self._error('assembling', pharmacy_id=2, item_counts=counts(0, 0))
        self.assertEqual((exception.code, exception.http_status), ('ORDER_NOT_FOUND', 404))

    def test_only_confirmed_orders_accept_marks(self):
        for status in ('pending', 'delivering', 'delivered', 'cancelled'):
            with self.subTest(status=status):
                exception = self._error('assembling', order={**CONFIRMED, 'status': status})
                self.assertEqual((exception.code, exception.http_status), ('ORDER_STATUS_CONFLICT', 409))
                self.assertEqual(str(exception), 'Сборка доступна после согласования заказа')

    def test_all_items_unavailable_is_nothing_to_assemble(self):
        exception = self._error('assembling', pharmacy_id=2, item_counts=counts(2, 0))
        self.assertEqual(exception.http_status, 409)
        self.assertEqual(str(exception), 'Нечего собирать')

    def test_skip_and_backward_transitions_are_409(self):
        for current, target in ((None, 'assembled'), ('assembled', 'assembling')):
            with self.subTest(current=current, target=target):
                exception = self._error(target, current=mark(current) if current else None)
                self.assertEqual((exception.code, exception.http_status), ('ASSEMBLY_STATE_CONFLICT', 409))

    def test_order_row_is_locked_and_items_read_with_effective_assignment(self):
        _, cursor = self._run('assembling')
        first, second, third = cursor.execute.call_args_list[:3]
        self.assertIn('FOR UPDATE', first.args[0])
        self.assertIn('deleted_at IS NULL', first.args[0])
        self.assertEqual(first.args[1], (ORDER_ID,))
        self.assertIn('COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1) = %s', second.args[0])
        self.assertIn("COUNT(*) FILTER (WHERE mine.answer IS DISTINCT FROM 'unavailable')", second.args[0])
        self.assertEqual(second.args[1], (1, 9, 1))
        self.assertIn('FROM order_pharmacy_assembly', third.args[0])
        self.assertIn('FOR UPDATE', third.args[0])
        self.assertEqual(third.args[1], (9, 1))

    # --- writes, idempotency, audit ---------------------------------------------------------

    def test_start_then_assembled_upserts_session_pharmacy_row(self):
        result, cursor = self._run('assembling', pharmacy_id=2)
        upsert = next(call for call in cursor.execute.call_args_list
                      if 'INSERT INTO order_pharmacy_assembly' in call.args[0])
        self.assertIn('ON CONFLICT (order_id, pharmacy_id) DO UPDATE', upsert.args[0])
        self.assertIn("CASE WHEN %s = 'assembled' THEN now() END", upsert.args[0])
        self.assertEqual(upsert.args[1], (9, 2, 'assembling', 'assembling', 'staff:2'))
        self.assertEqual(result, {'order_id': ORDER_ID, 'pharmacy_id': 2, 'state': 'assembling',
                                  'started_at': '2026-10-16T08:00:00+00:00', 'assembled_at': None})
        self._assert_never_touches_status(cursor)

        result, cursor = self._run('assembled', pharmacy_id=2, current=mark('assembling'))
        upsert = next(call for call in cursor.execute.call_args_list
                      if 'INSERT INTO order_pharmacy_assembly' in call.args[0])
        self.assertEqual(upsert.args[1], (9, 2, 'assembled', 'assembled', 'staff:2'))
        self.assertIn('assembled_at = EXCLUDED.assembled_at', upsert.args[0])
        self.assertEqual(result['state'], 'assembled')
        self.assertEqual(result['assembled_at'], '2026-10-16T08:20:00+00:00')
        self._assert_never_touches_status(cursor)

    def test_pharmacy_id_comes_from_session_only(self):
        for pharmacy_id in (1, 2):
            with self.subTest(pharmacy_id=pharmacy_id):
                result, cursor = self._run('assembling', pharmacy_id=pharmacy_id)
                upsert = next(call for call in cursor.execute.call_args_list
                              if 'INSERT INTO order_pharmacy_assembly' in call.args[0])
                self.assertEqual(upsert.args[1][1], pharmacy_id)
                self.assertEqual(result['pharmacy_id'], pharmacy_id)

    def test_repeat_writes_nothing_and_returns_same_projection(self):
        for state in ('assembling', 'assembled'):
            with self.subTest(state=state):
                first, _ = self._run(state, current=mark('assembling') if state == 'assembled' else None)
                repeat, cursor = self._run(state, current=mark(state))
                self.assertEqual(repeat, first)
                self._assert_no_writes(cursor)
                self.assertFalse(any('admin_audit_log' in sql for sql in self._statements(cursor)))
                self.assertEqual(cursor.execute.call_count, 3)

    def test_audit_row_has_exact_shape_and_no_client_data(self):
        for current, target in ((None, 'assembling'), ('assembling', 'assembled')):
            with self.subTest(target=target):
                _, cursor = self._run(target, current=mark(current) if current else None)
                audits = [call for call in cursor.execute.call_args_list if 'admin_audit_log' in call.args[0]]
                self.assertEqual(len(audits), 1)
                actor, action, resource_type, resource_id, request, raw = audits[0].args[1]
                self.assertEqual((actor, action, resource_type, resource_id, request),
                                 ('staff:1', 'pharmacy.order.assembly_marked', 'order', ORDER_ID, 'req_test'))
                self.assertEqual(json.loads(raw), {'pharmacy_id': 1, 'from_state': current, 'to_state': target})
                for word in ('customer', 'phone', 'address', 'name', 'total', 'price'):
                    self.assertNotIn(word, raw)


class PharmacyAssemblyHandlerTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            'ADMIN_SESSION_SECRET': 'test-session-key-' * 3,
            'STAFF_API_BEARER_TOKEN': 'test-staff-service-' * 3,
            'ADMIN_API_BEARER_TOKEN': 'test-admin-service-' * 3,
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.cursor = Mock()

        @contextmanager
        def fake_transaction():
            yield self.cursor

        self.db = patch.object(staff, 'transaction', fake_transaction)
        self.db.start()
        self.addCleanup(self.db.stop)

    def event(self, account, body):
        return {'path': f'/v1/staff/orders/{ORDER_ID}/assembly', 'httpMethod': 'POST',
                'headers': {'Authorization': 'Bearer ' + os.environ['STAFF_API_BEARER_TOKEN'],
                            'x-staff-session': staff.create_session(account)},
                'body': json.dumps(body)}

    def account(self, account_id):
        return {'account_id': account_id, 'username': f'user{account_id}', 'credential_version': 1,
                'catalog_access': account_id == 2, 'password_set': True}

    def test_courier_session_is_forbidden(self):
        courier = self.account(3)
        self.cursor.fetchone.return_value = courier
        with patch('backend.v1.admin_api.lambda_function.mark_pharmacy_assembly') as marker:
            response = lambda_handler(self.event(courier, {'state': 'assembling'}), None)
        self.assertEqual(response['statusCode'], 403)
        marker.assert_not_called()

    def test_handler_passes_session_pharmacy_id(self):
        pharmacy_two = self.account(2)
        self.cursor.fetchone.return_value = pharmacy_two
        with patch('backend.v1.admin_api.lambda_function.mark_pharmacy_assembly',
                   return_value={'order_id': ORDER_ID, 'pharmacy_id': 2, 'state': 'assembling',
                                 'started_at': None, 'assembled_at': None}) as marker:
            response = lambda_handler(self.event(pharmacy_two, {'state': 'assembling'}), None)
        self.assertEqual(response['statusCode'], 200)
        marker.assert_called_once()
        self.assertEqual(marker.call_args.args[:3], (ORDER_ID, {'state': 'assembling'}, 2))

    def test_pharmacy_id_in_body_is_rejected_without_database(self):
        pharmacy_one = self.account(1)
        self.cursor.fetchone.return_value = pharmacy_one
        for body in ({'state': 'assembled', 'pharmacy_id': 2}, {'pharmacy_id': 2}, {}):
            with self.subTest(body=body), patch('backend.v1.admin_api.lambda_function.transaction') as order_tx:
                response = lambda_handler(self.event(pharmacy_one, body), None)
                self.assertEqual(response['statusCode'], 400)
                self.assertIn('VALIDATION_ERROR', response['body'])
                order_tx.assert_not_called()

    def test_errors_map_to_http_statuses(self):
        pharmacy_one = self.account(1)
        self.cursor.fetchone.return_value = pharmacy_one
        for error, status in ((ContractError('ORDER_NOT_FOUND', 'Заказ не найден', http_status=404), 404),
                              (ContractError('ASSEMBLY_STATE_CONFLICT', 'x', http_status=409), 409)):
            with self.subTest(status=status), \
                    patch('backend.v1.admin_api.lambda_function.mark_pharmacy_assembly', side_effect=error):
                response = lambda_handler(self.event(pharmacy_one, {'state': 'assembled'}), None)
                self.assertEqual(response['statusCode'], status)


if __name__ == '__main__':
    unittest.main()
