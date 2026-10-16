"""Job 011 rework 1: per-item «Собрано», «Ватан 2» price at assembly, and the «Согласовано» gate."""
import json
import os
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import (
    ASSEMBLY_NOT_COMPLETE_MESSAGE, _ORDER_ASSEMBLY_PARTS_SQL, answer_pharmacy_order_items,
    collect_pharmacy_order_item, lambda_handler, update_courier_order_status, validate_item_collect_request,
    validate_pharmacy_answers,
)
from backend.v1.shared import staff_accounts as staff
from backend.v1.shared.contract import ContractError

ORDER_ID = 'ord_' + 'c' * 32
PENDING = {'id': 11, 'status': 'pending', 'created_by_staff_account_id': None, 'fulfillment_pharmacy_id': None}


def tx(cursor):
    @contextmanager
    def fake_transaction():
        yield cursor
    return patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction)


def statements(cursor):
    return [call.args[0] for call in cursor.execute.call_args_list]


class CollectItemTests(unittest.TestCase):
    def _run(self, item, order=None, pharmacy_id=2, part=None, body=None):
        cursor = self.cursor = Mock()
        cursor.fetchone.side_effect = [dict(PENDING) if order is None else order, item,
                                       part if part is not None else {'state': 'assembling'}]
        with tx(cursor):
            return collect_pharmacy_order_item(ORDER_ID, body or {'order_item_id': 82}, pharmacy_id, 'req_c')

    def _error(self, item, **kwargs):
        self.cursor = None
        with self.assertRaises(ContractError) as raised:
            self._run(item, **kwargs)
        if self.cursor is not None:
            for sql in statements(self.cursor):
                self.assertTrue(sql.lstrip().startswith('SELECT'), sql)
        return raised.exception

    def test_body_validation(self):
        for body in (None, {}, {'order_item_id': '82'}, {'order_item_id': 0}, {'order_item_id': True},
                     {'order_item_id': 82, 'pharmacy_id': 1}, {'order_item_id': 82, 'collected': True}, [82]):
            with self.subTest(body=body), self.assertRaises(ContractError) as raised:
                validate_item_collect_request(body)
            self.assertEqual((raised.exception.code, raised.exception.http_status), ('VALIDATION_ERROR', 400))
        self.assertEqual(validate_item_collect_request({'order_item_id': 82}), 82)

    def test_collect_writes_item_syncs_part_and_audits(self):
        result = self._run({'id': 82, 'pharmacy_id': 2, 'answer': 'available', 'collected': False},
                           part={'state': 'assembled'})
        calls = self.cursor.execute.call_args_list
        self.assertIn('FOR UPDATE', calls[0].args[0])
        self.assertIn('FOR UPDATE OF oi', calls[1].args[0])
        self.assertEqual(calls[1].args[1], (2, 2, 11, 82))
        insert = next(call for call in calls if 'INSERT INTO order_item_assembly' in call.args[0])
        self.assertEqual(insert.args[1], (82, 2, 'staff:2'))
        sync = next(call for call in calls if 'INSERT INTO order_pharmacy_assembly' in call.args[0])
        self.assertIn("CASE WHEN progress.open_count = 0 THEN 'assembled' ELSE 'assembling' END", sync.args[0])
        self.assertIn('WHERE progress.collected_count > 0', sync.args[0])
        self.assertIn("WHERE order_pharmacy_assembly.state = 'assembling' AND EXCLUDED.state = 'assembled'",
                      sync.args[0])
        self.assertIn("mine.answer IS DISTINCT FROM 'unavailable'", sync.args[0])
        self.assertEqual(sync.args[1], (11, 2, 'staff:2', 2, 2, 11, 2))
        audits = [call for call in calls if 'admin_audit_log' in call.args[0]]
        self.assertEqual(len(audits), 1)
        self.assertEqual(audits[0].args[1][:2], ('staff:2', 'pharmacy.order.item_collected'))
        self.assertEqual(json.loads(audits[0].args[1][5]), {'pharmacy_id': 2, 'order_item_id': 82})
        self.assertEqual(result, {'order_id': ORDER_ID, 'order_item_id': 82, 'pharmacy_id': 2,
                                  'collected': True, 'assembly_state': 'assembled'})
        joined = ' '.join(statements(self.cursor))
        self.assertNotIn('UPDATE orders', joined)
        self.assertNotIn('order_status_history', joined)

    def test_repeat_is_noop(self):
        result = self._run({'id': 82, 'pharmacy_id': 2, 'answer': 'available', 'collected': True})
        for sql in statements(self.cursor):
            self.assertTrue(sql.lstrip().startswith('SELECT'), sql)
        self.assertTrue(result['collected'])

    def test_item_must_be_available_first(self):
        for answer in (None, 'price_differs', 'unavailable'):
            with self.subTest(answer=answer):
                exception = self._error({'id': 82, 'pharmacy_id': 2, 'answer': answer, 'collected': False})
                self.assertEqual((exception.code, exception.http_status), ('ITEM_NOT_AVAILABLE', 409))
                self.assertEqual(str(exception), 'Сначала отметьте «В наличии»')

    def test_other_pharmacy_item_and_missing_item(self):
        exception = self._error({'id': 82, 'pharmacy_id': 1, 'answer': 'available', 'collected': False})
        self.assertEqual((exception.code, exception.http_status), ('FORBIDDEN', 403))
        exception = self._error(None)
        self.assertEqual((exception.code, exception.http_status), ('ORDER_ITEM_NOT_FOUND', 404))

    def test_order_checks(self):
        for order in (None, {**PENDING, 'created_by_staff_account_id': 3}):
            cursor = Mock()
            cursor.fetchone.return_value = order
            with self.subTest(order=order), tx(cursor), self.assertRaises(ContractError) as raised:
                collect_pharmacy_order_item(ORDER_ID, {'order_item_id': 82}, 2, 'req')
            self.assertEqual(raised.exception.http_status, 404)
        for status in ('delivering', 'delivered', 'cancelled'):
            with self.subTest(status=status):
                exception = self._error({'id': 82, 'pharmacy_id': 2, 'answer': 'available', 'collected': False},
                                        order={**PENDING, 'status': status})
                self.assertEqual((exception.code, exception.http_status), ('ORDER_STATUS_CONFLICT', 409))
        exception = self._error(None, pharmacy_id=3)
        self.assertEqual(exception.http_status, 403)


def item(item_id, pharmacy_id=2, answer=None, problem=None, base='40.00'):
    return {'id': item_id, 'pharmacy_id': pharmacy_id, 'answer': answer, 'problem': problem,
            'base_unit_price': Decimal(base)}


class PharmacyPriceTests(unittest.TestCase):
    def _run(self, payload, items, pharmacy_id=2, repriced=None):
        cursor = self.cursor = Mock()
        cursor.fetchone.side_effect = [dict(PENDING)] + [repriced or {'selling_unit_price': 48, 'line_total': Decimal('96.00')}] * 5
        cursor.fetchall.return_value = items
        with tx(cursor):
            return answer_pharmacy_order_items(ORDER_ID, payload, pharmacy_id, 'req_p')

    def test_validation(self):
        parsed = validate_pharmacy_answers({'answers': [
            {'order_item_id': 82, 'answer': 'available', 'base_unit_price': '45,5'}]})
        self.assertEqual(parsed[0]['base_unit_price'], Decimal('45.50'))
        for bad in ('0', '-1', '1000000', '1.234', 'abc', None, True, ''):
            with self.subTest(price=bad), self.assertRaises(ContractError) as raised:
                validate_pharmacy_answers({'answers': [{'order_item_id': 82, 'answer': 'available',
                                                        'base_unit_price': bad}]})
            self.assertEqual(raised.exception.code, 'VALIDATION_ERROR')
        for answer, extra in (('unavailable', {}), ('price_differs', {'problem': 'дороже на 5'})):
            with self.subTest(answer=answer), self.assertRaises(ContractError):
                validate_pharmacy_answers({'answers': [{'order_item_id': 82, 'answer': answer,
                                                        'base_unit_price': '45', **extra}]})

    def test_pharmacy_one_cannot_set_price(self):
        with self.assertRaises(ContractError) as raised:
            self._run({'answers': [{'order_item_id': 81, 'answer': 'available', 'base_unit_price': '45'}]},
                      [item(81, 1)], pharmacy_id=1)
        self.assertEqual((raised.exception.code, raised.exception.http_status), ('FORBIDDEN', 403))
        for sql in statements(self.cursor):
            self.assertTrue(sql.lstrip().startswith('SELECT'), sql)

    def test_new_price_reprices_server_side_and_audits(self):
        self._run({'answers': [{'order_item_id': 82, 'answer': 'available', 'base_unit_price': '45'}]},
                  [item(81, 1, 'unavailable'), item(82, 2)])
        calls = self.cursor.execute.call_args_list
        reprice = next(call for call in calls if 'UPDATE order_items' in call.args[0])
        self.assertIn('selling_unit_price = vatan_selling_unit_price(%s)', reprice.args[0])
        self.assertIn('line_total = ROUND(vatan_selling_unit_price(%s) * quantity, 2)', reprice.args[0])
        self.assertEqual(reprice.args[1], (Decimal('45.00'), Decimal('45.00'), Decimal('45.00'), 82, 11))
        totals = next(call for call in calls if 'UPDATE orders' in call.args[0])
        self.assertIn('SUM(line_total)', totals.args[0])
        self.assertEqual(totals.args[1], (11, 11))
        audits = [call for call in calls if 'admin_audit_log' in call.args[0]]
        actions = [call.args[1][1] for call in audits]
        self.assertEqual(actions, ['pharmacy.order.items_answered', 'pharmacy.order.item_price_changed'])
        details = json.loads(audits[1].args[1][5])
        self.assertEqual(details, {'pharmacy_id': 2, 'items': [{
            'order_item_id': 82, 'previous_base_unit_price': '40.00', 'new_base_unit_price': '45.00',
            'new_selling_unit_price': '48'}]})
        insert = next(call for call in calls if 'INSERT INTO order_item_pharmacy_answers' in call.args[0])
        self.assertEqual(json.loads(insert.args[1][2]),
                         [{'order_item_id': 82, 'answer': 'available', 'problem': None}])
        self.assertNotIn('order_status_history', ' '.join(statements(self.cursor)))
        self.assertTrue(any('INSERT INTO order_pharmacy_assembly' in sql for sql in statements(self.cursor)))

    def test_same_price_is_not_a_change(self):
        self._run({'answers': [{'order_item_id': 82, 'answer': 'available', 'base_unit_price': '40'}]},
                  [item(82, 2, 'available')])
        for sql in statements(self.cursor):
            self.assertTrue(sql.lstrip().startswith('SELECT'), sql)

    def test_price_only_change_on_answered_item(self):
        self._run({'answers': [{'order_item_id': 82, 'answer': 'available', 'base_unit_price': '42.5'}]},
                  [item(82, 2, 'available')])
        joined = ' '.join(statements(self.cursor))
        self.assertNotIn('INSERT INTO order_item_pharmacy_answers', joined)
        self.assertIn('UPDATE order_items', joined)
        audits = [call.args[1][1] for call in self.cursor.execute.call_args_list if 'admin_audit_log' in call.args[0]]
        self.assertEqual(audits, ['pharmacy.order.item_price_changed'])


class ConfirmGateTests(unittest.TestCase):
    def _status(self, order, parts):
        cursor = Mock()
        cursor.fetchone.side_effect = [order, {'created_at': datetime(2026, 10, 16, tzinfo=timezone.utc)}]
        cursor.fetchall.return_value = parts
        with tx(cursor):
            result = update_courier_order_status(ORDER_ID, {'status': 'confirmed', 'expected_current_status': 'pending'},
                                                 'req_s')
        return result, cursor

    def test_confirm_blocked_until_every_pharmacy_assembled(self):
        for parts in ([{'pharmacy_id': 1, 'state': None}],
                      [{'pharmacy_id': 1, 'state': 'assembled'}, {'pharmacy_id': 2, 'state': 'assembling'}],
                      [{'pharmacy_id': 1, 'state': 'assembled'}, {'pharmacy_id': 2, 'state': None}]):
            with self.subTest(parts=parts), self.assertRaises(ContractError) as raised:
                self._status(dict(PENDING), parts)
            self.assertEqual((raised.exception.code, raised.exception.http_status), ('ASSEMBLY_NOT_COMPLETE', 409))
            self.assertEqual(str(raised.exception), ASSEMBLY_NOT_COMPLETE_MESSAGE)

    def test_confirm_allowed_when_assembled_or_nothing_to_assemble(self):
        for parts in ([{'pharmacy_id': 1, 'state': 'assembled'}, {'pharmacy_id': 2, 'state': 'assembled'}], []):
            with self.subTest(parts=parts):
                result, cursor = self._status(dict(PENDING), parts)
                self.assertEqual(result['status'], 'confirmed')
                gate = cursor.execute.call_args_list[1]
                self.assertEqual(gate.args[0], _ORDER_ASSEMBLY_PARTS_SQL)
                self.assertEqual(gate.args[1], (11, 11))

    def test_courier_created_orders_are_not_gated(self):
        result, cursor = self._status({**PENDING, 'created_by_staff_account_id': 3}, [{'pharmacy_id': 1, 'state': None}])
        self.assertEqual(result['status'], 'confirmed')
        self.assertFalse(any(sql == _ORDER_ASSEMBLY_PARTS_SQL for sql in statements(cursor)))

    def test_parts_sql_matches_courier_rule(self):
        self.assertIn("cur.answer IS DISTINCT FROM 'unavailable'", _ORDER_ASSEMBLY_PARTS_SQL)
        self.assertIn('SELECT DISTINCT COALESCE(oi.fulfillment_pharmacy_id, o.fulfillment_pharmacy_id, 1)',
                      _ORDER_ASSEMBLY_PARTS_SQL)
        self.assertIn('LEFT JOIN order_pharmacy_assembly asm', _ORDER_ASSEMBLY_PARTS_SQL)


class CollectHandlerTests(unittest.TestCase):
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
        return {'path': f'/v1/staff/orders/{ORDER_ID}/assembly/items', 'httpMethod': 'POST',
                'headers': {'Authorization': 'Bearer ' + os.environ['STAFF_API_BEARER_TOKEN'],
                            'x-staff-session': staff.create_session(account)},
                'body': json.dumps(body)}

    def account(self, account_id):
        return {'account_id': account_id, 'username': f'user{account_id}', 'credential_version': 1,
                'catalog_access': account_id == 2, 'password_set': True}

    def test_courier_is_forbidden_and_pharmacy_id_comes_from_session(self):
        courier = self.account(3)
        self.cursor.fetchone.return_value = courier
        with patch('backend.v1.admin_api.lambda_function.collect_pharmacy_order_item') as collect:
            response = lambda_handler(self.event(courier, {'order_item_id': 82}), None)
        self.assertEqual(response['statusCode'], 403)
        collect.assert_not_called()
        pharmacy_two = self.account(2)
        self.cursor.fetchone.return_value = pharmacy_two
        with patch('backend.v1.admin_api.lambda_function.collect_pharmacy_order_item',
                   return_value={'order_id': ORDER_ID}) as collect:
            response = lambda_handler(self.event(pharmacy_two, {'order_item_id': 82}), None)
        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(collect.call_args.args[:3], (ORDER_ID, {'order_item_id': 82}, 2))


if __name__ == '__main__':
    unittest.main()
