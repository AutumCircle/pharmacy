import unittest
from datetime import datetime, timezone

from backend.v1.shared.order_time import order_time_dushanbe, order_time_iso
from backend.v1.shared.order_notification_messages import format_configured_message
from backend.v1.shared.order_notification_settings import default_policies


class OrderTimeTests(unittest.TestCase):
    def test_legacy_naive_utc_is_explicit(self):
        self.assertEqual(order_time_iso(datetime(2026, 10, 11, 19, 30)),
                         "2026-10-11T19:30:00+00:00")

    def test_offset_timestamp_preserves_instant(self):
        self.assertEqual(order_time_iso("2026-10-12T00:30:00+05:00"),
                         "2026-10-11T19:30:00+00:00")

    def test_midnight_boundary_in_dushanbe(self):
        self.assertEqual(order_time_dushanbe("2026-10-11T19:30:00Z"),
                         "12.10.2026 00:30")
        self.assertEqual(order_time_dushanbe(datetime(2026, 10, 11, 19, 30,
                                                      tzinfo=timezone.utc)), "12.10.2026 00:30")

    def test_notification_date_matches_dushanbe(self):
        fields = default_policies()["owner_telegram"]
        message = format_configured_message({"order_reference": "VAT-1",
            "created_at": "2026-10-11T19:30:00Z"}, fields, "owner_telegram")
        self.assertIn("12.10.2026 00:30", message)


if __name__ == "__main__":
    unittest.main()
