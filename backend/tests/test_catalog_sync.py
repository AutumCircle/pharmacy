import unittest
from decimal import Decimal

from backend.v1.shared.catalog_sync import (
    SnapshotValidationError,
    normalize_catalog_item,
    validate_snapshot,
)


class CatalogNormalizationTests(unittest.TestCase):
    def test_leading_star_means_out_of_stock_and_is_removed(self):
        item = normalize_catalog_item(
            {"name": "  * Aspirin  ", "price": "10.2", "country": " TJ ", "vendor": " Vatan "},
            1,
            "main-pharmacy",
        )
        self.assertEqual(item.canonical_name, "Aspirin")
        self.assertFalse(item.in_stock)
        self.assertEqual(item.base_price, Decimal("10.20"))

    def test_name_without_star_is_in_stock(self):
        item = normalize_catalog_item({"name": "Aspirin", "price": 10}, 1, "main-pharmacy")
        self.assertTrue(item.in_stock)

    def test_double_star_is_rejected(self):
        with self.assertRaises(SnapshotValidationError):
            normalize_catalog_item({"name": "**Aspirin", "price": 10}, 1, "main-pharmacy")

    def test_non_positive_price_is_rejected(self):
        with self.assertRaises(SnapshotValidationError):
            normalize_catalog_item({"name": "Aspirin", "price": 0}, 1, "main-pharmacy")


class SnapshotValidationTests(unittest.TestCase):
    def test_rejects_row_count_mismatch(self):
        with self.assertRaises(SnapshotValidationError) as raised:
            validate_snapshot([], source_id="main", expected_row_count=1, minimum_row_count=1)
        self.assertEqual(raised.exception.code, "ROW_COUNT_MISMATCH")

    def test_rejects_snapshot_below_safety_threshold(self):
        with self.assertRaises(SnapshotValidationError) as raised:
            validate_snapshot(
                [{"name": "A", "price": 1}],
                source_id="main", expected_row_count=1, minimum_row_count=5000,
            )
        self.assertEqual(raised.exception.code, "SNAPSHOT_TOO_SMALL")

    def test_merges_case_insensitive_fallback_duplicate_using_highest_price(self):
        records = [
            {"name": "Aspirin", "price": 10, "country": "TJ", "vendor": "Vatan"},
            {"name": "aspirin", "price": 12, "country": "tj", "vendor": "vatan"},
        ]
        snapshot = validate_snapshot(
            records, source_id="main", expected_row_count=2, minimum_row_count=1,
        )
        self.assertEqual(snapshot.raw_row_count, 2)
        self.assertEqual(len(snapshot.items), 1)
        self.assertEqual(snapshot.items[0].base_price, Decimal("12.00"))
        self.assertEqual(snapshot.items[0].canonical_name, "aspirin")
        self.assertEqual(snapshot.duplicate_resolutions[0].row_numbers, [1, 2])

    def test_prefers_available_duplicate_before_price(self):
        records = [
            {"name": "*Aspirin", "price": 20, "country": "TJ", "vendor": "Vatan"},
            {"name": "aspirin", "price": 10, "country": "tj", "vendor": "vatan"},
        ]
        snapshot = validate_snapshot(
            records, source_id="main", expected_row_count=2, minimum_row_count=1,
        )
        self.assertTrue(snapshot.items[0].in_stock)
        self.assertEqual(snapshot.items[0].base_price, Decimal("10.00"))

    def test_rejects_duplicate_source_sku(self):
        records = [
            {"source_sku": "42", "name": "Aspirin", "price": 10},
            {"source_sku": "42", "name": "Aspirin new", "price": 12},
        ]
        with self.assertRaises(SnapshotValidationError) as raised:
            validate_snapshot(records, source_id="main", expected_row_count=2, minimum_row_count=1)
        self.assertEqual(raised.exception.code, "DUPLICATE_SOURCE_SKU")

    def test_source_sku_produces_stable_identity(self):
        first = normalize_catalog_item({"source_sku": "42", "name": "Old", "price": 10}, 1, "main")
        second = normalize_catalog_item({"source_sku": "42", "name": "New", "price": 11}, 2, "main")
        self.assertEqual(first.identity_key, second.identity_key)


if __name__ == "__main__":
    unittest.main()
