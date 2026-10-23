import json
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

from backend.v1.public_api import lambda_function as public_api
from backend.v1.shared.contract import ContractError, validate_create_order_request


class OrderCursor:
    def __init__(self, recent_orders=None, recent_items=None):
        self.saved_response = None
        self.saved_status = None
        self.order_insert_params = None
        self.statements = []
        self.recent_orders = recent_orders or []
        self.recent_items = recent_items or []
        self._result = None

    def execute(self, sql, params=None):
        text = " ".join(sql.split())
        self.statements.append(text)
        if text.startswith("INSERT INTO order_idempotency"):
            self._result = {"id": 1}
        elif text.startswith("SELECT id, name, price, (in_stock IS TRUE AND hidden_from_clients IS NOT TRUE) AS in_stock"):
            self._result = [{"id": 7, "name": "Paracetamol", "price": Decimal("100"), "in_stock": True,
                             "selling_unit_price": Decimal("230")}]
        elif text.startswith("SELECT o.id, o.public_id"):
            self._result = self.recent_orders
        elif text.startswith("SELECT order_id, medicine_id"):
            self._result = self.recent_items
        elif text.startswith("INSERT INTO orders"):
            self.order_insert_params = params
            self._result = {"id": 41, "public_id": params[9], "status": "pending", "items_subtotal": Decimal("460"),
                            "order_total": Decimal("460"), "payment_method": params[10],
                            "created_at": datetime(2026, 10, 13, 5, 3, tzinfo=timezone.utc)}
        elif text.startswith("UPDATE order_idempotency"):
            self.saved_response = json.loads(params[1])
            self.saved_status = 200 if "response_status = 200" in text else 201
            self._result = None
        else:
            self._result = None

    def fetchone(self):
        return self._result

    def fetchall(self):
        return self._result


BASE_PAYLOAD = {"customer_name": "Test", "phone": "+992900000001", "address": "Dushanbe, Rudaki 1",
                "items": [{"medicine_id": 7, "quantity": 2}]}
KEY = "3f2b8c1e-6a4d-4e7b-9c10-5d2a7b8e9f01"


def create(cursor, payload):
    @contextmanager
    def fake_transaction():
        yield cursor

    with patch.object(public_api, "transaction", fake_transaction):
        return public_api.create_order(payload, KEY)


class PublicOrderCreateTests(unittest.TestCase):
    def test_order_with_decimal_prices_is_created_and_response_is_stored(self):
        cursor = OrderCursor()
        response, status, notification = create(cursor, BASE_PAYLOAD)
        self.assertEqual(status, 201)
        self.assertEqual(response["order_total"], 460)
        self.assertEqual(cursor.saved_response["items"][0]["line_total"], 460)
        self.assertEqual(notification["order_total"], "460")
        # Job 013: a new order starts at «Собирается»; the status itself is unchanged.
        self.assertEqual((response["status"], response["stage"]), ("pending", "assembling"))
        self.assertEqual(cursor.saved_response["stage"], "assembling")

    def test_old_payload_without_landmark_or_payment_defaults_to_cash(self):
        cursor = OrderCursor()
        response, _, notification = create(cursor, BASE_PAYLOAD)
        self.assertEqual(response["payment_method"], "cash_on_delivery")
        self.assertEqual(cursor.order_insert_params[10], "cash_on_delivery")
        self.assertIsNone(cursor.order_insert_params[-1])
        self.assertIsNone(notification["landmark"])
        self.assertEqual(notification["payment_method"], "cash_on_delivery")

    def test_landmark_and_e_wallet_are_saved_separately_from_the_address(self):
        cursor = OrderCursor()
        payload = {**BASE_PAYLOAD, "address": "Такси Худжанд", "landmark": "  Отправка кардан даркор  ",
                   "payment_method": "e_wallet"}
        response, status, notification = create(cursor, payload)
        self.assertEqual(status, 201)
        self.assertEqual(cursor.order_insert_params[4], "Такси Худжанд")
        self.assertEqual(cursor.order_insert_params[-1], "Отправка кардан даркор")
        self.assertEqual(cursor.order_insert_params[10], "e_wallet")
        self.assertEqual(response["payment_method"], "e_wallet")
        self.assertEqual((notification["address"], notification["landmark"], notification["payment_method"]),
                         ("Такси Худжанд", "Отправка кардан даркор", "e_wallet"))

    def test_same_order_within_the_window_returns_the_existing_order(self):
        recent = [{"id": 40, "public_id": "ord_existing", "order_reference": "0001-040", "status": "pending",
                   "items_subtotal": Decimal("460"), "order_total": Decimal("460"), "payment_method": "cash_on_delivery",
                   "created_at": datetime(2026, 10, 13, 5, 1, tzinfo=timezone.utc), "stage_assembled": False}]
        items = [{"order_id": 40, "medicine_id": 7, "medicine_name": "Paracetamol", "selling_unit_price": Decimal("230"),
                  "quantity": Decimal("2.00"), "line_total": Decimal("460")}]
        cursor = OrderCursor(recent, items)
        response, status, notification = create(cursor, BASE_PAYLOAD)
        self.assertEqual((status, response["order_id"], response["order_reference"]), (200, "ord_existing", "0001-040"))
        self.assertTrue(response["deduplicated"])
        self.assertIsNone(notification)
        self.assertIsNone(cursor.order_insert_params)
        self.assertEqual((cursor.saved_status, cursor.saved_response["order_id"]), (200, "ord_existing"))
        self.assertTrue(any(statement.startswith("SELECT pg_advisory_xact_lock") for statement in cursor.statements))

    def test_recent_order_with_other_items_does_not_block_a_new_order(self):
        recent = [{"id": 40, "public_id": "ord_existing", "order_reference": "0001-040", "status": "pending",
                   "items_subtotal": Decimal("230"), "order_total": Decimal("230"), "payment_method": "cash_on_delivery",
                   "created_at": datetime(2026, 10, 13, 5, 1, tzinfo=timezone.utc), "stage_assembled": False}]
        items = [{"order_id": 40, "medicine_id": 7, "medicine_name": "Paracetamol", "selling_unit_price": Decimal("230"),
                  "quantity": Decimal("1.00"), "line_total": Decimal("230")}]
        cursor = OrderCursor(recent, items)
        _, status, notification = create(cursor, BASE_PAYLOAD)
        self.assertEqual(status, 201)
        self.assertIsNotNone(notification)
        self.assertIsNotNone(cursor.order_insert_params)


class CreateOrderContractTests(unittest.TestCase):
    def test_landmark_is_optional_and_trimmed(self):
        self.assertIsNone(validate_create_order_request(BASE_PAYLOAD)["landmark"])
        self.assertIsNone(validate_create_order_request({**BASE_PAYLOAD, "landmark": "   "})["landmark"])
        self.assertEqual(validate_create_order_request({**BASE_PAYLOAD, "landmark": " у школы "})["landmark"], "у школы")

    def test_invalid_landmark_and_payment_are_rejected(self):
        for extra in ({"landmark": "x" * 301}, {"landmark": 5}, {"payment_method": "card"},
                      {"payment_method": "online"}, {"payment_method": 1}):
            with self.subTest(extra=extra), self.assertRaises(ContractError):
                validate_create_order_request({**BASE_PAYLOAD, **extra})

    def test_both_payment_methods_are_accepted(self):
        for method in ("cash_on_delivery", "e_wallet"):
            self.assertEqual(validate_create_order_request({**BASE_PAYLOAD, "payment_method": method})["payment_method"],
                             method)


if __name__ == "__main__":
    unittest.main()
