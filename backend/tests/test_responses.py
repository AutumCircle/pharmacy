import json
import unittest

from backend.v1.shared.responses import success_document


class ResponseShapeTests(unittest.TestCase):
    def test_paginated_document_is_not_nested(self):
        response = success_document(
            {"data": [{"medicine_id": 1}], "page": {"next_cursor": None, "has_more": False}},
            request="req_test",
        )

        body = json.loads(response["body"])
        self.assertEqual(body["data"], [{"medicine_id": 1}])
        self.assertEqual(body["page"], {"next_cursor": None, "has_more": False})
        self.assertEqual(body["request_id"], "req_test")
        self.assertNotIsInstance(body["data"], dict)


if __name__ == "__main__":
    unittest.main()
