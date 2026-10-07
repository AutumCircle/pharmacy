import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from backend.v1.public_api import lambda_function as public_api
from backend.v1.shared import collection_admin
from backend.v1.shared.contract import ContractError, validate_create_order_request
from backend.v1.shared.marketing import (
    is_bot_user_agent,
    normalize_attribution,
    parse_product_ids,
    validate_collection_event,
    validate_utm_link_event,
)

VISITOR = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300.0"


def event(**overrides):
    payload = {"collection_slug": "oct-6", "event_type": "view", "visitor_id": VISITOR, "user_agent": IPHONE}
    payload.update(overrides)
    return payload


@contextmanager
def fake_transaction(cursor):
    yield cursor


class BotFilterTests(unittest.TestCase):
    def test_preview_crawlers_are_bots(self):
        for agent in (
            "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
            "meta-externalagent/1.1",
            "Facebot",
            "Googlebot/2.1", "SomeCrawler/1.0", "Spider", "LinkPreview/1",
        ):
            self.assertTrue(is_bot_user_agent(agent), agent)

    def test_real_browsers_and_instagram_in_app_are_not_bots(self):
        self.assertFalse(is_bot_user_agent(IPHONE))
        self.assertFalse(is_bot_user_agent("Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36"))

    def test_missing_user_agent_is_ignored(self):
        self.assertTrue(is_bot_user_agent(""))
        self.assertTrue(is_bot_user_agent(None))


class EventValidationTests(unittest.TestCase):
    def test_view_has_no_product(self):
        self.assertEqual(validate_collection_event(event())["event_type"], "view")
        with self.assertRaises(ContractError):
            validate_collection_event(event(product_id=5))

    def test_product_events_require_product(self):
        with self.assertRaises(ContractError):
            validate_collection_event(event(event_type="add_to_cart"))
        self.assertEqual(validate_collection_event(event(event_type="product_open", product_id=7))["product_id"], 7)

    def test_rejects_bad_fields(self):
        for bad in (event(event_type="click"), event(visitor_id="short"), event(collection_slug="Bad Slug"), event(extra=1)):
            with self.assertRaises(ContractError):
                validate_collection_event(bad)

    def test_utm_values_are_trimmed_and_truncated(self):
        result = validate_collection_event(event(utm_source=" instagram ", utm_medium="x" * 300, utm_campaign=""))
        self.assertEqual(result["utm_source"], "instagram")
        self.assertEqual(len(result["utm_medium"]), 100)
        self.assertIsNone(result["utm_campaign"])

    def test_direct_utm_landing_requires_valid_utm_and_visitor(self):
        result = validate_utm_link_event({
            "path": "/medicine/4200865", "product_id": 4200865, "visitor_id": VISITOR,
            "utm_source": "instagram", "utm_medium": "story", "utm_campaign": "story-oct-7",
            "utm_content": "product_4200865", "user_agent": IPHONE,
        })
        self.assertEqual(result["product_id"], 4200865)
        for bad in (
            {"path": "/medicine/1", "visitor_id": VISITOR},
            {"path": "https://evil.example", "visitor_id": VISITOR, "utm_source": "x"},
        ):
            with self.assertRaises(ContractError):
                validate_utm_link_event(bad)


class RecordEventTests(unittest.TestCase):
    def test_bot_event_is_not_stored(self):
        with patch.object(public_api, "transaction") as tx:
            result = public_api.record_collection_event(event(user_agent="facebookexternalhit/1.1"))
        self.assertEqual(result, {"recorded": False, "reason": "bot"})
        tx.assert_not_called()

    def test_browser_event_is_stored_for_active_collection(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"id": 1}
        with patch.object(public_api, "transaction", lambda: fake_transaction(cursor)):
            result = public_api.record_collection_event(event(event_type="product_open", product_id=4048, utm_medium="dm"))
        self.assertEqual(result, {"recorded": True})
        sql, params = cursor.execute.call_args[0]
        self.assertIn("is_active IS TRUE", sql)
        self.assertEqual(params[0:3], ("product_open", 4048, VISITOR))

    def test_unknown_collection_is_not_recorded(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        with patch.object(public_api, "transaction", lambda: fake_transaction(cursor)):
                self.assertEqual(public_api.record_collection_event(event()), {"recorded": False})

    def test_direct_utm_landing_is_recorded_and_bots_are_dropped(self):
        payload = {
            "path": "/medicine/4200865", "product_id": 4200865, "visitor_id": VISITOR,
            "utm_source": "instagram", "utm_medium": "story", "utm_campaign": "story-oct-7",
            "utm_content": "product_4200865", "user_agent": IPHONE,
        }
        cursor = MagicMock()
        cursor.fetchone.return_value = {"id": 1}
        with patch.object(public_api, "transaction", lambda: fake_transaction(cursor)):
            self.assertEqual(public_api.record_utm_link_event(payload), {"recorded": True})
        self.assertIn("INSERT INTO utm_link_events", cursor.execute.call_args[0][0])
        with patch.object(public_api, "transaction") as tx:
            self.assertEqual(
                public_api.record_utm_link_event({**payload, "user_agent": "facebookexternalhit/1.1"}),
                {"recorded": False, "reason": "bot"},
            )
        tx.assert_not_called()


class AttributionTests(unittest.TestCase):
    def test_none_and_empty_values_are_dropped(self):
        self.assertIsNone(normalize_attribution(None))
        self.assertIsNone(normalize_attribution({"utm_source": " "}))

    def test_keeps_collection_and_utm(self):
        result = normalize_attribution({"source_collection": "oct-6", "utm_source": "instagram", "utm_medium": "dm"})
        self.assertEqual(result["source_collection"], "oct-6")
        self.assertEqual(result["utm_medium"], "dm")
        self.assertIsNone(result["utm_campaign"])

    def test_invalid_collection_slug_is_discarded(self):
        self.assertEqual(normalize_attribution({"source_collection": "Bad Slug!", "utm_source": "x"})["source_collection"], None)

    def test_unknown_keys_rejected(self):
        with self.assertRaises(ContractError):
            normalize_attribution({"price": 1})

    def test_order_request_carries_attribution(self):
        payload = {
            "customer_name": "Тест", "phone": "917123456", "address": "Душанбе, ул. Айни 24",
            "items": [{"medicine_id": 1, "quantity": 1}],
            "attribution": {"source_collection": "oct-6", "utm_source": "instagram", "utm_medium": "dm"},
        }
        self.assertEqual(validate_create_order_request(payload)["attribution"]["source_collection"], "oct-6")
        payload.pop("attribution")
        self.assertIsNone(validate_create_order_request(payload)["attribution"])


class PublicCollectionTests(unittest.TestCase):
    def row(self, medicine_id, in_stock=True):
        return {
            "id": medicine_id, "name": f"Item {medicine_id}", "price": 10, "country": None, "vendor": None,
            "in_stock": in_stock, "updated_at": datetime(2026, 10, 6, tzinfo=timezone.utc),
            "image_url": None, "selling_unit_price": 11,
        }

    def test_keeps_configured_order_and_out_of_stock_items(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"slug": "oct-6", "title": "T", "description": None, "product_ids": [3, 1, 2]}
        cursor.fetchall.return_value = [self.row(1), self.row(2, False), self.row(3)]
        with patch.object(public_api, "transaction", lambda: fake_transaction(cursor)):
            result = public_api.get_collection("oct-6")
        self.assertEqual([item["medicine_id"] for item in result["medicines"]], [3, 1, 2])
        self.assertFalse(result["medicines"][2]["in_stock"])
        self.assertEqual(result["description"], "")

    def test_missing_or_inactive_collection_is_404(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        with patch.object(public_api, "transaction", lambda: fake_transaction(cursor)):
            with self.assertRaises(ContractError) as context:
                public_api.get_collection("nope")
        self.assertEqual(context.exception.http_status, 404)


class AdminCollectionTests(unittest.TestCase):
    def test_product_ids_must_be_unique_positive_integers(self):
        self.assertEqual(parse_product_ids([3, 1, 2]), [3, 1, 2])
        for bad in ([1, 1], [0], [True], ["1"], "1,2"):
            with self.assertRaises(ContractError):
                parse_product_ids(bad)

    def test_save_rejects_unknown_products_and_names_them(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        cursor.fetchall.return_value = [{"id": 10059, "name": "CeraVe", "in_stock": True}]
        with patch.object(collection_admin, "transaction", lambda: fake_transaction(cursor)):
            with self.assertRaises(ContractError) as context:
                collection_admin.create_collection(
                    {"slug": "oct-7", "title": "Подборка", "product_ids": [10059, 99999999]},
                    "admin", "req_1", MagicMock(),
                )
        self.assertEqual(context.exception.http_status, 422)
        self.assertIn("99999999", context.exception.message)
        self.assertNotIn("10059", context.exception.message)

    def test_duplicate_slug_is_conflict(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"id": 1}
        with patch.object(collection_admin, "transaction", lambda: fake_transaction(cursor)):
            with self.assertRaises(ContractError) as context:
                collection_admin.create_collection({"slug": "oct-6", "title": "Подборка", "product_ids": []}, "a", "r", MagicMock())
        self.assertEqual(context.exception.http_status, 409)

    def test_resolve_products_reports_missing(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{"id": 4048, "name": "NOW C", "in_stock": True}]
        with patch.object(collection_admin, "transaction", lambda: fake_transaction(cursor)):
            result = collection_admin.resolve_products({"product_ids": [4048, 1]})
        self.assertEqual(result["missing_ids"], [1])
        self.assertEqual(result["products"][0]["name"], "NOW C")

    def test_stats_rejects_reversed_range_and_bad_dates(self):
        for query in ({"from": "2026-10-07", "to": "2026-10-06"}, {"from": "06.10.2026"}):
            with self.assertRaises(ContractError):
                collection_admin.collection_stats(query)

    def test_reset_stats_requires_exact_confirmation(self):
        with patch.object(collection_admin, "transaction") as tx:
            for payload in ({}, {"confirmation": "сбросить"}, {"confirmation": "СБРОСИТЬ", "extra": True}):
                with self.assertRaises(ContractError):
                    collection_admin.reset_collection_stats(payload, "admin", "req_1", MagicMock())
        tx.assert_not_called()

    def test_reset_stats_clears_only_events_and_order_attribution(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {
            "events_deleted": 12, "utm_events_deleted": 8, "orders_attribution_cleared": 3,
        }
        audit = MagicMock()
        with patch.object(collection_admin, "transaction", lambda: fake_transaction(cursor)):
            result = collection_admin.reset_collection_stats(
                {"confirmation": "СБРОСИТЬ"}, "admin", "req_2", audit,
            )
        self.assertEqual(result, {
            "events_deleted": 12, "utm_events_deleted": 8, "orders_attribution_cleared": 3,
        })
        sql = cursor.execute.call_args[0][0]
        self.assertIn("DELETE FROM collection_events", sql)
        self.assertIn("DELETE FROM utm_link_events", sql)
        self.assertIn("UPDATE orders", sql)
        self.assertIn("source_collection = NULL", sql)
        self.assertNotIn("DELETE FROM orders", sql)
        audit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
