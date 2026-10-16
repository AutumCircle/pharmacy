//
//  AptekaVTests.swift
//  AptekaVTests
//
//  Created by Developer on 12/10/26.
//

import XCTest
@testable import AptekaV

final class AptekaVTests: XCTestCase {

    // MARK: Order request (API_CONTRACT §6)

    func testOrderRequestContainsOnlyAllowedKeysAndNoPrices() throws {
        let request = CreateOrderRequest(
            customerName: "Фируз",
            phone: "917123456",
            address: "Душанбе, ул. Айни 24",
            comment: nil,
            items: [CreateOrderRequest.Item(medicineId: 1042, quantity: 2)]
        )
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        XCTAssertEqual(Set(json.keys), ["customer_name", "phone", "address", "items"])
        let items = try XCTUnwrap(json["items"] as? [[String: Any]])
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(Set(items[0].keys), ["medicine_id", "quantity"])
        XCTAssertEqual(items[0]["medicine_id"] as? Int, 1042)
        XCTAssertEqual(items[0]["quantity"] as? Int, 2)
    }

    func testOrderRequestIncludesCommentWhenPresent() throws {
        let request = CreateOrderRequest(
            customerName: "Фируз", phone: "917123456", address: "Душанбе, ул. Айни 24",
            comment: "Позвоните перед доставкой", items: [CreateOrderRequest.Item(medicineId: 1, quantity: 1)]
        )
        let json = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        )
        XCTAssertEqual(json["comment"] as? String, "Позвоните перед доставкой")
    }

    func testDecodesServerOrder() throws {
        let data = Data("""
        {"data":{"order_id":"ord_1","order_reference":"3456-105","status":"pending",
        "payment_method":"cash_on_delivery","payment_status":"unpaid","currency":"TJS",
        "items":[{"medicine_id":1042,"medicine_name":"Аспирин","quantity":2,"selling_unit_price":25,"line_total":50}],
        "items_subtotal":50,"order_total":50,"created_at":"2026-08-06T10:15:30Z"},"request_id":"req_1"}
        """.utf8)
        let order = try JSONDecoder().decode(DataEnvelope<PublicOrder>.self, from: data).data
        XCTAssertEqual(order.orderReference, "3456-105")
        XCTAssertEqual(order.orderTotal, 50)
        XCTAssertEqual(order.statusTitle, "В обработке")
        XCTAssertEqual(order.items.first?.lineTotal, 50)
    }

    /// The backend sends non-integer decimals as strings (fractional quantities set by staff).
    func testDecodesTrackedOrderWithStringDecimals() throws {
        let data = Data("""
        {"data":[{"order_id":"ord_2","order_reference":"3456-106","status":"delivering",
        "items":[{"medicine_id":7,"medicine_name":"Но-шпа","quantity":"1.5","selling_unit_price":"32.50","line_total":"48.75"}],
        "items_subtotal":49,"order_total":49,"created_at":"2026-10-16T09:15:09.484902+00:00"}],"request_id":"r"}
        """.utf8)
        let orders = try JSONDecoder().decode(DataEnvelope<[PublicOrder]>.self, from: data).data
        let item = try XCTUnwrap(orders.first?.items.first)
        XCTAssertEqual(item.quantity, 1.5)
        XCTAssertEqual(item.lineTotal, Decimal(string: "48.75"))
        XCTAssertEqual(orders.first?.statusTitle, "В пути")
        XCTAssertNotNil(orders.first?.createdDate)
    }

    // MARK: Phone

    func testTajikPhoneFormatting() {
        XCTAssertEqual(TajikPhone.sanitize("+992 93-123-45-67 9"), "992931234")
        XCTAssertEqual(TajikPhone.sanitize("93 123 45 67"), "931234567")
        XCTAssertTrue(TajikPhone.isValid("931234567"))
        XCTAssertFalse(TajikPhone.isValid("93123456"))
        XCTAssertEqual(TajikPhone.format("931234567"), "93 123 45 67")
        XCTAssertEqual(TajikPhone.display("+992931234567"), "+992 93 123 45 67")
    }

    // MARK: Checkout validation

    @MainActor
    func testCheckoutValidation() {
        let model = CheckoutViewModel()
        model.name = "А"
        model.address = "ул"
        model.comment = String(repeating: "x", count: 501)
        XCTAssertFalse(model.validate())
        XCTAssertNotNil(model.fieldErrors[.name])
        XCTAssertNotNil(model.fieldErrors[.address])
        XCTAssertNotNil(model.fieldErrors[.comment])

        model.name = "Фируз"
        model.address = "Душанбе, ул. Айни 24"
        model.comment = ""
        XCTAssertTrue(model.validate())
        XCTAssertTrue(model.fieldErrors.isEmpty)
    }
}
