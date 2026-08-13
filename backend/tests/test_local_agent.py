import gzip
import json
import tempfile
import unittest
from pathlib import Path

from backend.v1.local_agent.agent_sync import build_snapshot


class LocalAgentSnapshotTests(unittest.TestCase):
    def test_snapshot_is_deterministic_for_unchanged_dbf(self):
        with tempfile.TemporaryDirectory() as directory:
            dbf = Path(directory) / "OSTATKI.DBF"
            dbf.write_bytes(b"placeholder")
            config = {"dbf_path": str(dbf), "source_id": "main"}
            records = [{"name": "Aspirin", "price": "10.00", "country": "", "vendor": ""}]
            first, first_hash, first_time = build_snapshot(config, records)
            second, second_hash, second_time = build_snapshot(config, records)
        self.assertEqual(first, second)
        self.assertEqual(first_hash, second_hash)
        self.assertEqual(first_time, second_time)

    def test_snapshot_document_has_v1_shape(self):
        with tempfile.TemporaryDirectory() as directory:
            dbf = Path(directory) / "OSTATKI.DBF"
            dbf.write_bytes(b"placeholder")
            compressed, _, _ = build_snapshot(
                {"dbf_path": str(dbf), "source_id": "main"},
                [{"name": "*Aspirin", "price": "10.00", "country": "", "vendor": ""}],
            )
        document = json.loads(gzip.decompress(compressed))
        self.assertEqual(document["format"], "vatan-catalog-snapshot/v1")
        self.assertEqual(document["source_id"], "main")


if __name__ == "__main__":
    unittest.main()
