import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "backend" / "lambda-legacy" / "sync-receiver" / "lambda_function.py"
SPEC = importlib.util.spec_from_file_location("legacy_sync_receiver", str(MODULE_PATH))
legacy_sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(legacy_sync)


class LegacySyncGuardTests(unittest.TestCase):
    def test_rejects_catastrophic_partial_snapshot(self):
        allowed, reference, ratio = legacy_sync.evaluate_snapshot_drop(6, 10684, 10683, 0.50)
        self.assertFalse(allowed)
        self.assertEqual(reference, 10684)
        self.assertLess(ratio, 0.001)

    def test_allows_legitimate_ratio_based_catalog_change(self):
        allowed, reference, ratio = legacy_sync.evaluate_snapshot_drop(5000, 8000, 7900, 0.50)
        self.assertTrue(allowed)
        self.assertEqual(reference, 8000)
        self.assertEqual(ratio, 0.625)

    def test_ratio_configuration_is_bounded(self):
        with patch.dict(os.environ, {"SYNC_MIN_SNAPSHOT_RATIO": "0"}, clear=False):
            self.assertEqual(legacy_sync.minimum_snapshot_ratio(), 0.25)
        with patch.dict(os.environ, {"SYNC_MIN_SNAPSHOT_RATIO": "1"}, clear=False):
            self.assertEqual(legacy_sync.minimum_snapshot_ratio(), 0.90)


if __name__ == "__main__":
    unittest.main()
