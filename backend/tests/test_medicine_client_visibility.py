import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

from backend.v1.admin_api import lambda_function as admin
from backend.v1.public_api import lambda_function as public
from backend.v1.shared.contract import ContractError

HIDDEN = "hidden_from_clients IS NOT TRUE"
ROW = {"id": 7, "name": "Нурофен", "price": Decimal("10.00"), "country": "DE", "vendor": "Reckitt",
       "in_stock": True, "updated_at": datetime(2026, 10, 22, tzinfo=timezone.utc), "image_url": None,
       "selling_unit_price": Decimal("12")}


def _patched(module, cursor):
    @contextmanager
    def fake_transaction():
        yield cursor
    return patch(f"{module.__name__}.transaction", fake_transaction)


def _sql(cursor):
    return "\n".join(call.args[0] for call in cursor.execute.call_args_list)


class PublicHidesMarkedMedicinesTests(unittest.TestCase):
    def test_every_client_list_and_page_filters_hidden_medicines(self):
        calls = [
            (lambda: public.search_medicines({"q": "нурофен"}), {"fetchall": []}),
            (lambda: public.list_featured_products(), {"fetchall": []}),
            (lambda: public.category_medicines("vitamins", {}),
             {"fetchone": [{"id": 4, "slug": "vitamins", "name": "В", "icon": None, "color": None}, {"count": 0}],
              "fetchall": []}),
        ]
        for call, results in calls:
            cursor = MagicMock()
            cursor.fetchall.return_value = results.get("fetchall", [])
            if "fetchone" in results:
                cursor.fetchone.side_effect = results["fetchone"]
            with _patched(public, cursor):
                call()
            sql = _sql(cursor)
            self.assertIn("in_stock IS TRUE AND m." + HIDDEN, sql)

    def test_carousels_filter_hidden_medicines(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[{"id": 1, "slug": "top", "title": "Топ", "sort_order": 0}], []]
        with _patched(public, cursor):
            public.list_product_carousels()
        self.assertIn("m." + HIDDEN, cursor.execute.call_args_list[1].args[0])

    def test_product_page_of_hidden_medicine_is_not_found(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        with _patched(public, cursor), self.assertRaises(ContractError) as raised:
            public.get_medicine("7")
        self.assertEqual(raised.exception.code, "MEDICINE_NOT_FOUND")
        self.assertIn("in_stock IS TRUE AND " + HIDDEN, cursor.execute.call_args.args[0])

    def test_cart_shows_hidden_medicine_as_unavailable(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [{**ROW, "in_stock": False}]
        with _patched(public, cursor):
            result = public.resolve_medicines({"medicine_ids": [7]})
        self.assertIn("(in_stock IS TRUE AND " + HIDDEN + ") AS in_stock", cursor.execute.call_args.args[0])
        self.assertFalse(result["medicines"][0]["in_stock"])

    def test_collection_leaves_hidden_medicines_out(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"slug": "s", "title": "T", "description": "", "product_ids": [7, 8]}
        cursor.fetchall.return_value = [ROW]
        with _patched(public, cursor):
            result = public.get_collection("s")
        self.assertIn("WHERE id = ANY(%s) AND " + HIDDEN, cursor.execute.call_args.args[0])
        self.assertEqual([item["medicine_id"] for item in result["medicines"]], [7])

    def test_checkout_reads_client_availability_including_the_mark(self):
        source = public.create_order.__code__.co_consts
        sql = "\n".join(value for value in source if isinstance(value, str))
        self.assertIn("(in_stock IS TRUE AND " + HIDDEN + ") AS in_stock", sql)


class AdminMarksMedicineTests(unittest.TestCase):
    def test_mark_and_unmark_update_column_and_audit(self):
        for hidden, action in ((True, "medicine.hidden_from_clients"), (False, "medicine.shown_to_clients")):
            cursor = MagicMock()
            cursor.fetchone.return_value = {"medicine_id": 7, "medicine_name": "Нурофен",
                                            "hidden_from_clients": hidden, "hidden_from_clients_at": None}
            with _patched(admin, cursor):
                result = admin.update_medicine_client_visibility(7, {"hidden_from_clients": hidden}, "admin", "req")
            self.assertEqual(result["hidden_from_clients"], hidden)
            sql, args = cursor.execute.call_args_list[0].args
            self.assertIn("SET hidden_from_clients = %s", sql)
            self.assertNotIn("in_stock", sql)
            self.assertEqual(args, (hidden, hidden, 7))
            self.assertIn(action, str(cursor.execute.call_args_list[1]))

    def test_invalid_payload_is_rejected_before_database(self):
        cursor = MagicMock()
        with _patched(admin, cursor):
            for payload in ({}, {"hidden_from_clients": "true"}, {"hidden_from_clients": 1},
                            {"hidden_from_clients": True, "in_stock": False}):
                with self.assertRaises(ContractError, msg=repr(payload)):
                    admin.update_medicine_client_visibility(7, payload, "admin", "req")
        cursor.execute.assert_not_called()

    def test_unknown_medicine_is_404(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        with _patched(admin, cursor), self.assertRaises(ContractError) as raised:
            admin.update_medicine_client_visibility(99, {"hidden_from_clients": True}, "admin", "req")
        self.assertEqual(raised.exception.http_status, 404)

    def test_catalog_list_returns_flag_and_filters_hidden(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = {"count": 1}
        cursor.fetchall.return_value = []
        with _patched(admin, cursor):
            admin.list_medicines({"availability": "hidden"})
        sql = _sql(cursor)
        self.assertIn("m.hidden_from_clients IS TRUE", sql)
        self.assertIn("image_url, hidden_from_clients", sql)
        self.assertNotIn("sync_logs", sql)
        with self.assertRaises(ContractError):
            admin.list_medicines({"availability": "secret"})

    def test_route_is_admin_only_patch(self):
        event = {"httpMethod": "PATCH", "path": "/v1/admin/medicines/7/visibility",
                 "body": '{"hidden_from_clients": true}', "headers": {}}
        with patch.object(admin, "update_medicine_client_visibility", return_value={"medicine_id": 7}) as update:
            response = admin.lambda_handler(event, None)
            self.assertEqual(response["statusCode"], 403)
            update.assert_not_called()
            with patch.object(admin, "require_admin_identity", return_value="admin:test"):
                response = admin.lambda_handler(event, None)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(update.call_args.args[:3], (7, {"hidden_from_clients": True}, "admin:test"))


class MigrationTests(unittest.TestCase):
    def test_migration_is_additive_and_repeatable(self):
        from pathlib import Path
        sql = (Path(__file__).resolve().parents[2] / "db" / "migrations" / "0027_medicine_hidden_from_clients.sql").read_text(encoding="utf-8")
        self.assertIn("ADD COLUMN IF NOT EXISTS hidden_from_clients BOOLEAN NOT NULL DEFAULT FALSE", sql)
        self.assertIn("CREATE INDEX IF NOT EXISTS", sql)
        body = sql[sql.index("BEGIN;"):]
        for forbidden in ("DROP", "DELETE", "UPDATE", "TRUNCATE"):
            self.assertNotIn(forbidden, body)
