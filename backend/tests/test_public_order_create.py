import json
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

from backend.v1.public_api import lambda_function as public_api


class OrderCursor:
    def __init__(self):
        self.saved_response = None
        self._result = None

    def execute(self, sql, params=None):
        text = " ".join(sql.split())
        if text.startswith("INSERT INTO order_idempotency"):
            self._result = {"id": 1}
        elif text.startswith("SELECT id, name, price, in_stock"):
            self._result = [{"id": 7, "name": "Paracetamol", "price": Decimal("100"), "in_stock": True,
                             "selling_unit_price": Decimal("230")}]
        elif text.startswith("INSERT INTO orders"):
            self._result = {"id": 41, "public_id": params[9], "status": "pending", "items_subtotal": Decimal("460"),
                            "order_total": Decimal("460"),
                            "created_at": datetime(2026, 10, 13, 5, 3, tzinfo=timezone.utc)}
        elif text.startswith("UPDATE order_idempotency"):
            self.saved_response = json.loads(params[1])
            self._result = None
        else:
            self._result = None

    def fetchone(self):
        return self._result

    def fetchall(self):
        return self._result


class PublicOrderCreateTests(unittest.TestCase):
    def test_order_with_decimal_prices_is_created_and_response_is_stored(self):
        cursor = OrderCursor()

        @contextmanager
        def fake_transaction():
            yield cursor

        payload = {"customer_name": "Test", "phone": "+992900000001", "address": "Dushanbe, Rudaki 1",
                   "items": [{"medicine_id": 7, "quantity": 2}]}
        with patch.object(public_api, "transaction", fake_transaction):
            response, status, notification = public_api.create_order(payload, "3f2b8c1e-6a4d-4e7b-9c10-5d2a7b8e9f01")
        self.assertEqual(status, 201)
        self.assertEqual(response["order_total"], 460)
        self.assertEqual(cursor.saved_response["items"][0]["line_total"], 460)
        self.assertEqual(notification["order_total"], "460")
        # Job 013: a new order starts at «Собирается»; the status itself is unchanged.
        self.assertEqual((response["status"], response["stage"]), ("pending", "assembling"))
        self.assertEqual(cursor.saved_response["stage"], "assembling")


if __name__ == "__main__":
    unittest.main()
