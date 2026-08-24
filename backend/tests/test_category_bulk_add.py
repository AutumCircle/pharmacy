import json
import unittest
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from backend.v1.admin_api.lambda_function import (
    _literal_ilike_pattern,
    bulk_add_category_medicines,
    lambda_handler,
    preview_category_medicine_bulk_add,
)
from backend.v1.shared.contract import ContractError


def fake_transaction_for(cursor):
    @contextmanager
    def fake_transaction():
        yield cursor
    return fake_transaction


class CategoryBulkAddValidationTests(unittest.TestCase):
    def test_like_metacharacters_are_escaped_as_literals(self):
        self.assertEqual(_literal_ilike_pattern(r"a%_\b"), r"%a\%\_\\b%")

    def test_preview_rejects_fragments_shorter_than_two_characters(self):
        with self.assertRaises(ContractError) as raised:
            preview_category_medicine_bulk_add(1, {"fragment": "%"})
        self.assertEqual(raised.exception.code, "VALIDATION_ERROR")

    def test_mutation_requires_exact_confirmation_shape(self):
        for payload in (
            {"fragment": "now"},
            {"fragment": "now", "confirmed_count": True},
            {"fragment": "now", "confirmed_count": 2, "medicine_ids": [1, 2]},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ContractError):
                    bulk_add_category_medicines(1, payload, "admin:test", "req_test")


class CategoryBulkAddQueryTests(unittest.TestCase):
    def test_preview_returns_total_and_numbered_page_with_literal_parameter(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [{"exists": 1}, {"count": 23}]
        cursor.fetchall.return_value = [{
            "medicine_id": 7,
            "medicine_name": "A%_ medicine",
            "already_present": False,
        }]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = preview_category_medicine_bulk_add(
                4, {"fragment": "%_", "page": "2", "limit": "10"},
            )

        self.assertEqual(result["total"], 23)
        self.assertEqual(result["page"]["number"], 2)
        self.assertEqual(result["page"]["total_pages"], 3)
        count_sql, count_params = cursor.execute.call_args_list[1].args
        self.assertIn("ILIKE %s", count_sql)
        self.assertIn("ESCAPE", count_sql)
        self.assertNotIn("%_", count_sql)
        self.assertEqual(count_params, (r"%\%\_%",))

    def test_bulk_add_is_one_set_based_insert_and_reports_counts(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"id": 4},
            {"matched": 5, "added": 3},
        ]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            result = bulk_add_category_medicines(
                4,
                {"fragment": "now", "confirmed_count": 5},
                "admin:test",
                "req_test",
            )

        self.assertEqual(result["matched"], 5)
        self.assertEqual(result["added"], 3)
        self.assertEqual(result["already_present"], 2)
        statements = [call.args[0] for call in cursor.execute.call_args_list]
        insert_statements = [sql for sql in statements if "INSERT INTO category_medicines" in sql]
        self.assertEqual(len(insert_statements), 1)
        self.assertIn("SELECT %s, matched.medicine_id", insert_statements[0])
        self.assertIn("ON CONFLICT DO NOTHING", insert_statements[0])
        self.assertNotIn("DELETE FROM category_medicines", "\n".join(statements))

    def test_changed_match_count_rejects_stale_confirmation(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"id": 4},
            {"matched": 6, "added": 0},
        ]
        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction_for(cursor)):
            with self.assertRaises(ContractError) as raised:
                bulk_add_category_medicines(
                    4,
                    {"fragment": "now", "confirmed_count": 5},
                    "admin:test",
                    "req_test",
                )
        self.assertEqual(raised.exception.code, "BULK_PREVIEW_STALE")
        self.assertEqual(raised.exception.http_status, 409)


class CategoryBulkAddAuthorizationTests(unittest.TestCase):
    def test_preview_and_mutation_require_admin_authorization(self):
        cases = [
            ("GET", "/v1/admin/categories/4/medicines/bulk-preview", None),
            ("POST", "/v1/admin/categories/4/medicines/bulk-add", {"fragment": "now", "confirmed_count": 2}),
        ]
        for method, path, body in cases:
            with self.subTest(method=method):
                event = {"httpMethod": method, "path": path}
                if body is not None:
                    event["body"] = json.dumps(body)
                response = lambda_handler(event, None)
                self.assertEqual(response["statusCode"], 403)
                self.assertEqual(json.loads(response["body"])["error"]["code"], "FORBIDDEN")


if __name__ == "__main__":
    unittest.main()
