import json
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from backend.v1.internal_sync import lambda_function as internal_sync
from backend.v1.shared import pharmacy_mirror
from backend.v1.shared.authorization import require_pharmacy_agent_identity
from backend.v1.shared.contract import ContractError


TOKEN_1 = "p1-" + "a" * 40
TOKEN_2 = "p2-" + "b" * 40
BATCH_ID = "9f4cdb09-8a9f-4e90-9666-0686d4094642"


def batch_payload(**overrides):
    payload = {
        "batch_id": BATCH_ID,
        "pharmacy_id": 1,
        "table": "T_SKLAD_STATE",
        "generated_at": "2026-10-19T10:00:00+00:00",
        "upserts": [{"key": "10", "change_id": 8639132, "data": {"SKLAD_STATE_ID": 10, "PRODUCT_COUNT_SKLAD": "0.5"}}],
        "deletes": ["11"],
    }
    payload.update(overrides)
    return payload


class FakeCursor:
    def __init__(self, fetches):
        self.fetches = list(fetches)
        self.statements = []
        self.rowcount = 1

    def execute(self, statement, params=None):
        self.statements.append((statement, params))

    def fetchone(self):
        return self.fetches.pop(0) if self.fetches else None

    def fetchall(self):
        return []


def fake_transaction(cursor):
    @contextmanager
    def transaction():
        yield cursor
    return transaction


class PharmacyAgentAuthorizationTests(unittest.TestCase):
    def event(self, token):
        return {"headers": {"Authorization": f"Bearer {token}"}}

    def test_token_selects_its_pharmacy(self):
        with patch.dict("os.environ", {"PHARMACY_AGENT_TOKEN_1": TOKEN_1, "PHARMACY_AGENT_TOKEN_2": TOKEN_2}):
            self.assertEqual(require_pharmacy_agent_identity(self.event(TOKEN_1)), 1)
            self.assertEqual(require_pharmacy_agent_identity(self.event(TOKEN_2)), 2)

    def test_unknown_or_short_token_is_rejected(self):
        with patch.dict("os.environ", {"PHARMACY_AGENT_TOKEN_1": "short"}):
            with self.assertRaises(ContractError):
                require_pharmacy_agent_identity(self.event("short"))
        with patch.dict("os.environ", {"PHARMACY_AGENT_TOKEN_1": TOKEN_1}):
            with self.assertRaises(ContractError):
                require_pharmacy_agent_identity(self.event("x" * 43))


class PharmacyMirrorValidationTests(unittest.TestCase):
    def test_accepts_valid_batch(self):
        batch = pharmacy_mirror.validate_batch(batch_payload(), 1)
        self.assertEqual(batch.table, "T_SKLAD_STATE")
        self.assertEqual(batch.upserts[0].data["PRODUCT_COUNT_SKLAD"], "0.5")
        self.assertEqual(batch.deletes, ["11"])

    def test_rejects_other_pharmacy(self):
        with self.assertRaises(ContractError) as raised:
            pharmacy_mirror.validate_batch(batch_payload(pharmacy_id=2), 1)
        self.assertEqual(raised.exception.http_status, 403)

    def test_rejects_tables_outside_the_allowlist(self):
        for table in ("T_ROZNICA_OUTCOME", "T_EMPLOY", "t_product", "T_PRODUCT; DROP"):
            with self.assertRaises(ContractError):
                pharmacy_mirror.validate_batch(batch_payload(table=table), 1)

    def test_rejects_bad_rows(self):
        bad_rows = [
            {"key": "1", "data": {"lower": 1}},
            {"key": "1", "data": {"A": {"nested": True}}},
            {"key": "1", "data": {"A": "x" * 4001}},
            {"key": "", "data": {"A": 1}},
            {"key": "1", "change_id": -1, "data": {"A": 1}},
            {"key": "1", "data": {}},
            {"key": "1", "data": {"A": 1}, "extra": 1},
        ]
        for row in bad_rows:
            with self.assertRaises(ContractError, msg=row):
                pharmacy_mirror.validate_batch(batch_payload(upserts=[row], deletes=[]), 1)

    def test_rejects_duplicate_and_empty_batches(self):
        row = {"key": "1", "data": {"A": 1}}
        with self.assertRaises(ContractError):
            pharmacy_mirror.validate_batch(batch_payload(upserts=[row, row], deletes=[]), 1)
        with self.assertRaises(ContractError):
            pharmacy_mirror.validate_batch(batch_payload(upserts=[row], deletes=["1"]), 1)
        with self.assertRaises(ContractError):
            pharmacy_mirror.validate_batch(batch_payload(upserts=[], deletes=[]), 1)

    def test_table_allowlist_can_be_configured(self):
        with patch.dict("os.environ", {"PHARMACY_MIRROR_TABLES": "T_PRODUCT"}):
            with self.assertRaises(ContractError):
                pharmacy_mirror.validate_batch(batch_payload(), 1)


class PharmacyMirrorApplyTests(unittest.TestCase):
    def test_applies_upserts_and_deletes_in_one_transaction(self):
        cursor = FakeCursor([{"is_active": True}, {"batch_id": BATCH_ID}])
        batch = pharmacy_mirror.validate_batch(batch_payload(), 1)
        with patch.object(pharmacy_mirror, "transaction", fake_transaction(cursor)), \
                patch.object(pharmacy_mirror, "execute_values") as execute_values:
            result = pharmacy_mirror.apply_batch(batch)
        self.assertFalse(result["already_applied"])
        rows = execute_values.call_args.args[2]
        self.assertEqual(rows[0][:4], (1, "T_SKLAD_STATE", "10", 8639132))
        delete_sql, delete_params = next(s for s in cursor.statements if "DELETE FROM pharmacy_mirror_rows" in s[0])
        self.assertEqual(delete_params, (1, "T_SKLAD_STATE", ["11"]))

    def test_repeated_batch_is_not_applied_twice(self):
        cursor = FakeCursor([
            {"is_active": True}, None,
            {"pharmacy_id": 1, "table_name": "T_SKLAD_STATE", "upserted_count": 1, "deleted_count": 1},
        ])
        batch = pharmacy_mirror.validate_batch(batch_payload(), 1)
        with patch.object(pharmacy_mirror, "transaction", fake_transaction(cursor)), \
                patch.object(pharmacy_mirror, "execute_values") as execute_values:
            result = pharmacy_mirror.apply_batch(batch)
        self.assertTrue(result["already_applied"])
        execute_values.assert_not_called()

    def test_inactive_pharmacy_is_rejected(self):
        cursor = FakeCursor([{"is_active": False}])
        batch = pharmacy_mirror.validate_batch(batch_payload(), 1)
        with patch.object(pharmacy_mirror, "transaction", fake_transaction(cursor)):
            with self.assertRaises(ContractError) as raised:
                pharmacy_mirror.apply_batch(batch)
        self.assertEqual(raised.exception.code, "PHARMACY_INACTIVE")


class PharmacyMirrorRouteTests(unittest.TestCase):
    def event(self, path, token=TOKEN_1, method="POST", body=None):
        return {
            "httpMethod": method, "path": path,
            "headers": {"Authorization": f"Bearer {token}"},
            "body": json.dumps(body) if body is not None else None,
        }

    def test_mirror_route_does_not_accept_the_catalogue_sync_token(self):
        with patch.dict("os.environ", {"SYNC_API_BEARER_TOKEN": "s" * 40, "PHARMACY_AGENT_TOKEN_1": TOKEN_1}):
            response = internal_sync.lambda_handler(
                self.event("/v1/internal/pharmacy-mirror/batches", token="s" * 40, body=batch_payload()), None,
            )
        self.assertEqual(response["statusCode"], 403)

    def test_batch_route_applies_validated_batch(self):
        with patch.dict("os.environ", {"PHARMACY_AGENT_TOKEN_1": TOKEN_1}), \
                patch.object(internal_sync, "apply_batch", return_value={"batch_id": BATCH_ID}) as apply_batch:
            response = internal_sync.lambda_handler(
                self.event("/v1/internal/pharmacy-mirror/batches", body=batch_payload()), None,
            )
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(apply_batch.call_args.args[0].pharmacy_id, 1)

    def test_catalogue_routes_still_require_the_sync_token(self):
        with patch.dict("os.environ", {"PHARMACY_AGENT_TOKEN_1": TOKEN_1, "SYNC_API_BEARER_TOKEN": "s" * 40}):
            response = internal_sync.lambda_handler(
                self.event("/v1/internal/catalog-syncs", body={}), None,
            )
        self.assertEqual(response["statusCode"], 403)


if __name__ == "__main__":
    unittest.main()
