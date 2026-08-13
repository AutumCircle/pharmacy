import unittest

from backend.v1.shared.authorization import require_admin_identity, require_sync_identity
from backend.v1.shared.contract import ContractError


class AdminAuthorizationTests(unittest.TestCase):
    def test_rejects_missing_authorizer(self):
        with self.assertRaises(ContractError) as raised:
            require_admin_identity({"headers": {"x-api-key": "not-an-admin-role"}})
        self.assertEqual(raised.exception.code, "FORBIDDEN")
        self.assertEqual(raised.exception.http_status, 403)

    def test_accepts_direct_admin_context(self):
        identity = require_admin_identity({
            "requestContext": {"authorizer": {"role": "admin", "principalId": "operator-1"}}
        })
        self.assertEqual(identity, "operator-1")

    def test_accepts_claims_admin_context(self):
        identity = require_admin_identity({
            "requestContext": {"authorizer": {"claims": {"role": "admin", "sub": "operator-2"}}}
        })
        self.assertEqual(identity, "operator-2")

    def test_admin_api_key_does_not_grant_sync_identity(self):
        with self.assertRaises(ContractError):
            require_sync_identity({"requestContext": {"authorizer": {"role": "admin", "principalId": "admin"}}})

    def test_accepts_sync_machine_identity(self):
        identity = require_sync_identity({
            "requestContext": {"authorizer": {"role": "agent_sync", "principalId": "pharmacy-pc-1"}}
        })
        self.assertEqual(identity, "pharmacy-pc-1")


if __name__ == "__main__":
    unittest.main()
