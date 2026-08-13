import json
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

from backend.v1.admin_api.lambda_function import (
    _carousel_values,
    _image_url,
    add_product_carousel_item,
    lambda_handler as admin_handler,
)
from backend.v1.public_api.lambda_function import list_product_carousels
from backend.v1.shared.contract import ContractError


class CarouselValidationTests(unittest.TestCase):
    def test_accepts_configurable_order(self):
        values = _carousel_values({"slug": "best-sellers", "title": "Хиты продаж", "sort_order": 20}, creating=True)
        self.assertEqual(values["sort_order"], 20)
        self.assertTrue(values["is_active"])

    def test_rejects_invalid_slug_and_boolean_order(self):
        with self.assertRaises(ContractError):
            _carousel_values({"slug": "Best Sellers", "title": "Valid title"}, creating=True)
        with self.assertRaises(ContractError):
            _carousel_values({"slug": "best-sellers", "title": "Valid title", "sort_order": True}, creating=True)

    def test_image_must_be_https_and_is_trimmed(self):
        self.assertEqual(_image_url(" https://cdn.example/item.jpg "), "https://cdn.example/item.jpg")
        self.assertIsNone(_image_url(""))
        with self.assertRaises(ContractError):
            _image_url("http://cdn.example/item.jpg")


class CarouselQueryTests(unittest.TestCase):
    def test_public_retrieval_preserves_section_and_product_order(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [
                {"id": 2, "slug": "items-of-the-day", "title": "Товары дня", "sort_order": 10},
                {"id": 5, "slug": "best-sellers", "title": "Хиты продаж", "sort_order": 20},
            ],
            [
                {
                    "carousel_id": 2, "id": 11, "name": "A", "price": Decimal("10.00"),
                    "country": "TJ", "vendor": "V", "in_stock": True,
                    "updated_at": datetime(2026, 8, 11, tzinfo=timezone.utc),
                    "image_url": "https://cdn.example/a.jpg", "item_sort_order": 5,
                },
                {
                    "carousel_id": 2, "id": 12, "name": "B", "price": Decimal("20.00"),
                    "country": "TJ", "vendor": "V", "in_stock": True,
                    "updated_at": datetime(2026, 8, 11, tzinfo=timezone.utc),
                    "image_url": None, "item_sort_order": 10,
                },
            ],
        ]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch("backend.v1.public_api.lambda_function.transaction", fake_transaction):
            result = list_product_carousels()
        self.assertEqual([item["slug"] for item in result["carousels"]], ["items-of-the-day", "best-sellers"])
        self.assertEqual([item["medicine_id"] for item in result["carousels"][0]["products"]], [11, 12])
        self.assertEqual(result["carousels"][0]["products"][0]["image_url"], "https://cdn.example/a.jpg")

    def test_duplicate_product_is_rejected(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [{"exists": 1}, {"exists": 1}]

        def execute(sql, params=None):
            cursor.rowcount = 0 if "INSERT INTO product_carousel_items" in sql else 1

        cursor.execute.side_effect = execute

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction):
            with self.assertRaises(ContractError) as raised:
                add_product_carousel_item(1, {"medicine_id": 99, "sort_order": 10})
        self.assertEqual(raised.exception.code, "DUPLICATE_PRODUCT")
        self.assertEqual(raised.exception.http_status, 409)

    def test_admin_route_requires_server_authorization(self):
        response = admin_handler({"httpMethod": "GET", "path": "/v1/admin/product-carousels"}, None)
        self.assertEqual(response["statusCode"], 403)
        self.assertEqual(json.loads(response["body"])["error"]["code"], "FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
