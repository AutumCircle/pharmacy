import unittest
from contextlib import contextmanager
from unittest.mock import patch

from backend.v1.internal_sync import lambda_function as internal_sync
from backend.v1.shared.contract import ContractError


class FakeCursor:
    def __init__(self):
        self.statements = []

    def execute(self, statement, params=None):
        self.statements.append((statement, params))

    def fetchone(self):
        return None


class FakeS3:
    def generate_presigned_url(self, operation, Params, ExpiresIn):
        return "https://signed-upload.example.test/object"


@contextmanager
def fake_transaction():
    yield FakeCursor()


class InternalSyncInitiationTests(unittest.TestCase):
    def valid_payload(self):
        return {
            "source_id": "vatan-main-pharmacy",
            "source_updated_at": "2026-08-06T10:00:00+00:00",
            "file_name": "OSTATKI.DBF",
            "compressed_size_bytes": 1000,
            "expected_row_count": 10000,
            "snapshot_sha256": "a" * 64,
        }

    def test_rejects_wrong_source_before_database_access(self):
        payload = self.valid_payload()
        payload["source_id"] = "another-pharmacy"
        with patch.dict("os.environ", {"SYNC_SOURCE_ID": "vatan-main-pharmacy"}, clear=False):
            with self.assertRaises(ContractError) as raised:
                internal_sync.initiate_sync(payload, "agent-1", "9f4cdb09-8a9f-4e90-9666-0686d4094642")
        self.assertEqual(raised.exception.code, "VALIDATION_ERROR")

    def test_rejects_invalid_idempotency_key(self):
        with patch.dict("os.environ", {"SYNC_SOURCE_ID": "vatan-main-pharmacy"}, clear=False):
            with self.assertRaises(ContractError):
                internal_sync.initiate_sync(self.valid_payload(), "agent-1", "not-a-uuid")

    def test_creates_upload_target_for_valid_metadata(self):
        environment = {
            "SYNC_SOURCE_ID": "vatan-main-pharmacy",
            "SYNC_BUCKET": "private-sync-bucket",
            "SYNC_MIN_EXPECTED_ROWS": "5000",
        }
        with patch.dict("os.environ", environment, clear=False), patch.object(
            internal_sync, "transaction", fake_transaction
        ), patch.object(internal_sync, "_s3", FakeS3()):
            result = internal_sync.initiate_sync(
                self.valid_payload(), "agent-1", "9f4cdb09-8a9f-4e90-9666-0686d4094642"
            )
        self.assertEqual(result["status"], "awaiting_upload")
        self.assertEqual(result["upload"]["method"], "PUT")
        self.assertNotIn("private-sync-bucket", result["upload"]["url"])


class InternalSyncSnapshotGuardTests(unittest.TestCase):
    def test_rejects_catastrophic_partial_snapshot(self):
        allowed, reference, ratio = internal_sync.evaluate_snapshot_drop(6, 10684, 10683, 0.50)
        self.assertFalse(allowed)
        self.assertEqual(reference, 10684)
        self.assertLess(ratio, 0.001)

    def test_allows_future_smaller_but_plausible_catalog(self):
        allowed, reference, ratio = internal_sync.evaluate_snapshot_drop(5000, 8000, 7900, 0.50)
        self.assertTrue(allowed)
        self.assertEqual(reference, 8000)
        self.assertEqual(ratio, 0.625)


if __name__ == "__main__":
    unittest.main()
