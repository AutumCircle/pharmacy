import json
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from backend.v1.admin_api.lambda_function import (
    batch_add_category_medicines,
    batch_add_product_carousel_items,
    batch_remove_category_medicines,
    batch_remove_product_carousel_items,
    lambda_handler,
    list_category_medicines,
    list_product_carousels,
    reorder_categories,
    reorder_product_carousel_page,
)


def fake_transaction_for(cursor):
    @contextmanager
    def fake_transaction():
        yield cursor
    return fake_transaction


class PaginatedAdminListTests(unittest.TestCase):
    def test_category_membership_uses_count_limit_and_offset(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [{"exists": 1}, {"count": 61}]
        cursor.fetchall.return_value = [{"medicine_id": 9, "medicine_name": "Nine"}]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = list_category_medicines(4, {"page": "3", "limit": "25", "q": "test"})
        self.assertEqual(result["page"]["total_items"], 61)
        self.assertEqual(result["page"]["total_pages"], 3)
        list_sql, list_params = cursor.execute.call_args_list[2].args
        self.assertIn("LIMIT %s OFFSET %s", list_sql)
        self.assertEqual(list_params[-2:], (25, 50))

    def test_carousel_metadata_does_not_load_every_product(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{
            "id": 2, "slug": "best", "title": "Best", "is_active": True,
            "sort_order": 10, "created_at": None, "updated_at": None, "product_count": 325,
        }]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = list_product_carousels()
        self.assertEqual(result["data"][0]["product_count"], 325)
        self.assertNotIn("products", result["data"][0])
        self.assertEqual(cursor.execute.call_count, 1)


class CategoryBatchMutationTests(unittest.TestCase):
    def test_batch_add_is_set_based_and_reports_existing_links(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [{"id": 4}, {"selected": 3, "found": 3, "added": 2}]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = batch_add_category_medicines(4, {"medicine_ids": [11, 12, 13]}, "admin", "req")
        self.assertEqual(result["already_present"], 1)
        statements = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertEqual(statements.count("INSERT INTO category_medicines"), 1)
        self.assertIn("unnest(%s::bigint[])", statements)

    def test_batch_remove_deletes_only_category_links(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"id": 4}
        cursor.fetchall.return_value = [{"medicine_id": 11}, {"medicine_id": 12}]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = batch_remove_category_medicines(4, {"medicine_ids": [11, 12, 13]}, "admin", "req")
        self.assertEqual(result["removed"], 2)
        statements = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("DELETE FROM category_medicines", statements)
        self.assertNotIn("DELETE FROM medicines", statements)

    def test_category_reorder_is_one_set_based_update(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"id": 1}, {"id": 2}, {"id": 3}]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            reorder_categories({"category_ids": [3, 1, 2]}, "admin", "req")
        statements = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertEqual(statements.count("UPDATE categories AS category"), 1)
        self.assertIn("WITH ORDINALITY", statements)


class CarouselBatchMutationTests(unittest.TestCase):
    def test_batch_add_is_set_based(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"id": 7},
            {"selected": 3, "found": 3, "maximum": 20, "added": 2},
        ]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = batch_add_product_carousel_items(7, {"medicine_ids": [1, 2, 3]}, "admin", "req")
        self.assertEqual(result["already_present"], 1)
        statements = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertEqual(statements.count("INSERT INTO product_carousel_items"), 1)

    def test_batch_remove_preserves_medicines_and_images(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"id": 7}
        cursor.fetchall.return_value = [{"medicine_id": 1}]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = batch_remove_product_carousel_items(7, {"medicine_ids": [1, 2]}, "admin", "req")
        self.assertEqual(result["already_absent"], 1)
        statements = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("DELETE FROM product_carousel_items", statements)
        self.assertNotIn("DELETE FROM medicines", statements)
        self.assertNotIn("image_url", statements)

    def test_page_reorder_reuses_existing_sort_slots(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [
            {"medicine_id": 1, "sort_order": 10},
            {"medicine_id": 2, "sort_order": 20},
        ]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            reorder_product_carousel_page(7, {"medicine_ids": [2, 1]}, "admin", "req")
        update_sql, update_params = cursor.execute.call_args_list[1].args
        self.assertIn("unnest(%s::bigint[], %s::integer[])", update_sql)
        self.assertEqual(update_params, ([2, 1], [10, 20], 7))


class NewRouteAuthorizationTests(unittest.TestCase):
    def test_batch_and_reorder_routes_require_admin_identity(self):
        for method, path in (
            ("DELETE", "/v1/admin/categories/4/medicines/batch"),
            ("PATCH", "/v1/admin/categories/reorder"),
            ("POST", "/v1/admin/product-carousels/7/products/batch"),
            ("PATCH", "/v1/admin/product-carousels/reorder"),
        ):
            with self.subTest(path=path):
                response = lambda_handler({"httpMethod": method, "path": path, "body": json.dumps({})}, None)
                self.assertEqual(response["statusCode"], 403)


if __name__ == "__main__":
    unittest.main()
