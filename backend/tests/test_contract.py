import unittest

from backend.v1.shared.contract import (
    ContractError,
    calculate_selling_unit_price,
    normalize_phone,
    validate_create_order_request,
    validate_idempotency_key,
    validate_status_transition,
)


class PricingTests(unittest.TestCase):
    def test_contract_examples(self):
        self.assertEqual(calculate_selling_unit_price("100.00"), 105)
        self.assertEqual(calculate_selling_unit_price("100.01"), 106)
        self.assertEqual(calculate_selling_unit_price("12.10"), 13)

    def test_rejects_non_positive_price(self):
        with self.assertRaisesRegex(ContractError, "Catalog price is invalid"):
            calculate_selling_unit_price(0)


class PhoneTests(unittest.TestCase):
    def test_normalizes_local_phone(self):
        self.assertEqual(normalize_phone("917-123-456"), "+992917123456")

    def test_accepts_e164_phone(self):
        self.assertEqual(normalize_phone("+992917123456"), "+992917123456")

    def test_rejects_short_phone(self):
        with self.assertRaises(ContractError):
            normalize_phone("1234")

    def test_accepts_pasted_canonical_phone_with_separators(self):
        self.assertEqual(normalize_phone("+992 (917) 12-34-56"), "+992917123456")

    def test_accepts_formatted_local_phone(self):
        self.assertEqual(normalize_phone("917-12-34-56"), "+992917123456")

    def test_rejects_excessive_phone(self):
        with self.assertRaises(ContractError):
            normalize_phone("9171234567")

    def test_rejects_malformed_phone(self):
        with self.assertRaises(ContractError):
            normalize_phone("917-12-AB-56")


class CreateOrderValidationTests(unittest.TestCase):
    def valid_payload(self):
        return {
            "customer_name": "Фируз",
            "phone": "917123456",
            "address": "Душанбе, ул. Айни 24",
            "comment": "Позвоните перед доставкой",
            "items": [{"medicine_id": 1042, "quantity": 2}],
        }

    def test_accepts_contract_payload(self):
        normalized = validate_create_order_request(self.valid_payload())
        self.assertEqual(normalized["phone"], "+992917123456")
        self.assertEqual(normalized["items"], [{"medicine_id": 1042, "quantity": 2}])

    def test_rejects_client_total(self):
        payload = self.valid_payload()
        payload["total"] = 1
        with self.assertRaises(ContractError) as context:
            validate_create_order_request(payload)
        self.assertIn("total", context.exception.fields)

    def test_rejects_client_item_price(self):
        payload = self.valid_payload()
        payload["items"][0]["price"] = 1
        with self.assertRaises(ContractError) as context:
            validate_create_order_request(payload)
        self.assertIn("items[0].price", context.exception.fields)

    def test_rejects_duplicate_medicine(self):
        payload = self.valid_payload()
        payload["items"].append({"medicine_id": 1042, "quantity": 1})
        with self.assertRaises(ContractError) as context:
            validate_create_order_request(payload)
        self.assertEqual(context.exception.code, "DUPLICATE_ORDER_ITEM")

    def test_rejects_boolean_quantity(self):
        payload = self.valid_payload()
        payload["items"][0]["quantity"] = True
        with self.assertRaises(ContractError):
            validate_create_order_request(payload)


class IdempotencyTests(unittest.TestCase):
    def test_accepts_uuid(self):
        value = "2d61a4e9-1ec4-4b89-a09a-4a75b4df2a32"
        self.assertEqual(validate_idempotency_key(value), value)

    def test_rejects_non_uuid(self):
        with self.assertRaises(ContractError):
            validate_idempotency_key("order-123")


class StatusTransitionTests(unittest.TestCase):
    def test_allows_normal_transition(self):
        self.assertEqual(
            validate_status_transition("pending", "confirmed"),
            ("pending", "confirmed", None),
        )

    def test_requires_cancellation_reason(self):
        with self.assertRaises(ContractError):
            validate_status_transition("pending", "cancelled")

    def test_rejects_transition_from_final_status(self):
        with self.assertRaises(ContractError) as context:
            validate_status_transition("delivered", "pending")
        self.assertEqual(context.exception.code, "INVALID_STATUS_TRANSITION")


if __name__ == "__main__":
    unittest.main()
