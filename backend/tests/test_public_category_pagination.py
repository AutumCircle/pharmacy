import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

from backend.v1.public_api.lambda_function import category_medicines


class PublicCategoryPaginationTests(unittest.TestCase):
    def test_counts_sellable_links_and_returns_requested_page(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            {"id": 4, "slug": "vitamins", "name": "Витамины", "icon": None, "color": None},
            {"count": 210},
        ]
        cursor.fetchall.return_value = [{
            "id": 49,
            "name": "Medicine 49",
            "price": Decimal("10.00"),
            "country": "TJ",
            "vendor": "Vendor",
            "in_stock": True,
            "updated_at": datetime(2026, 8, 25, tzinfo=timezone.utc),
            "image_url": "https://cdn.example/49.webp",
            "selling_unit_price": Decimal("11"),
        }]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch("backend.v1.public_api.lambda_function.transaction", fake_transaction):
            result = category_medicines("vitamins", {"page": "3", "limit": "24"})

        self.assertEqual(result["page"], {
            "number": 3,
            "size": 24,
            "total_items": 210,
            "total_pages": 9,
        })
        self.assertEqual(result["data"]["medicines"][0]["image_url"], "https://cdn.example/49.webp")
        count_sql, count_params = cursor.execute.call_args_list[1].args
        self.assertIn("COUNT(*)", count_sql)
        self.assertIn("m.in_stock IS TRUE", count_sql)
        self.assertEqual(count_params, (4,))
        page_sql, page_params = cursor.execute.call_args_list[2].args
        self.assertIn("ORDER BY m.name ASC, m.id ASC", page_sql)
        self.assertIn("LIMIT %s OFFSET %s", page_sql)
        self.assertEqual(page_params, (4, 24, 48))


if __name__ == "__main__":
    unittest.main()
