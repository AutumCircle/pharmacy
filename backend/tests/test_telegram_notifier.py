import os
import sys
import unittest
from decimal import Decimal
from unittest.mock import MagicMock, patch

from backend.v1.telegram_notifier.lambda_function import format_message
from backend.v1.public_api.lambda_function import notify_new_order


class TelegramMessageTests(unittest.TestCase):
    def test_formats_customer_items_total_and_profit_and_escapes_html(self):
        text = format_message({
            "order_reference": "1234-001",
            "customer_name": "<Фируз>",
            "phone": "+992917123456",
            "address": "Айни 29",
            "items": [{"medicine_name": "NOW D3", "quantity": 2, "line_total": 210}],
            "order_total": 210,
            "profit": Decimal("10.50"),
        })
        self.assertIn("Новый заказ 1234-001", text)
        self.assertIn("&lt;Фируз&gt;", text)
        self.assertIn("NOW D3 × 2", text)
        self.assertIn("Сумма: 210.00 с.", text)
        self.assertIn("Валовая прибыль: 10.50 с.", text)

    def test_long_orders_fit_telegram_limit(self):
        text = format_message({
            "items": [{"medicine_name": "Очень длинное название " * 8, "quantity": 1, "line_total": 10}] * 100,
            "order_total": 1000,
            "profit": 50,
        })
        self.assertLess(len(text), 4096)
        self.assertIn("остальные товары", text)


class TelegramDispatchTests(unittest.TestCase):
    def test_async_dispatch_and_disabled_configuration(self):
        client = MagicMock()
        boto3 = MagicMock()
        boto3.client.return_value = client
        with patch.dict(sys.modules, {"boto3": boto3}), patch.dict(os.environ, {"ORDER_NOTIFIER_FUNCTION_NAME": "notifier"}):
            notify_new_order({"order_reference": "1234-001"})
        self.assertEqual(client.invoke.call_args.kwargs["InvocationType"], "Event")
        client.reset_mock()
        with patch.dict(os.environ, {}, clear=True):
            notify_new_order({"order_reference": "1234-001"})
        client.invoke.assert_not_called()


if __name__ == "__main__":
    unittest.main()
