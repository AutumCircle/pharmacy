import base64
import csv
import io
import unittest
import zipfile
from contextlib import contextmanager
from unittest.mock import patch

from backend.v1.admin_api.lambda_function import export_available_medicines
from backend.v1.shared.contract import ContractError
from backend.v1.shared.xlsx_export import (
    build_available_medicines_csv,
    build_available_medicines_workbook,
)


ROWS = [
    {"medicine_id": 14, "medicine_name": "Парацетамол", "selling_unit_price": "12"},
    {"medicine_id": 15, "medicine_name": "=unsafe spreadsheet input", "selling_unit_price": "13.5"},
]
ORIGIN = "https://apteka.example"


class AvailableMedicinesExportTests(unittest.TestCase):
    def test_csv_contains_selling_prices_direct_links_and_utf8_bom(self):
        output = build_available_medicines_csv(ROWS, ORIGIN)
        self.assertTrue(output.startswith(b"\xef\xbb\xbf"))
        values = list(csv.reader(io.StringIO(output.decode("utf-8-sig"))))
        self.assertEqual(values[0], ["Название", "Цена с наценкой (с.)", "Ссылка"])
        self.assertEqual(values[1], ["Парацетамол", "12.00", "https://apteka.example/medicine/14"])
        self.assertEqual(values[2][0], "'=unsafe spreadsheet input")

    def test_xlsx_is_a_valid_zip_with_selling_price_and_id_link(self):
        output = build_available_medicines_workbook(ROWS, ORIGIN)
        with zipfile.ZipFile(io.BytesIO(output)) as archive:
            names = archive.namelist()
            sheet = archive.read("xl/worksheets/sheet1.xml").decode("utf-8")
        self.assertIn("xl/workbook.xml", names)
        self.assertIn("Цена с наценкой", sheet)
        self.assertIn("https://apteka.example/medicine/14", sheet)
        self.assertNotIn("base_unit_price", sheet)

    def test_export_only_selects_in_stock_and_uses_database_selling_price(self):
        class Cursor:
            def __init__(self):
                self.calls = []

            def execute(self, statement, params=None):
                self.calls.append((statement, params))

            def fetchone(self):
                return {"count": 2}

            def fetchall(self):
                return ROWS

        cursor = Cursor()

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction):
            result = export_available_medicines(
                {"headers": {"X-Public-Site-Url": ORIGIN}}, {"format": "csv"},
            )
        self.assertEqual(result["row_count"], 2)
        self.assertEqual(result["content_type"], "text/csv; charset=utf-8")
        self.assertIn("WHERE in_stock IS TRUE", cursor.calls[1][0])
        self.assertIn("vatan_selling_unit_price(price)", cursor.calls[1][0])
        data = base64.b64decode(result["content_base64"]).decode("utf-8-sig")
        self.assertIn("https://apteka.example/medicine/14", data)

    def test_export_rejects_untrusted_origin_or_format(self):
        for origin in ("", "http://pharmacy.example", "https://example.com/path", "https://user:pass@example.com"):
            with self.subTest(origin=origin), self.assertRaises(ContractError):
                export_available_medicines({"headers": {"x-public-site-url": origin}}, {"format": "xlsx"})
        with self.assertRaises(ContractError):
            export_available_medicines({"headers": {"x-public-site-url": ORIGIN}}, {"format": "pdf"})


if __name__ == "__main__":
    unittest.main()
