"""Job 010: pharmacist availability answers per item and automatic routing «Ватан 1» -> «Ватан 2»."""
import json
import os
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import answer_pharmacy_order_items, lambda_handler, validate_pharmacy_answers
from backend.v1.shared import staff_accounts as staff
from backend.v1.shared.contract import ContractError

ORDER_ID = 'ord_' + 'a' * 32
WEBSITE_ORDER = {'id': 7, 'status': 'pending', 'created_by_staff_account_id': None, 'fulfillment_pharmacy_id': None}


def item(item_id, pharmacy_id=1, answer=None, problem=None):
    return {'id': item_id, 'pharmacy_id': pharmacy_id, 'answer': answer, 'problem': problem}


class PharmacyAnswerTests(unittest.TestCase):
    def _run(self, payload, pharmacy_id=1, order=None, items=None):
        cursor = self.last_cursor = Mock()
        cursor.fetchone.return_value = dict(WEBSITE_ORDER) if order is None else order
        cursor.fetchall.return_value = [dict(row) for row in (items if items is not None else [item(81), item(82)])]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction):
            result = answer_pharmacy_order_items(ORDER_ID, payload, pharmacy_id, 'req_test')
        return result, cursor

    def _error(self, payload, **kwargs):
        self.last_cursor = None
        with self.assertRaises(ContractError) as raised:
            self._run(payload, **kwargs)
        if self.last_cursor is not None:
            self._assert_no_writes(self.last_cursor)
        return raised.exception

    @staticmethod
    def _statements(cursor):
        return [call.args[0] for call in cursor.execute.call_args_list]

    def _assert_no_writes(self, cursor):
        for sql in self._statements(cursor):
            self.assertTrue(sql.lstrip().startswith('SELECT'), sql)

    # --- validation --------------------------------------------------------------------

    def test_body_validation_rejects_bad_shapes_before_database(self):
        too_many = {'answers': [{'order_item_id': i, 'answer': 'available'} for i in range(1, 52)]}
        bad = [
            None, [], {}, {'answers': []}, {'answers': 'x'}, too_many,
            {'answers': [{'order_item_id': 81, 'answer': 'available'}], 'pharmacy_id': 2},
            {'answers': [{'order_item_id': 81, 'answer': 'available'}], 'extra': 1},
            {'answers': [{'order_item_id': 81}]},
            {'answers': [{'answer': 'available'}]},
            {'answers': [{'order_item_id': 81, 'answer': 'available', 'price': '10'}]},
            {'answers': [{'order_item_id': 81, 'answer': 'price_differs', 'problem': 'дороже', 'unit_price': '12'}]},
            {'answers': [{'order_item_id': 81, 'answer': 'available', 'pharmacy_id': 2}]},
            {'answers': [{'order_item_id': '81', 'answer': 'available'}]},
            {'answers': [{'order_item_id': True, 'answer': 'available'}]},
            {'answers': [{'order_item_id': 0, 'answer': 'available'}]},
            {'answers': [{'order_item_id': 81.0, 'answer': 'available'}]},
            {'answers': [{'order_item_id': 81, 'answer': 'maybe'}]},
            {'answers': [{'order_item_id': 81, 'answer': None}]},
            {'answers': [{'order_item_id': 81, 'answer': 'available'}, {'order_item_id': 81, 'answer': 'unavailable'}]},
            {'answers': [{'order_item_id': 81, 'answer': 'price_differs'}]},
            {'answers': [{'order_item_id': 81, 'answer': 'price_differs', 'problem': None}]},
            {'answers': [{'order_item_id': 81, 'answer': 'price_differs', 'problem': '   '}]},
            {'answers': [{'order_item_id': 81, 'answer': 'price_differs', 'problem': 'ab'}]},
            {'answers': [{'order_item_id': 81, 'answer': 'price_differs', 'problem': 'x' * 301}]},
            {'answers': [{'order_item_id': 81, 'answer': 'price_differs', 'problem': 12}]},
            {'answers': [{'order_item_id': 81, 'answer': 'available', 'problem': 'всё хорошо'}]},
            {'answers': [{'order_item_id': 81, 'answer': 'available', 'problem': ''}]},
            {'answers': [{'order_item_id': 81, 'answer': 'unavailable', 'problem': 'ab'}]},
        ]
        for payload in bad:
            with self.subTest(payload=payload):
                exception = self._error(payload)
                self.assertEqual((exception.code, exception.http_status), ('VALIDATION_ERROR', 400))

    def test_validation_normalizes_problem_and_accepts_fifty_entries(self):
        answers = validate_pharmacy_answers({'answers': [
            {'order_item_id': 1, 'answer': 'price_differs', 'problem': '  дороже   на 5  '},
            {'order_item_id': 2, 'answer': 'unavailable'},
            {'order_item_id': 3, 'answer': 'unavailable', 'problem': ''},
            {'order_item_id': 4, 'answer': 'unavailable', 'problem': 'закончился'},
            {'order_item_id': 5, 'answer': 'available', 'problem': None},
        ]})
        self.assertEqual([(a['answer'], a['problem']) for a in answers], [
            ('price_differs', 'дороже на 5'), ('unavailable', None), ('unavailable', None),
            ('unavailable', 'закончился'), ('available', None)])
        fifty = {'answers': [{'order_item_id': i, 'answer': 'available'} for i in range(1, 51)]}
        self.assertEqual(len(validate_pharmacy_answers(fifty)), 50)
        self.assertEqual(validate_pharmacy_answers({'answers': [
            {'order_item_id': 1, 'answer': 'price_differs', 'problem': 'x' * 300}]})[0]['problem'], 'x' * 300)

    # --- authorization / state ------------------------------------------------------------

    def test_item_assigned_to_other_pharmacy_is_forbidden_without_writes(self):
        # Item 81 is valid, item 82 belongs to «Ватан 2»: the whole request fails, nothing is written.
        exception = self._error({'answers': [{'order_item_id': 81, 'answer': 'available'},
                                             {'order_item_id': 82, 'answer': 'available'}]},
                                items=[item(81, 1), item(82, 2)])
        self.assertEqual((exception.code, exception.http_status), ('FORBIDDEN', 403))

    def test_routed_away_item_cannot_be_changed_by_pharmacy_one(self):
        exception = self._error({'answers': [{'order_item_id': 82, 'answer': 'available'}]},
                                items=[item(81, 1), item(82, 2, 'unavailable')])
        self.assertEqual((exception.code, exception.http_status), ('FORBIDDEN', 403))

    def test_item_not_in_order_is_404(self):
        exception = self._error({'answers': [{'order_item_id': 999, 'answer': 'available'}]})
        self.assertEqual((exception.code, exception.http_status), ('ORDER_ITEM_NOT_FOUND', 404))

    def test_order_without_items_for_this_pharmacy_is_404(self):
        exception = self._error({'answers': [{'order_item_id': 81, 'answer': 'available'}]},
                                pharmacy_id=2, items=[item(81, 1), item(82, 1)])
        self.assertEqual((exception.code, exception.http_status), ('ORDER_NOT_FOUND', 404))

    def test_missing_and_non_website_orders_are_404(self):
        for order in ({}, {**WEBSITE_ORDER, 'created_by_staff_account_id': 3},
                      {**WEBSITE_ORDER, 'created_by_staff_account_id': 1}):
            with self.subTest(order=order):
                cursor = Mock()
                cursor.fetchone.return_value = order or None

                @contextmanager
                def fake_transaction():
                    yield cursor

                with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction), \
                        self.assertRaises(ContractError) as raised:
                    answer_pharmacy_order_items(ORDER_ID, {'answers': [{'order_item_id': 81, 'answer': 'available'}]},
                                                1, 'req')
                self.assertEqual((raised.exception.code, raised.exception.http_status), ('ORDER_NOT_FOUND', 404))
                self.assertEqual(cursor.execute.call_count, 1)

    def test_only_pending_orders_accept_answers(self):
        for status in ('confirmed', 'delivering', 'delivered', 'cancelled'):
            with self.subTest(status=status):
                cursor = Mock()
                cursor.fetchone.return_value = {**WEBSITE_ORDER, 'status': status}
                cursor.fetchall.return_value = [item(81)]

                @contextmanager
                def fake_transaction():
                    yield cursor

                with patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction), \
                        self.assertRaises(ContractError) as raised:
                    answer_pharmacy_order_items(ORDER_ID, {'answers': [{'order_item_id': 81, 'answer': 'available'}]},
                                                1, 'req')
                self.assertEqual((raised.exception.code, raised.exception.http_status),
                                 ('ORDER_STATUS_CONFLICT', 409))
                self._assert_no_writes(cursor)

    def test_order_row_is_locked_and_items_read_with_effective_assignment(self):
        _, cursor = self._run({'answers': [{'order_item_id': 81, 'answer': 'available'}]})
        first, second = cursor.execute.call_args_list[:2]
        self.assertIn('FOR UPDATE', first.args[0])
        self.assertIn('deleted_at IS NULL', first.args[0])
        self.assertEqual(first.args[1], (ORDER_ID,))
        self.assertIn('COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1) AS pharmacy_id', second.args[0])
        self.assertIn('FOR UPDATE OF oi', second.args[0])
        self.assertEqual(second.args[1], (1, 7))

    # --- writes, routing, audit -----------------------------------------------------------

    def test_unavailable_from_pharmacy_one_routes_only_that_item(self):
        result, cursor = self._run({'answers': [
            {'order_item_id': 81, 'answer': 'unavailable', 'problem': 'закончился'},
            {'order_item_id': 82, 'answer': 'available'},
        ]})
        statements = self._statements(cursor)
        insert = next(call for call in cursor.execute.call_args_list
                      if 'INSERT INTO order_item_pharmacy_answers' in call.args[0])
        self.assertIn('ON CONFLICT (order_item_id, pharmacy_id) DO UPDATE', insert.args[0])
        self.assertEqual(insert.args[1][:2], (1, 'staff:1'))
        self.assertEqual(json.loads(insert.args[1][2]), [
            {'order_item_id': 81, 'answer': 'unavailable', 'problem': 'закончился'},
            {'order_item_id': 82, 'answer': 'available', 'problem': None}])
        update = next(call for call in cursor.execute.call_args_list if 'UPDATE order_items' in call.args[0])
        self.assertIn('SET fulfillment_pharmacy_id = 2, pharmacy_assigned_at = now()', update.args[0])
        self.assertIn('WHERE order_id = %s AND id = ANY(%s)', update.args[0])
        self.assertEqual(update.args[1], (7, [81]))
        joined = ' '.join(statements)
        self.assertNotIn('UPDATE orders', joined)
        self.assertNotIn('order_status_history', joined)
        self.assertEqual(result['routed_away_count'], 1)
        self.assertEqual(result['items'], [{'order_item_id': 82, 'my_answer': 'available', 'my_problem': None}])
        self.assertFalse(result['awaiting_response'])

    def test_price_differs_from_pharmacy_one_does_not_route(self):
        result, cursor = self._run({'answers': [
            {'order_item_id': 81, 'answer': 'price_differs', 'problem': 'дороже на 5 сомони'}]})
        self.assertFalse(any('UPDATE order_items' in sql for sql in self._statements(cursor)))
        self.assertTrue(any('INSERT INTO order_item_pharmacy_answers' in sql for sql in self._statements(cursor)))
        self.assertEqual(result['routed_away_count'], 0)
        self.assertTrue(result['awaiting_response'])  # item 82 still unanswered

    def test_unavailable_from_pharmacy_two_is_final_and_does_not_route(self):
        result, cursor = self._run({'answers': [{'order_item_id': 82, 'answer': 'unavailable'}]},
                                   pharmacy_id=2, items=[item(81, 1, None), item(82, 2)])
        self.assertFalse(any('UPDATE order_items' in sql for sql in self._statements(cursor)))
        audit = next(call for call in cursor.execute.call_args_list if 'admin_audit_log' in call.args[0])
        details = json.loads(audit.args[1][5])
        self.assertEqual(details['routed_to_pharmacy_2'], [])
        self.assertEqual(audit.args[1][0], 'staff:2')
        self.assertEqual(result['items'], [{'order_item_id': 82, 'my_answer': 'unavailable', 'my_problem': None}])

    def test_order_originally_at_pharmacy_two_never_routes_to_pharmacy_one(self):
        order = {**WEBSITE_ORDER, 'fulfillment_pharmacy_id': 2}
        _, cursor = self._run({'answers': [{'order_item_id': 81, 'answer': 'unavailable'}]},
                              pharmacy_id=2, order=order, items=[item(81, 2)])
        self.assertFalse(any('UPDATE order_items' in sql for sql in self._statements(cursor)))

    def test_audit_row_has_exact_shape_and_no_client_data(self):
        _, cursor = self._run({'answers': [
            {'order_item_id': 81, 'answer': 'unavailable'},
            {'order_item_id': 82, 'answer': 'price_differs', 'problem': 'дороже на 5'}]})
        audits = [call for call in cursor.execute.call_args_list if 'admin_audit_log' in call.args[0]]
        self.assertEqual(len(audits), 1)
        actor, action, resource_type, resource_id, request, raw = audits[0].args[1]
        self.assertEqual((actor, action, resource_type, resource_id, request),
                         ('staff:1', 'pharmacy.order.items_answered', 'order', ORDER_ID, 'req_test'))
        details = json.loads(raw)
        self.assertEqual(details, {
            'pharmacy_id': 1,
            'items': [{'order_item_id': 81, 'answer': 'unavailable'}, {'order_item_id': 82, 'answer': 'price_differs'}],
            'routed_to_pharmacy_2': [81]})
        for word in ('customer', 'phone', 'address', 'name', 'problem'):
            self.assertNotIn(word, raw)

    def test_repeated_request_changes_nothing_and_returns_same_projection(self):
        payload = {'answers': [{'order_item_id': 81, 'answer': 'unavailable'},
                               {'order_item_id': 82, 'answer': 'price_differs', 'problem': 'дороже на 5'}]}
        first, _ = self._run(payload)
        # State after the first request: 81 routed to «Ватан 2» with pharmacy 1's answer, 82 answered.
        repeat, cursor = self._run(payload, items=[item(81, 2, 'unavailable'),
                                                   item(82, 1, 'price_differs', 'дороже на 5')])
        self.assertEqual(repeat, first)
        self._assert_no_writes(cursor)
        self.assertFalse(any('admin_audit_log' in sql for sql in self._statements(cursor)))
        self.assertEqual(cursor.execute.call_count, 2)

    def test_changed_problem_text_is_a_change(self):
        _, cursor = self._run({'answers': [{'order_item_id': 82, 'answer': 'price_differs', 'problem': 'дороже на 7'}]},
                              items=[item(81, 1), item(82, 1, 'price_differs', 'дороже на 5')])
        self.assertEqual(sum('admin_audit_log' in sql for sql in self._statements(cursor)), 1)

    # --- handler wiring ---------------------------------------------------------------------


class PharmacyAnswerHandlerTests(unittest.TestCase):
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
        return {'path': f'/v1/staff/orders/{ORDER_ID}/pharmacy-answers', 'httpMethod': 'POST',
                'headers': {'Authorization': 'Bearer ' + os.environ['STAFF_API_BEARER_TOKEN'],
                            'x-staff-session': staff.create_session(account)},
                'body': json.dumps(body)}

    def account(self, account_id):
        return {'account_id': account_id, 'username': f'user{account_id}', 'credential_version': 1,
                'catalog_access': account_id == 2, 'password_set': True}

    def test_courier_session_is_forbidden(self):
        courier = self.account(3)
        self.cursor.fetchone.return_value = courier
        with patch('backend.v1.admin_api.lambda_function.answer_pharmacy_order_items') as answer:
            response = lambda_handler(self.event(courier, {'answers': [{'order_item_id': 81, 'answer': 'available'}]}),
                                      None)
        self.assertEqual(response['statusCode'], 403)
        answer.assert_not_called()

    def test_handler_passes_session_pharmacy_id(self):
        pharmacy_two = self.account(2)
        self.cursor.fetchone.return_value = pharmacy_two
        body = {'answers': [{'order_item_id': 81, 'answer': 'available'}]}
        with patch('backend.v1.admin_api.lambda_function.answer_pharmacy_order_items',
                   return_value={'order_id': ORDER_ID, 'items': [], 'routed_away_count': 0,
                                 'awaiting_response': False}) as answer:
            response = lambda_handler(self.event(pharmacy_two, body), None)
        self.assertEqual(response['statusCode'], 200)
        answer.assert_called_once()
        self.assertEqual(answer.call_args.args[:3], (ORDER_ID, body, 2))

    def test_pharmacy_id_in_body_is_rejected(self):
        pharmacy_one = self.account(1)
        self.cursor.fetchone.return_value = pharmacy_one
        for body in ({'answers': [{'order_item_id': 81, 'answer': 'available'}], 'pharmacy_id': 2},
                     {'answers': [{'order_item_id': 81, 'answer': 'available', 'pharmacy_id': 2}]}):
            with patch('backend.v1.admin_api.lambda_function.transaction') as order_tx:
                response = lambda_handler(self.event(pharmacy_one, body), None)
            self.assertEqual(response['statusCode'], 400)
            self.assertIn('VALIDATION_ERROR', response['body'])
            order_tx.assert_not_called()


if __name__ == '__main__':
    unittest.main()
