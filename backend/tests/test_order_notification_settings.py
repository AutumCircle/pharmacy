import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import claim_order_notification, lambda_handler, update_order_notification_settings
from backend.v1.shared.contract import ContractError
from backend.v1.shared.order_notification_settings import default_policies, validate_update


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

    def test_policy_is_allowlisted_and_order_number_cannot_be_hidden(self):
        policies = default_policies()
        enabled, result, revision = validate_update({
            'courier_enabled': False, 'policies': policies, 'revision': 1,
        })
        self.assertFalse(enabled)
        self.assertEqual(result, policies)
        self.assertEqual(revision, 1)
        policies['courier_telegram']['order_reference'] = False
        with self.assertRaises(ValueError):
            validate_update({'courier_enabled': True, 'policies': policies, 'revision': 1})
        policies['courier_telegram']['order_reference'] = True
        policies['courier_telegram']['secret'] = True
        with self.assertRaises(ValueError):
            validate_update({'courier_enabled': True, 'policies': policies, 'revision': 1})

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


if __name__ == '__main__':
    unittest.main()
