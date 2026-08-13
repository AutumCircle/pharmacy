import json
import re
import unittest
from pathlib import Path

from scripts.validate_preflight_0002 import REQUIRED_CHECKS, PreflightReportError, validate_report


class PreflightReportTests(unittest.TestCase):
    def report(self, status="pass", ready=True):
        checks = [
            {"name": name, "status": "pass", "observed": 0, "message": "safe"}
            for name in sorted(REQUIRED_CHECKS)
        ]
        checks[0]["status"] = status
        counts = {candidate: sum(check["status"] == candidate for check in checks) for candidate in ("pass", "warn", "fail", "info")}
        return {
            "format": "vatan-0002-preflight/v1",
            "ready": ready,
            "summary": counts,
            "checks": checks,
        }

    def test_accepts_ready_report(self):
        self.assertTrue(validate_report(self.report())["ready"])

    def test_unwraps_lambda_body_and_data(self):
        envelope = {"body": json.dumps({"data": self.report()})}
        self.assertTrue(validate_report(envelope)["ready"])

    def test_accepts_consistent_failed_report(self):
        self.assertFalse(validate_report(self.report(status="fail", ready=False))["ready"])

    def test_rejects_inconsistent_ready_flag(self):
        with self.assertRaises(PreflightReportError):
            validate_report(self.report(status="fail", ready=True))

    def test_rejects_duplicate_check_names(self):
        report = self.report()
        report["checks"].append(dict(report["checks"][0]))
        with self.assertRaises(PreflightReportError):
            validate_report(report)

    def test_sql_preflight_is_declared_read_only_and_has_no_mutation_statements(self):
        root = Path(__file__).resolve().parents[2]
        sql = (root / "db" / "preflight" / "0002_catalog_sync_v1_preflight.sql").read_text(encoding="utf-8")
        self.assertIn("BEGIN TRANSACTION READ ONLY", sql.upper())
        mutation = re.compile(
            r"\b(?:INSERT\s+INTO|UPDATE\s+[A-Z_]|DELETE\s+FROM|ALTER\s+TABLE|"
            r"CREATE\s+(?:TABLE|INDEX)|DROP\s+(?:TABLE|INDEX)|TRUNCATE|CALL\s+[A-Z_]|DO\s+\$\$)",
            re.IGNORECASE,
        )
        self.assertIsNone(mutation.search(sql))

    def test_preflight_treats_known_fallback_duplicates_as_warning(self):
        root = Path(__file__).resolve().parents[2]
        sql = (root / "db" / "preflight" / "0002_catalog_sync_v1_preflight.sql").read_text(encoding="utf-8")
        duplicate_check = sql.split("'normalized_identity_unique'", 1)[1].split("UNION ALL", 1)[0]
        self.assertIn("ELSE 'warn'", duplicate_check)

    def test_migration_adds_stable_source_identity_index(self):
        root = Path(__file__).resolve().parents[2]
        sql = (root / "db" / "migrations" / "0002_catalog_sync_v1.sql").read_text(encoding="utf-8")
        self.assertIn("ADD COLUMN source_identity_key CHAR(64)", sql)
        self.assertIn("medicines_source_system_identity_unique", sql)

    def test_existing_lambda_paste_block_is_valid_and_read_only(self):
        root = Path(__file__).resolve().parents[2]
        block = (root / "backend" / "operations" / "existing_lambda_0002_preflight_paste_block.py.txt").read_text(encoding="utf-8")
        compile("def temporary_handler():\n" + block, "preflight_paste_block", "exec")
        self.assertIn('cur.execute("BEGIN TRANSACTION READ ONLY")', block)
        mutation = re.compile(
            r"cur\.execute\(\s*[rubfRUBF]*[\"']\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|CALL|DO)\b",
            re.IGNORECASE,
        )
        self.assertIsNone(mutation.search(block))

    def test_duplicate_inspection_paste_block_is_valid_and_read_only(self):
        root = Path(__file__).resolve().parents[2]
        block = (root / "backend" / "operations" / "existing_lambda_inspect_catalog_duplicates_paste_block.py.txt").read_text(encoding="utf-8")
        compile("def temporary_handler():\n" + block, "duplicate_inspection_paste_block", "exec")
        self.assertIn('cur.execute("BEGIN TRANSACTION READ ONLY")', block)
        mutation = re.compile(
            r"cur\.execute\(\s*[rubfRUBF]*[\"']\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|CALL|DO)\b",
            re.IGNORECASE,
        )
        self.assertIsNone(mutation.search(block))

    def test_0002_migration_paste_block_compiles_and_embeds_current_sql(self):
        root = Path(__file__).resolve().parents[2]
        block = (root / "backend" / "operations" / "existing_lambda_0002_migration_paste_block.py.txt").read_text(encoding="utf-8")
        compile("def temporary_handler():\n" + block, "migration_0002_paste_block", "exec")
        embedded = block.split('migration_sql = r"""', 1)[1].split('"""', 1)[0].strip()
        migration = (root / "db" / "migrations" / "0002_catalog_sync_v1.sql").read_text(encoding="utf-8")
        expected = migration[migration.index("BEGIN;"):].strip()
        self.assertEqual(embedded, expected)
        self.assertIn("BACKUP_AND_APPLY_CATALOG_SYNC_V1_20260806", block)
        self.assertIn("vatan_pre_sync_v1_20260806", block)


if __name__ == "__main__":
    unittest.main()
