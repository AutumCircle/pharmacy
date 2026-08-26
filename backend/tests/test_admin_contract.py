import json
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from backend.v1.admin_api.lambda_function import (
    create_category,
    lambda_handler,
    update_category,
    update_homepage_banner,
)
from backend.v1.shared.contract import ContractError


class AdminCategoryValidationTests(unittest.TestCase):
    def test_rejects_one_character_slug(self):
        with self.assertRaises(ContractError):
            create_category({"slug": "a", "name": "A"})

    def test_rejects_non_hex_color(self):
        with self.assertRaises(ContractError):
            create_category({"slug": "pain-relief", "name": "Pain", "color": "red"})

    def test_rejects_boolean_sort_order(self):
        with self.assertRaises(ContractError):
            create_category({"slug": "pain-relief", "name": "Pain", "sort_order": True})

    def test_rejects_string_is_active(self):
        with self.assertRaises(ContractError):
            update_category(1, {"is_active": "false"})

    def test_rejects_unknown_update_field(self):
        with self.assertRaises(ContractError):
            update_category(1, {"slug": "changed"})

    def test_banner_title_can_be_empty_for_image_only_banner(self):
        class Cursor:
            def execute(self, query, values):
                self.values = values

            def fetchone(self):
                return {
                    "slot": "left",
                    "title": self.values[0],
                    "subtitle": None,
                    "image_url": "https://cdn.example/banner.png",
                    "link_url": None,
                    "is_active": True,
                    "updated_at": "2026-08-26T00:00:00Z",
                }

        cursor = Cursor()

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction):
            result = update_homepage_banner("left", {"title": "   "})

        self.assertEqual(result["title"], "")
        self.assertEqual(cursor.values, ("", "left"))


class AdminRouteAuthorizationTests(unittest.TestCase):
    def test_api_key_without_authorizer_role_is_forbidden(self):
        response = lambda_handler({
            "httpMethod": "GET",
            "path": "/v1/admin/orders",
            "headers": {"x-api-key": "usage-plan-only"},
        }, None)
        self.assertEqual(response["statusCode"], 403)
        body = json.loads(response["body"])
        self.assertEqual(body["error"]["code"], "FORBIDDEN")

    def test_delete_routes_require_admin_authorization(self):
        for path in ("/v1/admin/orders/order_1", "/v1/admin/categories/1"):
            with self.subTest(path=path):
                response = lambda_handler({"httpMethod": "DELETE", "path": path}, None)
                self.assertEqual(response["statusCode"], 403)
                self.assertEqual(json.loads(response["body"])["error"]["code"], "FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
