import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import update_medicine_image


class MedicineImageTests(unittest.TestCase):
    def test_updates_one_medicine_and_audits(self):
        cursor = Mock()
        cursor.fetchone.return_value = {
            "medicine_id": 42, "medicine_name": "Тест", "image_url": "https://media.example/42.webp",
            "updated_at": "2026-10-04T00:00:00Z",
        }

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction):
            result = update_medicine_image(
                42, {"image_url": "https://media.example/42.webp"}, "admin", "req_test",
            )
        self.assertEqual(result["medicine_id"], 42)
        update_sql, update_params = cursor.execute.call_args_list[0].args
        self.assertIn("UPDATE medicines", update_sql)
        self.assertEqual(update_params, ("https://media.example/42.webp", 42))
        self.assertIn("medicine.image.updated", str(cursor.execute.call_args_list[1]))


if __name__ == "__main__":
    unittest.main()
