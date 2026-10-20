import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import claim_order_notification, lambda_handler, update_order_notification_settings
from backend.v1.shared.contract import ContractError
from backend.v1.shared.order_notification_settings import (
    CHANNELS, default_pharmacy_alarm, default_policies, effective_settings, validate_update,
)

ALARM = {'ringtone': 'classic', 'duration_seconds': 60, 'interval_seconds': 60}


class NotificationSettingsTests(unittest.TestCase):
    def test_claim_route_requires_dedicated_service_token(self):
        import json
        from unittest.mock import patch as mock_patch
        event = {'path': '/v1/admin/order-notification-deliveries/claim', 'httpMethod': 'POST',
                 'body': json.dumps({'event_key': 'order:17:created', 'recipient': 'owner_telegram'})}
        with mock_patch.dict('os.environ', {'NOTIFICATION_CLAIM_TOKEN': 'x' * 40}):
            denied = lambda_handler(event, None)
            with mock_patch('backend.v1.admin_api.lambda_function.claim_order_notification',
                            return_value={'claimed': False, 'fields': {}}):
                allowed = lambda_handler({**event, 'headers': {'Authorization': 'Bearer ' + 'x' * 40}}, None)
        self.assertEqual(denied['statusCode'], 403)
        self.assertEqual(allowed['statusCode'], 200)

    def test_update_uses_revision_and_audits_changes(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'courier_enabled': True, 'policies': {}, 'revision': 1},
            {'courier_enabled': False, 'policies': default_policies(), 'revision': 2},
        ]
        with self._transaction(cursor):
            result = update_order_notification_settings({
                'courier_enabled': False, 'policies': default_policies(), 'revision': 1,
                'pharmacy_alarm': dict(ALARM),
            }, 'admin:test', 'req')
        self.assertFalse(result['courier_enabled'])
        self.assertEqual(result['revision'], 2)
        self.assertIn('order.notification_settings_updated', str(cursor.execute.call_args_list))
        self.assertIn('courier_enabled_since', str(cursor.execute.call_args_list))

    def _transaction(self, cursor):
        @contextmanager
        def fake_transaction():
            yield cursor
        return patch('backend.v1.admin_api.lambda_function.transaction', fake_transaction)

    def test_pharmacy_web_defaults_show_base_prices_but_no_client_identity(self):
        web = default_policies()['pharmacy_web']
        self.assertTrue(web['item_base_total'])
        self.assertTrue(web['base_total'])
        for field in ('customer_name', 'phone', 'address', 'landmark', 'client_total',
                      'item_client_total', 'profit', 'creator'):
            self.assertFalse(web[field], field)

    def test_policy_is_allowlisted_and_order_number_cannot_be_hidden(self):
        policies = default_policies()
        enabled, result, revision, alarm = validate_update({
            'courier_enabled': False, 'policies': policies, 'revision': 1, 'pharmacy_alarm': dict(ALARM),
        })
        self.assertFalse(enabled)
        self.assertEqual(result, policies)
        self.assertEqual(revision, 1)
        self.assertEqual(alarm, ALARM)
        policies['courier_telegram']['order_reference'] = False
        with self.assertRaises(ValueError):
            validate_update({'courier_enabled': True, 'policies': policies, 'revision': 1, 'pharmacy_alarm': ALARM})
        policies['courier_telegram']['order_reference'] = True
        policies['courier_telegram']['secret'] = True
        with self.assertRaises(ValueError):
            validate_update({'courier_enabled': True, 'policies': policies, 'revision': 1, 'pharmacy_alarm': ALARM})

    def test_disabled_courier_is_not_claimed(self):
        now = datetime.now(timezone.utc)
        cursor = Mock()
        cursor.fetchone.return_value = {'courier_enabled': False, 'courier_enabled_since': now,
            'order_created_at': now, 'policies': {}, 'revision': 1}
        with self._transaction(cursor):
            result = claim_order_notification({'event_key': 'order:17:created', 'recipient': 'courier_telegram'})
        self.assertFalse(result['claimed'])
        self.assertEqual(cursor.execute.call_count, 1)

    def test_reenabled_courier_does_not_receive_old_event(self):
        now = datetime.now(timezone.utc)
        cursor = Mock()
        cursor.fetchone.return_value = {'courier_enabled': True, 'courier_enabled_since': now,
            'order_created_at': now - timedelta(minutes=5), 'policies': {}, 'revision': 2}
        with self._transaction(cursor):
            result = claim_order_notification({'event_key': 'order:17:created', 'recipient': 'courier_telegram'})
        self.assertFalse(result['claimed'])
        self.assertEqual(cursor.execute.call_count, 1)

    def test_legacy_naive_utc_order_time_compares_with_aware_setting(self):
        now = datetime.now(timezone.utc)
        cursor = Mock()
        cursor.fetchone.return_value = {'courier_enabled': True, 'courier_enabled_since': now,
            'order_created_at': (now - timedelta(minutes=5)).replace(tzinfo=None),
            'policies': {}, 'revision': 2}
        with self._transaction(cursor):
            result = claim_order_notification({'event_key': 'order:17:created', 'recipient': 'courier_telegram'})
        self.assertFalse(result['claimed'])

    # --- job 013: pharmacy change events ------------------------------------------------------

    CHANGE_KEY = 'order:17:pharmacy-change:req_' + 'ab' * 16

    def test_change_event_is_claimed_for_owner_and_courier(self):
        now = datetime.now(timezone.utc)
        for recipient in ('owner_telegram', 'courier_telegram'):
            with self.subTest(recipient=recipient):
                cursor = Mock()
                cursor.fetchone.side_effect = [
                    {'courier_enabled': True, 'courier_enabled_since': now - timedelta(days=1),
                     'order_created_at': now, 'policies': {}, 'revision': 1},
                    {'event_key': self.CHANGE_KEY},
                ]
                with self._transaction(cursor):
                    result = claim_order_notification({'event_key': self.CHANGE_KEY, 'recipient': recipient})
                self.assertTrue(result['claimed'])
                self.assertEqual(result['fields'], default_policies()[recipient])
                insert = cursor.execute.call_args_list[1]
                self.assertIn('INSERT INTO order_notification_deliveries', insert.args[0])
                self.assertEqual(insert.args[1], (self.CHANGE_KEY, recipient))
                self.assertEqual(cursor.execute.call_args_list[0].args[1], (17,))

    def test_change_event_respects_disabled_courier_and_duplicates(self):
        now = datetime.now(timezone.utc)
        cursor = Mock()
        cursor.fetchone.return_value = {'courier_enabled': False, 'courier_enabled_since': now,
            'order_created_at': now, 'policies': {}, 'revision': 1}
        with self._transaction(cursor):
            result = claim_order_notification({'event_key': self.CHANGE_KEY, 'recipient': 'courier_telegram'})
        self.assertFalse(result['claimed'])
        cursor = Mock()
        cursor.fetchone.side_effect = [{'courier_enabled': True, 'courier_enabled_since': now - timedelta(days=1),
                                        'order_created_at': now, 'policies': {}, 'revision': 1}, None]
        with self._transaction(cursor):
            second = claim_order_notification({'event_key': self.CHANGE_KEY, 'recipient': 'owner_telegram'})
        self.assertEqual(second, {'claimed': False, 'fields': {}})

    def test_change_event_rejects_pharmacy_recipient_and_malformed_keys(self):
        bad = [
            (self.CHANGE_KEY, 'pharmacy_telegram'),
            (self.CHANGE_KEY, 'pharmacy_web'),
            ('order:17:pharmacy-change:', 'owner_telegram'),
            ('order:17:pharmacy-change:req_123', 'owner_telegram'),
            ('order:17:pharmacy-change:req_' + 'AB' * 16, 'owner_telegram'),
            ('order:17:pharmacy-change:req_' + 'ab' * 16 + 'x', 'owner_telegram'),
            ('order:0:pharmacy-change:req_' + 'ab' * 16, 'owner_telegram'),
            ('order:17:pharmacy-changed:req_' + 'ab' * 16, 'owner_telegram'),
            ('order:17:created:pharmacy-change:req_' + 'ab' * 16, 'owner_telegram'),
            ('order:17:pharmacy-change:req_' + 'ab' * 16 + '\n', 'owner_telegram'),
        ]
        for event_key, recipient in bad:
            with self.subTest(event_key=event_key, recipient=recipient):
                cursor = Mock()
                with self._transaction(cursor), self.assertRaises(ContractError) as raised:
                    claim_order_notification({'event_key': event_key, 'recipient': recipient})
                self.assertEqual((raised.exception.code, raised.exception.http_status), ('VALIDATION_ERROR', 400))
                cursor.execute.assert_not_called()

    def test_created_event_still_accepts_pharmacy_recipient(self):
        now = datetime.now(timezone.utc)
        cursor = Mock()
        cursor.fetchone.side_effect = [{'courier_enabled': True, 'courier_enabled_since': now,
                                        'order_created_at': now, 'policies': {}, 'revision': 1},
                                       {'event_key': 'order:17:created'}]
        with self._transaction(cursor):
            result = claim_order_notification({'event_key': 'order:17:created', 'recipient': 'pharmacy_telegram'})
        self.assertTrue(result['claimed'])

    def test_duplicate_delivery_claim_is_rejected(self):
        now = datetime.now(timezone.utc)
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'courier_enabled': True, 'courier_enabled_since': now - timedelta(days=1),
             'order_created_at': now, 'policies': {}, 'revision': 1},
            None,
        ]
        with self._transaction(cursor):
            result = claim_order_notification({'event_key': 'order:17:created', 'recipient': 'owner_telegram'})
        self.assertFalse(result['claimed'])
        self.assertEqual(cursor.execute.call_count, 2)
        self.assertIn('ON CONFLICT DO NOTHING', cursor.execute.call_args.args[0])

    def test_invalid_claim_does_not_query_database(self):
        with self.assertRaises(ContractError):
            claim_order_notification({'event_key': 'order:17:created', 'recipient': 'pharmacy_web'})

    # --- job 014: pharmacy alarm (ringtone, duration, interval) ------------------------------------

    def _payload(self, **alarm):
        return {'courier_enabled': True, 'policies': default_policies(), 'revision': 3,
                'pharmacy_alarm': {**ALARM, **alarm}}

    def test_pharmacy_alarm_defaults_for_missing_rows_and_old_rows(self):
        self.assertEqual(default_pharmacy_alarm(), ALARM)
        self.assertEqual(effective_settings(None)['pharmacy_alarm'], ALARM)
        self.assertEqual(effective_settings({'courier_enabled': True, 'policies': {}, 'revision': 4})['pharmacy_alarm'],
                         ALARM)
        for broken in ({'ringtone': 'siren', 'duration_seconds': 60, 'interval_seconds': 60},
                       {'ringtone': 'bell', 'duration_seconds': 90, 'interval_seconds': 60},
                       {'ringtone': 'bell', 'duration_seconds': True, 'interval_seconds': 60},
                       {'ringtone': 'bell'}, 'classic', None):
            with self.subTest(broken=broken):
                row = {'courier_enabled': True, 'policies': {'pharmacy_alarm': broken}, 'revision': 4}
                self.assertEqual(effective_settings(row)['pharmacy_alarm'], ALARM)

    def test_pharmacy_alarm_round_trips_and_never_leaks_into_channels(self):
        stored = {**default_policies(), 'pharmacy_alarm': {'ringtone': 'melody', 'duration_seconds': 30,
                                                           'interval_seconds': 120},
                  'unknown_channel': {'phone': True}}
        stored['pharmacy_web'] = {**stored['pharmacy_web'], 'pharmacy_alarm': True, 'ringtone': 'bell'}
        settings = effective_settings({'courier_enabled': True, 'policies': stored, 'revision': 5})
        self.assertEqual(settings['pharmacy_alarm'], {'ringtone': 'melody', 'duration_seconds': 30,
                                                      'interval_seconds': 120})
        self.assertEqual(set(settings['policies']), set(CHANNELS))
        for channel in CHANNELS:
            self.assertEqual(settings['policies'][channel], default_policies()[channel])
            self.assertNotIn('pharmacy_alarm', settings['policies'][channel])
            self.assertNotIn('ringtone', settings['policies'][channel])

    def test_pharmacy_alarm_accepts_every_ringtone_and_the_bounds(self):
        for ringtone in ('classic', 'bell', 'pulse', 'melody'):
            self.assertEqual(validate_update(self._payload(ringtone=ringtone))[3]['ringtone'], ringtone)
        for duration, interval in ((5, 30), (30, 30), (120, 120), (120, 600), (60, 60)):
            with self.subTest(duration=duration, interval=interval):
                alarm = validate_update(self._payload(duration_seconds=duration, interval_seconds=interval))[3]
                self.assertEqual((alarm['duration_seconds'], alarm['interval_seconds']), (duration, interval))

    def test_pharmacy_alarm_rejects_bad_values(self):
        bad = [
            {'ringtone': 'siren'}, {'ringtone': ''}, {'ringtone': None}, {'ringtone': 1}, {'ringtone': 'Classic'},
            {'duration_seconds': 4}, {'duration_seconds': 121}, {'duration_seconds': 60.0},
            {'duration_seconds': '60'}, {'duration_seconds': True}, {'duration_seconds': None},
            {'interval_seconds': 29}, {'interval_seconds': 601}, {'interval_seconds': 60.5},
            {'interval_seconds': '60'}, {'interval_seconds': False},
            {'duration_seconds': 61, 'interval_seconds': 60},
            {'duration_seconds': 120, 'interval_seconds': 30},
        ]
        for change in bad:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_update(self._payload(**change))
        missing = self._payload()
        del missing['pharmacy_alarm']['interval_seconds']
        extra = self._payload(volume=1)
        no_alarm = self._payload()
        del no_alarm['pharmacy_alarm']
        as_text = {**self._payload(), 'pharmacy_alarm': 'classic'}
        for payload in (missing, extra, no_alarm, {**self._payload(), 'extra': 1}, as_text):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_update(payload)

    def test_update_stores_alarm_beside_unchanged_policies_and_audits_both(self):
        import json
        policies = default_policies()
        alarm = {'ringtone': 'pulse', 'duration_seconds': 45, 'interval_seconds': 90}
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {'courier_enabled': True, 'policies': default_policies(), 'revision': 3},
            {'courier_enabled': True, 'policies': {**policies, 'pharmacy_alarm': alarm}, 'revision': 4},
        ]
        with self._transaction(cursor):
            result = update_order_notification_settings(
                {'courier_enabled': True, 'policies': policies, 'revision': 3, 'pharmacy_alarm': alarm},
                'admin:test', 'req')
        self.assertEqual(result['pharmacy_alarm'], alarm)
        self.assertEqual(result['policies'], default_policies())
        update = next(call for call in cursor.execute.call_args_list
                      if 'UPDATE order_notification_settings' in call.args[0])
        stored = json.loads(update.args[1][1])
        self.assertEqual(stored['pharmacy_alarm'], alarm)
        self.assertEqual({key: value for key, value in stored.items() if key != 'pharmacy_alarm'}, policies)
        audit = next(call for call in cursor.execute.call_args_list if 'admin_audit_log' in call.args[0])
        details = json.loads(audit.args[1][5])
        self.assertEqual(details['previous']['pharmacy_alarm'], ALARM)
        self.assertEqual(details['current']['pharmacy_alarm'], alarm)
        self.assertEqual(details['current']['policies'], policies)

    def test_invalid_alarm_update_is_rejected_before_database(self):
        cursor = Mock()
        with self._transaction(cursor), self.assertRaises(ContractError) as raised:
            update_order_notification_settings(self._payload(ringtone='siren'), 'admin:test', 'req')
        self.assertEqual((raised.exception.code, raised.exception.http_status), ('VALIDATION_ERROR', 400))
        cursor.execute.assert_not_called()

    def test_settings_routes_require_admin(self):
        import json
        for method, body in (('GET', None), ('PATCH', self._payload())):
            with self.subTest(method=method):
                event = {'path': '/v1/admin/order-notification-settings', 'httpMethod': method, 'headers': {},
                         'body': json.dumps(body or {})}
                with patch('backend.v1.admin_api.lambda_function.transaction') as tx:
                    response = lambda_handler(event, None)
                self.assertIn(response['statusCode'], (401, 403))
                tx.assert_not_called()

    def test_admin_get_returns_pharmacy_alarm(self):
        import json
        import os
        cursor = Mock()
        cursor.fetchone.return_value = {'courier_enabled': True, 'policies': {}, 'revision': 1}
        token = 'test-admin-service-' * 3
        event = {'path': '/v1/admin/order-notification-settings', 'httpMethod': 'GET',
                 'headers': {'Authorization': 'Bearer ' + token}}
        with patch.dict(os.environ, {'ADMIN_API_BEARER_TOKEN': token}), self._transaction(cursor):
            response = lambda_handler(event, None)
        self.assertEqual(response['statusCode'], 200)
        self.assertEqual(json.loads(response['body'])['data']['pharmacy_alarm'], ALARM)


if __name__ == '__main__':
    unittest.main()
