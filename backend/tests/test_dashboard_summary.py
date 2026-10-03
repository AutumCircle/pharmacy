import unittest
from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import Mock, patch

from backend.v1.admin_api.lambda_function import dashboard_summary


class DashboardSummaryTests(unittest.TestCase):
    def test_groups_orders_by_origin_and_channel_in_selected_period(self):
        cursor = Mock()
        cursor.fetchone.side_effect = [
            {"pending": 3, "confirmed": 2, "delivering": 1, "delivered": 4, "cancelled": 1},
            {
                "total_orders": 10, "client_orders": 4, "pharmacy_orders": 6, "courier_orders": 0,
                "pharmacy_1_orders": 2, "pharmacy_2_orders": 4,
                "instagram_orders": 2, "whatsapp_orders": 2, "phone_orders": 1,
                "unspecified_source_orders": 1,
            },
            {"sales_total": Decimal("250.00"), "pharmacy_total": Decimal("200.00"),
             "online_profit_total": Decimal("35.00"),
             "delivery_owner_total": Decimal("15.00"), "delivery_courier_total": Decimal("25.00")},
        ]
        cursor.fetchall.side_effect = [
            [{
                "public_id": "ord_delivered", "order_reference": "1001", "customer_name": "Клиент",
                "created_at": "2026-09-29T10:00:00Z", "sales_total": Decimal("120.00"),
                "pharmacy_total": Decimal("100.00"),
            }],
            [{
                "id": 9, "public_id": "ord_recent", "order_reference": "1002",
                "customer_name": "Клиент 2", "created_at": "2026-09-29T11:00:00Z",
                "order_total": Decimal("130.00"), "status": "pending",
                "created_by_staff_account_id": 2, "order_source": "whatsapp",
            }],
        ]

        @contextmanager
        def fake_transaction():
            yield cursor

        with patch("backend.v1.admin_api.lambda_function.transaction", fake_transaction):
            result = dashboard_summary({"days": "30"})

        self.assertEqual(result["origin_counts"]["client_orders"], 4)
        self.assertEqual(result["origin_counts"]["pharmacy_2_orders"], 4)
        self.assertEqual(result["origin_counts"]["whatsapp_orders"], 2)
        self.assertEqual(result["recent_orders"][0]["order_id"], "ord_recent")
        self.assertNotIn("id", result["recent_orders"][0])
        self.assertEqual(result["profit_total"], Decimal("50.00"))
        self.assertEqual(result["online_profit_total"], Decimal("35.00"))
        financial_sql = cursor.execute.call_args_list[-1].args[0]
        self.assertIn("created_by_staff_account_id IS NULL", financial_sql)
        self.assertTrue(all(call.args[1] == (30,) for call in cursor.execute.call_args_list[1:]))


if __name__ == "__main__":
    unittest.main()
