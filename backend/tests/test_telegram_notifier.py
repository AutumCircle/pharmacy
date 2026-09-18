import unittest
import json
from decimal import Decimal
from unittest.mock import patch

from backend.v1.telegram_notifier.lambda_function import (
    format_delivery_message,
    format_owner_message,
    format_pharmacy_message,
    lambda_handler,
)


class TelegramMessageTests(unittest.TestCase):
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
        self.assertIn("Итого без наценки: 180.00 с.", pharmacy)
        self.assertIn("Получатель: &lt;Фируз&gt;", delivery)
        self.assertIn("Позвонить: +992917123456", delivery)

    def test_long_orders_fit_telegram_limit(self):
        text = format_owner_message({
            "items": [{"medicine_name": "Очень длинное название " * 8, "quantity": 1, "line_total": 10}] * 100,
            "order_total": 1000,
            "profit": 50,
        })
        self.assertLess(len(text), 4096)
        self.assertIn("остальные товары", text)


class TelegramDispatchTests(unittest.TestCase):
    @patch("backend.v1.telegram_notifier.lambda_function._send_message")
    def test_api_gateway_payload_sends_three_messages(self, send_message):
        event = {
            "requestContext": {"requestId": "test"},
            "body": json.dumps({"order_reference": "1234-001", "items": []}),
        }
        with patch.dict("os.environ", {"TELEGRAM_BOT_TOKEN": "token", "TELEGRAM_OWNER_CHAT_ID": "123"}):
            response = lambda_handler(event, None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(send_message.call_count, 3)


if __name__ == "__main__":
    unittest.main()
