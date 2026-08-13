import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from backend.v1.admin_api.lambda_function import delete_category, delete_order, list_medicine_duplicates
from backend.v1.shared.contract import ContractError


def fake_transaction_for(cursor):
    @contextmanager
    def fake_transaction():
        yield cursor
    return fake_transaction


class DuplicateGroupingTests(unittest.TestCase):
    def test_detail_returns_every_record_for_groups_of_two_three_four_and_more(self):
        for size in (2, 3, 4, 7):
            with self.subTest(size=size):
                cursor = MagicMock()
                cursor.fetchall.return_value = [
                    {"medicine_id": index, "medicine_name": "Test medicine"}
                    for index in range(1, size + 1)
                ]
                with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
                    result = list_medicine_duplicates({"group_key": "a" * 32})
                self.assertEqual(len(result["data"]), size)
                sql = cursor.execute.call_args.args[0]
                self.assertIn("regexp_replace", sql)
                self.assertNotIn("LIMIT", sql.upper())

    def test_pagination_is_applied_to_groups(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"count": 4}
        cursor.fetchall.return_value = [{
            "group_key": "b" * 32,
            "medicine_name": "A",
            "medicine_count": 5,
            "in_stock_count": 3,
            "out_of_stock_count": 2,
            "min_base_price": 10,
            "max_base_price": 20,
            "last_updated_at": None,
        }]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = list_medicine_duplicates({"page": "2", "limit": "1"})
        self.assertEqual(result["page"]["total_items"], 4)
        self.assertEqual(result["data"][0]["medicine_count"], 5)
        self.assertIn("GROUP BY", cursor.execute.call_args.args[0])


class OrderDeletionTests(unittest.TestCase):
    def test_soft_delete_preserves_dependencies_and_writes_audit(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"id": 7, "status": "pending", "deleted_at": None, "reference": "VAT-7"},
            {"deleted_at": datetime(2026, 8, 11, tzinfo=timezone.utc)},
        ]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = delete_order("order_7", "admin:test", "req_test")
        self.assertTrue(result["deleted"])
        statements = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("UPDATE orders", statements)
        self.assertIn("INSERT INTO admin_audit_log", statements)
        self.assertNotIn("DELETE FROM orders", statements)
        self.assertNotIn("DELETE FROM order_items", statements)

    def test_missing_repeated_and_prohibited_orders_are_rejected(self):
        cases = [
            (None, "ORDER_NOT_FOUND", 404),
            ({"id": 7, "status": "pending", "deleted_at": datetime.now(timezone.utc), "reference": "VAT-7"}, "ORDER_ALREADY_DELETED", 409),
            ({"id": 7, "status": "delivering", "deleted_at": None, "reference": "VAT-7"}, "ORDER_DELETE_STATE_CONFLICT", 409),
        ]
        for row, code, status in cases:
            with self.subTest(code=code):
                cursor = MagicMock()
                cursor.fetchone.return_value = row
                with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
                    with self.assertRaises(ContractError) as raised:
                        delete_order("order_7", "admin:test", "req_test")
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(raised.exception.http_status, status)


class CategoryDeletionTests(unittest.TestCase):
    def test_unused_category_is_deleted_and_audited(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"id": 3, "slug": "pain", "name": "Боль"},
            {"medicine_links": 0, "banner_links": 0},
        ]
        cursor.rowcount = 1
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = delete_category(3, "admin:test", "req_test")
        self.assertTrue(result["deleted"])
        statements = "\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("DELETE FROM categories", statements)
        self.assertIn("INSERT INTO admin_audit_log", statements)
        self.assertNotIn("DELETE FROM medicines", statements)

    def test_missing_and_in_use_categories_are_rejected(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            with self.assertRaises(ContractError) as missing:
                delete_category(99, "admin:test", "req_test")
        self.assertEqual(missing.exception.code, "CATEGORY_NOT_FOUND")

        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"id": 3, "slug": "pain", "name": "Боль"},
            {"medicine_links": 2, "banner_links": 1},
        ]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            with self.assertRaises(ContractError) as conflict:
                delete_category(3, "admin:test", "req_test")
        self.assertEqual(conflict.exception.code, "CATEGORY_IN_USE")
        self.assertEqual(conflict.exception.http_status, 409)


if __name__ == "__main__":
    unittest.main()
