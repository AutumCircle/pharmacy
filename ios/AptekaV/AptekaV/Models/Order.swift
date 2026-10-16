import Foundation

/// `POST /api/checkout` body. Only these keys are allowed (API_CONTRACT §6): no prices,
/// totals, statuses or names — the server recalculates everything from `medicine_id`.
struct CreateOrderRequest: Encodable, Equatable {
    struct Item: Encodable, Equatable {
        let medicineId: Int
        let quantity: Int

        enum CodingKeys: String, CodingKey {
            case medicineId = "medicine_id"
            case quantity
        }
    }

    let customerName: String
    /// 9 local digits, as the website sends it.
    let phone: String
    let address: String
    let comment: String?
    let items: [Item]

    enum CodingKeys: String, CodingKey {
        case customerName = "customer_name"
        case phone, address, comment, items
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(customerName, forKey: .customerName)
        try container.encode(phone, forKey: .phone)
        try container.encode(address, forKey: .address)
        try container.encodeIfPresent(comment, forKey: .comment)
        try container.encode(items, forKey: .items)
    }
}

/// Server-calculated order returned with `201` (and by order tracking).
struct PublicOrder: Decodable, Identifiable, Equatable {
    struct Item: Decodable, Equatable, Identifiable {
        let medicineId: Int
        let medicineName: String
        let quantity: Double
        let sellingUnitPrice: Decimal
        let lineTotal: Decimal

        var id: Int { medicineId }

        enum CodingKeys: String, CodingKey {
            case medicineId = "medicine_id"
            case medicineName = "medicine_name"
            case quantity
            case sellingUnitPrice = "selling_unit_price"
            case lineTotal = "line_total"
        }
    }

    let orderId: String
    let orderReference: String
    let status: String
    let items: [Item]
    let itemsSubtotal: Decimal
    let orderTotal: Decimal
    let createdAt: String

    var id: String { orderId }

    enum CodingKeys: String, CodingKey {
        case orderId = "order_id"
        case orderReference = "order_reference"
        case status, items
        case itemsSubtotal = "items_subtotal"
        case orderTotal = "order_total"
        case createdAt = "created_at"
    }

    /// Customer status labels from UI_DESIGN_SPEC §7.4.
    var statusTitle: String {
        switch status {
        case "pending": return "В обработке"
        case "confirmed": return "Подтверждён"
        case "delivering": return "В пути"
        case "delivered": return "Доставлен"
        case "cancelled": return "Отменён"
        default: return status
        }
    }
}

/// Business errors of `POST /api/checkout`, with the website's Russian messages.
enum OrderError: Error, Equatable {
    case itemsUnavailable(medicineIds: [Int])
    case medicineNotFound(medicineIds: [Int])
    case minimumNotReached
    case idempotencyConflict
    case validation(message: String?)
    case rateLimited
    case offline
    case server

    var message: String {
        switch self {
        case .itemsUnavailable:
            return "Некоторые лекарства больше не доступны. Обновите корзину."
        case .medicineNotFound:
            return "Некоторые лекарства больше не найдены в каталоге."
        case .minimumNotReached:
            return "После проверки актуальных цен сумма заказа меньше 50 сомони."
        case .idempotencyConflict:
            return "Данные заказа изменились. Повторите оформление ещё раз."
        case .validation(let message):
            return message ?? "Проверьте данные заказа."
        case .rateLimited:
            return "Слишком много запросов. Попробуйте позже."
        case .offline:
            return "Нет соединения. Проверьте интернет и повторите."
        case .server:
            return "Не удалось оформить заказ. Повторите попытку."
        }
    }

    /// Items the server rejected (shown in the order summary).
    var rejectedMedicineIds: [Int] {
        switch self {
        case .itemsUnavailable(let ids), .medicineNotFound(let ids): return ids
        default: return []
        }
    }

    /// Safe to resend with the same Idempotency-Key (the server may not have seen the request).
    var isRetryableWithSameKey: Bool {
        self == .offline || self == .server || self == .rateLimited
    }
}

/// Places orders. Debug builds use `SimulatedOrderService` unless real sending is switched on
/// in the «Дизайн» panel, so testing never creates orders for the pharmacy staff.
protocol OrderService {
    func placeOrder(_ request: CreateOrderRequest, idempotencyKey: UUID, cartSnapshot: [CartStore.Item]) async throws -> PublicOrder
}

struct LiveOrderService: OrderService {
    func placeOrder(_ request: CreateOrderRequest, idempotencyKey: UUID, cartSnapshot: [CartStore.Item]) async throws -> PublicOrder {
        try await APIClient.shared.createOrder(request, idempotencyKey: idempotencyKey)
    }
}

#if DEBUG
/// Builds a fake «TEST-…» order from the cart; nothing is sent to the server.
struct SimulatedOrderService: OrderService {
    func placeOrder(_ request: CreateOrderRequest, idempotencyKey: UUID, cartSnapshot: [CartStore.Item]) async throws -> PublicOrder {
        try await Task.sleep(nanoseconds: 1_200_000_000)
        let items = cartSnapshot.map { item in
            PublicOrder.Item(
                medicineId: item.medicine.medicineId,
                medicineName: item.medicine.medicineName,
                quantity: Double(item.quantity),
                sellingUnitPrice: item.medicine.sellingUnitPrice,
                lineTotal: item.lineTotal
            )
        }
        let total = items.reduce(Decimal(0)) { $0 + $1.lineTotal }
        guard total >= CartStore.minimumOrderTotal else { throw OrderError.minimumNotReached }
        let reference = "TEST-" + String(idempotencyKey.uuidString.prefix(4))
        return PublicOrder(
            orderId: "test_" + idempotencyKey.uuidString,
            orderReference: reference,
            status: "pending",
            items: items,
            itemsSubtotal: total,
            orderTotal: total,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
    }
}
#endif

enum OrderServiceFactory {
    #if DEBUG
    static let realOrdersKey = "debug.sendRealOrders"
    #endif

    /// True when this build sends orders to the pharmacy.
    static var sendsRealOrders: Bool {
        #if DEBUG
        return UserDefaults.standard.bool(forKey: realOrdersKey)
        #else
        return true
        #endif
    }

    static func make() -> OrderService {
        #if DEBUG
        return sendsRealOrders ? LiveOrderService() : SimulatedOrderService()
        #else
        return LiveOrderService()
        #endif
    }
}
