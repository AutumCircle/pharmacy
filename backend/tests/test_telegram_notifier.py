import unittest
import json
from decimal import Decimal
from unittest.mock import patch

from backend.v1.telegram_notifier.lambda_function import (
    courier_buttons,
    format_configured_message,
    format_courier_assembly_message,
    format_delivery_message,
    format_owner_message,
    format_pharmacy_change_message,
    format_pharmacy_message,
    lambda_handler,
)
from backend.v1.shared.order_notification_settings import default_policies


class TelegramMessageTests(unittest.TestCase):
    def test_recipient_policy_omits_private_fields(self):
        fields = default_policies()['courier_telegram']
        text = format_configured_message({
            'order_reference': '1234-001', 'customer_name': 'Клиент', 'phone': '+992917123456',
            'base_total': '80', 'profit': '20', 'order_total': '100',
            'items': [{'medicine_name': 'NOW D3', 'quantity': 1, 'line_total': '100', 'base_line_total': '80'}],
        }, fields, 'courier_telegram')
        self.assertIn('NOW D3', text)
        self.assertIn('+992917123456', text)
        self.assertNotIn('Базовая', text)
        self.assertNotIn('Разница', text)
        self.assertNotIn('80.00', text)
        restricted = {**fields, 'phone': False, 'address': False, 'items': False, 'client_total': False}
        text = format_configured_message({'order_reference': '1234-001', 'phone': 'SECRET',
            'address': 'HIDDEN', 'items': [{'medicine_name': 'PRIVATE'}], 'order_total': 100},
            restricted, 'courier_telegram')
        self.assertNotIn('SECRET', text)
        self.assertNotIn('HIDDEN', text)
        self.assertNotIn('PRIVATE', text)

    def test_configured_message_respects_telegram_length(self):
        fields = default_policies()['owner_telegram']
        text = format_configured_message({
            'order_reference': '1234-001', 'address': 'Адрес ' * 80,
            'comment': 'Комментарий ' * 50,
            'items': [{'medicine_name': 'Очень длинное лекарство ' * 8, 'quantity': 1,
                       'line_total': 12, 'base_line_total': 10}] * 100,
        }, fields, 'owner_telegram')
        self.assertLess(len(text), 4096)
        self.assertIn('остальные товары', text)

    def test_formats_customer_items_total_and_profit_and_escapes_html(self):
        event = {
            "order_reference": "1234-001",
            "customer_name": "<Фируз>",
            "phone": "+992917123456",
            "address": "Айни 29",
            "items": [{
                "medicine_name": "NOW D3",
                "quantity": 2,
                "line_total": 210,
                "base_line_total": 180,
            }],
            "base_total": 180,
            "order_total": 210,
            "profit": Decimal("10.50"),
        }
        owner = format_owner_message(event)
        pharmacy = format_pharmacy_message(event)
        delivery = format_delivery_message(event)
        self.assertIn("Новый заказ 1234-001", owner)
        self.assertIn("NOW D3 × 2", owner)
        self.assertIn("Сумма заказа: 210.00 с.", owner)
        self.assertIn("Валовая прибыль: 10.50 с.", owner)
        self.assertIn("&lt;Фируз&gt;", owner)
        self.assertIn("Айни 29", owner)
        self.assertIn("<b>Товары:</b>", pharmacy)
        self.assertIn("NOW D3 × 2 — 180.00 с.", pharmacy)
        self.assertIn("Итого: 180.00 с.", pharmacy)
        self.assertNotIn("нацен", pharmacy.lower())
        self.assertNotIn("прибыл", pharmacy.lower())
        self.assertIn("Получатель: &lt;Фируз&gt;", delivery)
        self.assertIn("Забрать из аптеки 1", delivery)
        self.assertIn("NOW D3 × 2", delivery)
        self.assertIn("Позвонить: +992917123456", delivery)

    def test_long_orders_fit_telegram_limit(self):
        text = format_owner_message({
            "items": [{"medicine_name": "Очень длинное название " * 8, "quantity": 1, "line_total": 10}] * 100,
            "order_total": 1000,
            "profit": 50,
        })
        self.assertLess(len(text), 4096)
        self.assertIn("остальные товары", text)

    def test_staff_order_identifies_pharmacy_and_source(self):
        text = format_owner_message({
            "notification_kind": "staff_manual_order", "order_reference": "3456-012",
            "created_by_staff_account_id": 2, "created_by_staff_username": "vatan_2",
            "order_source": "instagram", "customer_name": "", "phone": "+992917123456",
            "address": "Айни 29", "landmark": "напротив школы",
            "items": [{"medicine_name": "NOW D3", "quantity": 2, "base_line_total": 100, "line_total": 106}],
            "base_total": 100, "order_total": 106, "profit": 6,
        })
        self.assertIn("аптека 2", text)
        self.assertIn("vatan_2", text)
        self.assertIn("Instagram", text)
        self.assertIn("напротив школы", text)
        self.assertIn("100.00 с. / 106.00 с.", text)


class TelegramDispatchTests(unittest.TestCase):
    def test_authorizer_requires_matching_bearer_token(self):
        event = {
            "type": "TOKEN",
            "authorizationToken": "Bearer secret",
            "methodArn": "arn:aws:execute-api:eu-central-1:123:api/prod/POST/path",
        }
        with patch.dict("os.environ", {"NOTIFIER_BEARER_TOKEN": "secret"}):
            allowed = lambda_handler(event, None)
            denied = lambda_handler({**event, "authorizationToken": "Bearer wrong"}, None)
        self.assertEqual(allowed["policyDocument"]["Statement"][0]["Effect"], "Allow")
        self.assertEqual(denied["policyDocument"]["Statement"][0]["Effect"], "Deny")

    @patch("backend.v1.telegram_notifier.lambda_function._claim_delivery")
    @patch("backend.v1.telegram_notifier.lambda_function._send_message")
    def test_website_order_goes_to_owner_pharmacy_and_twice_to_courier(self, send_message, claim):
        claim.side_effect = lambda key, channel: {'claimed': True, 'fields': default_policies()[channel]}
        event = {
            "requestContext": {"requestId": "test"},
            "body": json.dumps({"admin_order_id": 1, "order_reference": "1234-001", "items": []}),
        }
        with patch.dict("os.environ", {
            "TELEGRAM_BOT_TOKEN": "token", "TELEGRAM_OWNER_CHAT_ID": "owner",
            "TELEGRAM_PHARMACY_CHAT_ID": "pharmacy", "TELEGRAM_DELIVERY_CHAT_ID": "courier",
        }):
            response = lambda_handler(event, None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(send_message.call_count, 4)
        self.assertEqual([call.args[1] for call in send_message.call_args_list],
                         ["owner", "pharmacy", "courier", "courier"])
        self.assertFalse(send_message.call_args_list[1].kwargs["include_admin_link"])
        self.assertIn("Новая доставка", send_message.call_args_list[2].args[2])
        self.assertIn("переслать в аптеку", send_message.call_args_list[3].args[2])
        self.assertEqual(json.loads(response["body"])["data"]["messages_sent"], 4)

    @patch("backend.v1.telegram_notifier.lambda_function._claim_delivery")
    @patch("backend.v1.telegram_notifier.lambda_function._send_message")
    def test_staff_order_sends_owner_notification_only(self, send_message, claim):
        claim.side_effect = lambda key, channel: {'claimed': True, 'fields': default_policies()[channel]}
        event = {
            "requestContext": {"requestId": "test"},
            "body": json.dumps({"notification_kind": "staff_manual_order", "admin_order_id": 1,
                                "created_by_staff_account_id": 3, "order_reference": "1234-001"}),
        }
        with patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "token", "TELEGRAM_OWNER_CHAT_ID": "123"}):
            response = lambda_handler(event, None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(send_message.call_count, 1)
        self.assertEqual(json.loads(response["body"])["data"]["messages_sent"], 1)

    def test_courier_notification_uses_selected_pharmacy(self):
        event = {"notification_kind": "staff_manual_order", "created_by_staff_account_id": 3,
                 "created_by_staff_username": "courier", "fulfillment_pharmacy_id": 2,
                 "comment": "Вход <со двора>"}
        text = format_owner_message(event)
        self.assertIn("аптека 2", text)
        self.assertIn("Доставщик: courier", text)
        self.assertIn("Вход &lt;со двора&gt;", text)
        self.assertNotIn("аптека 3", text)

    @patch("backend.v1.telegram_notifier.lambda_function._claim_delivery")
    @patch("backend.v1.telegram_notifier.lambda_function._send_message")
    def test_courier_created_order_never_sends_courier_or_pharmacy_message(self, send_message, claim):
        claim.side_effect = lambda key, channel: {'claimed': True, 'fields': default_policies()[channel]}
        event = {
            "requestContext": {"requestId": "test"},
            "body": json.dumps({
                "notification_kind": "staff_manual_order", "admin_order_id": 1,
                "created_by_staff_account_id": 3, "order_reference": "1234-001",
                "address": "Айни 29", "landmark": "школа", "items": [],
            }),
        }
        with patch.dict("os.environ", {
            "TELEGRAM_BOT_TOKEN": "token", "TELEGRAM_OWNER_CHAT_ID": "owner",
            "TELEGRAM_DELIVERY_BOT_TOKEN": "delivery-token",
            "TELEGRAM_DELIVERY_CHAT_ID": "courier",
        }):
            response = lambda_handler(event, None)
        self.assertEqual(send_message.call_count, 1)
        self.assertEqual(send_message.call_args.args[:2], ("token", "owner"))
        self.assertEqual(json.loads(response["body"])["data"]["messages_sent"], 1)

    @patch("backend.v1.telegram_notifier.lambda_function._claim_delivery")
    @patch("backend.v1.telegram_notifier.lambda_function._send_message")
    def test_disabled_courier_and_duplicate_event_send_no_extra_message(self, send_message, claim):
        claim.side_effect = lambda key, channel: {
            'claimed': channel == 'owner_telegram', 'fields': default_policies()[channel]
        }
        event = {'admin_order_id': 17, 'order_reference': '1234-017', 'items': []}
        with patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': 'token', 'TELEGRAM_OWNER_CHAT_ID': 'owner',
                                    'TELEGRAM_DELIVERY_CHAT_ID': 'courier'}, clear=True):
            result = lambda_handler(event, None)
        self.assertEqual(result['messages_sent'], 1)
        self.assertEqual(send_message.call_args.args[1], 'owner')

    @patch("backend.v1.telegram_notifier.lambda_function._claim_delivery")
    @patch("backend.v1.telegram_notifier.lambda_function._send_message")
    def test_staff_created_order_goes_to_owner_only(self, send_message, claim):
        claim.side_effect = lambda key, channel: {'claimed': True, 'fields': default_policies()[channel]}
        event = {'admin_order_id': 18, 'notification_kind': 'staff_manual_order',
                 'created_by_staff_account_id': 1, 'order_reference': '1234-018', 'items': []}
        with patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': 'token', 'TELEGRAM_OWNER_CHAT_ID': 'owner',
                                    'TELEGRAM_PHARMACY_CHAT_ID': 'pharmacy',
                                    'TELEGRAM_DELIVERY_CHAT_ID': 'courier'}, clear=True):
            result = lambda_handler(event, None)
        self.assertEqual(result['messages_sent'], 1)
        self.assertEqual([call.args[1] for call in send_message.call_args_list], ['owner'])

    def test_courier_buttons_open_order_and_call_client(self):
        event = {'order_id': 'ord_' + 'a' * 32, 'phone': '+992 917-12-34-56'}
        with patch.dict('os.environ', {'STAFF_SITE_BASE_URL': 'https://vatan.example/'}):
            buttons = courier_buttons(event)
        self.assertEqual(buttons, [
            {'text': '📦 Открыть заказ', 'url': 'https://vatan.example/staff/orders/ord_' + 'a' * 32},
            {'text': '📞 Позвонить', 'url': 'https://vatan.example/call/992917123456'},
        ])
        with patch.dict('os.environ', {'STAFF_SITE_BASE_URL': 'http://insecure'}):
            self.assertEqual(courier_buttons(event), [])
        with patch.dict('os.environ', {'STAFF_SITE_BASE_URL': 'https://vatan.example'}):
            self.assertEqual(courier_buttons({'order_id': '../x', 'phone': '12'}), [])

    def test_assembly_message_lists_items_without_client_data(self):
        text = format_courier_assembly_message({
            'order_reference': '1234-001', 'customer_name': 'Секрет', 'phone': '+992917123456',
            'items': [{'medicine_name': 'Парацетамол', 'quantity': '2', 'base_line_total': '36'}],
            'base_total': '36', 'fulfillment_pharmacy_id': 1,
        })
        self.assertIn('Заказ на сборку 1234-001', text)
        self.assertIn('Аптека 1', text)
        self.assertIn('Парацетамол × 2', text)
        self.assertNotIn('Секрет', text)
        self.assertNotIn('917123456', text)



CHANGE_KEY = 'order:41:pharmacy-change:req_' + 'cd' * 16
CHANGE_EVENT = {
    'notification_kind': 'pharmacy_item_change', 'admin_order_id': 41, 'order_id': 'ord_' + 'b' * 32,
    'order_reference': '1910-041', 'pharmacy_id': 1, 'event_key': CHANGE_KEY,
    'changes': [
        {'kind': 'routed', 'medicine_name': 'Нурофен <форте>', 'quantity': '2'},
        {'kind': 'price', 'medicine_name': 'Парацетамол', 'quantity': '0.5',
         'old_base_unit_price': '40.00', 'new_base_unit_price': '45.00',
         'old_selling_unit_price': '48', 'new_selling_unit_price': '54'},
    ],
}
CHANGE_ENV = {'TELEGRAM_BOT_TOKEN': 'token', 'TELEGRAM_OWNER_CHAT_ID': 'owner',
              'TELEGRAM_PHARMACY_CHAT_ID': 'pharmacy', 'TELEGRAM_DELIVERY_CHAT_ID': 'courier',
              'TELEGRAM_DELIVERY_BOT_TOKEN': 'delivery-token', 'STAFF_SITE_BASE_URL': 'https://vatan.example',
              'ADMIN_ORDER_BASE_URL': 'https://vatan.example/admin/orders'}


class PharmacyChangeNotificationTests(unittest.TestCase):
    def test_owner_text_has_reference_pharmacy_items_and_base_and_client_prices(self):
        text = format_pharmacy_change_message(CHANGE_EVENT, default_policies()['owner_telegram'])
        self.assertIn('Заказ № 1910-041 · Ватан 1', text)
        self.assertIn('«Нурофен &lt;форте&gt;» × 2 — передано в Ватан 2', text)
        self.assertIn('«Парацетамол» × 0.5 — цена изменена: 40.00 → 45.00 с. (клиенту 48.00 → 54.00 с.)', text)

    def test_price_parts_follow_the_claimed_policy(self):
        courier = format_pharmacy_change_message(CHANGE_EVENT, default_policies()['courier_telegram'])
        self.assertIn('— цена изменена', courier)
        self.assertNotIn('40.00', courier)
        self.assertNotIn('45.00', courier)
        client_only = {**default_policies()['courier_telegram'], 'item_client_total': True}
        text = format_pharmacy_change_message(CHANGE_EVENT, client_only)
        self.assertIn('цена изменена: клиенту 48.00 → 54.00 с.', text)
        self.assertNotIn('40.00', text)
        base_only = {**default_policies()['owner_telegram'], 'item_client_total': False}
        text = format_pharmacy_change_message(CHANGE_EVENT, base_only)
        self.assertIn('цена изменена: 40.00 → 45.00 с.', text)
        self.assertNotIn('клиенту', text)

    @patch('backend.v1.telegram_notifier.lambda_function._claim_delivery')
    @patch('backend.v1.telegram_notifier.lambda_function._send_message')
    def test_owner_and_courier_get_one_message_each_and_pharmacy_none(self, send_message, claim):
        claim.side_effect = lambda key, channel: {'claimed': True, 'fields': default_policies()[channel]}
        event = {'requestContext': {'requestId': 'test'}, 'body': json.dumps(CHANGE_EVENT)}
        with patch.dict('os.environ', CHANGE_ENV, clear=True):
            response = lambda_handler(event, None)
        self.assertEqual(json.loads(response['body'])['data']['messages_sent'], 2)
        self.assertEqual([call.args for call in claim.call_args_list],
                         [(CHANGE_KEY, 'owner_telegram'), (CHANGE_KEY, 'courier_telegram')])
        self.assertEqual([call.args[:2] for call in send_message.call_args_list],
                         [('token', 'owner'), ('delivery-token', 'courier')])
        owner, courier = send_message.call_args_list
        self.assertTrue(owner.kwargs['include_admin_link'])
        self.assertIsNone(owner.kwargs.get('buttons'))
        self.assertFalse(courier.kwargs['include_admin_link'])
        self.assertEqual(courier.kwargs['buttons'], [
            {'text': '📦 Открыть заказ', 'url': 'https://vatan.example/staff/orders/ord_' + 'b' * 32}])
        self.assertIn('40.00 → 45.00', owner.args[2])
        self.assertNotIn('40.00', courier.args[2])
        for call in send_message.call_args_list:
            self.assertNotIn('собрать', call.args[2])
            self.assertNotIn('переслать в аптеку', call.args[2])

    @patch('backend.v1.telegram_notifier.lambda_function._claim_delivery')
    @patch('backend.v1.telegram_notifier.lambda_function._send_message')
    def test_unclaimed_recipient_and_second_claim_send_nothing(self, send_message, claim):
        claim.side_effect = lambda key, channel: {'claimed': channel == 'owner_telegram',
                                                  'fields': default_policies()[channel]}
        with patch.dict('os.environ', CHANGE_ENV, clear=True):
            result = lambda_handler(dict(CHANGE_EVENT), None)
        self.assertEqual(result['messages_sent'], 1)
        self.assertEqual(send_message.call_args.args[1], 'owner')
        claim.side_effect = lambda key, channel: {'claimed': False, 'fields': {}}
        send_message.reset_mock()
        with patch.dict('os.environ', CHANGE_ENV, clear=True):
            again = lambda_handler(dict(CHANGE_EVENT), None)
        self.assertEqual(again['messages_sent'], 0)
        send_message.assert_not_called()

    @patch('backend.v1.telegram_notifier.lambda_function._claim_delivery')
    @patch('backend.v1.telegram_notifier.lambda_function._send_message')
    def test_event_key_must_match_the_order(self, send_message, claim):
        for key in ('order:42:pharmacy-change:req_' + 'cd' * 16, 'order:41:created', None):
            with self.subTest(key=key), patch.dict('os.environ', CHANGE_ENV, clear=True), \
                    self.assertRaises(RuntimeError):
                lambda_handler({**CHANGE_EVENT, 'event_key': key}, None)
        claim.assert_not_called()
        send_message.assert_not_called()
    # --- job 014: «Ватан 2» «Нет в наличии» -------------------------------------------------------

    def test_unavailable_both_line_for_vatan2(self):
        event = {**CHANGE_EVENT, 'pharmacy_id': 2, 'changes': [
            {'kind': 'unavailable_both', 'medicine_name': 'Нурофен <форте>', 'quantity': '2'}]}
        for channel in ('owner_telegram', 'courier_telegram'):
            with self.subTest(channel=channel):
                text = format_pharmacy_change_message(event, default_policies()[channel])
                self.assertIn('Заказ № 1910-041 · Ватан 2', text)
                self.assertIn('«Нурофен &lt;форте&gt;» × 2 — нет в наличии в обеих аптеках', text)

    def test_change_messages_never_carry_client_data(self):
        private = {'customer_name': 'SECRET-NAME', 'phone': '+992917123456', 'address': 'SECRET-ADDRESS',
                   'landmark': 'SECRET-LANDMARK', 'comment': 'SECRET-COMMENT', 'notes': 'SECRET-NOTES'}
        changes = CHANGE_EVENT['changes'] + [
            {'kind': 'unavailable_both', 'medicine_name': 'Аспирин', 'quantity': '1', **private}]
        for pharmacy_id in (1, 2):
            event = {**CHANGE_EVENT, **private, 'pharmacy_id': pharmacy_id,
                     'changes': [{**change, **private} for change in changes]}
            for channel in ('owner_telegram', 'courier_telegram'):
                with self.subTest(pharmacy_id=pharmacy_id, channel=channel):
                    everything = {**default_policies()[channel], **{key: True for key in default_policies()[channel]}}
                    text = format_pharmacy_change_message(event, everything)
                    for value in private.values():
                        self.assertNotIn(value, text)
                    self.assertNotIn('917123456', text)

    def test_unknown_change_kind_is_skipped(self):
        event = {**CHANGE_EVENT, 'changes': [{'kind': 'secret', 'medicine_name': 'X', 'quantity': '1'}]}
        text = format_pharmacy_change_message(event, default_policies()['owner_telegram'])
        self.assertNotIn('«X»', text)



if __name__ == "__main__":
    unittest.main()
