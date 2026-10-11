import unittest
import json
from decimal import Decimal
from unittest.mock import patch

from backend.v1.telegram_notifier.lambda_function import (
    format_configured_message,
    format_delivery_message,
    format_owner_message,
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
    def test_api_gateway_payload_sends_three_messages(self, send_message, claim):
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
        self.assertEqual(send_message.call_count, 3)
        self.assertEqual([call.args[1] for call in send_message.call_args_list], ["owner", "pharmacy", "courier"])
        self.assertFalse(send_message.call_args_list[1].kwargs["include_admin_link"])

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
    def test_pharmacy_created_order_goes_to_owner_and_courier(self, send_message, claim):
        claim.side_effect = lambda key, channel: {'claimed': True, 'fields': default_policies()[channel]}
        event = {'admin_order_id': 18, 'notification_kind': 'staff_manual_order',
                 'created_by_staff_account_id': 1, 'order_reference': '1234-018', 'items': []}
        with patch.dict('os.environ', {'TELEGRAM_BOT_TOKEN': 'token', 'TELEGRAM_OWNER_CHAT_ID': 'owner',
                                    'TELEGRAM_DELIVERY_CHAT_ID': 'courier'}, clear=True):
            result = lambda_handler(event, None)
        self.assertEqual(result['messages_sent'], 2)
        self.assertEqual([call.args[1] for call in send_message.call_args_list], ['owner', 'courier'])


if __name__ == "__main__":
    unittest.main()
