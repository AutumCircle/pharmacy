import Foundation

/// Checkout form state, validation and order placement (UI_DESIGN_SPEC §8.6, API_CONTRACT §6).
@MainActor
final class CheckoutViewModel: ObservableObject {
    enum Field: Hashable { case name, address, comment }

    static let nameRange = 2...120
    static let addressRange = 5...500
    static let commentMax = 500

    @Published var name: String
    @Published var address: String
    @Published var comment = ""
    @Published private(set) var savedAddresses: [String]

    @Published private(set) var isSubmitting = false
    @Published private(set) var fieldErrors: [Field: String] = [:]
    @Published private(set) var orderError: OrderError?
    @Published private(set) var placedOrder: PublicOrder?
    /// Cart items found unavailable after the server rejected the order.
    @Published private(set) var unavailableIds: Set<Int> = []
    @Published private(set) var isRefreshingCart = false

    private let service: OrderService
    private let customerStore = JSONFileStore<SavedCustomer>(fileName: "checkout_customer_v1.json")
    private let pendingStore = JSONFileStore<PendingOrder>(fileName: "checkout_pending_v1.json")

    /// Name and addresses remembered for the next order (local only).
    private struct SavedCustomer: Codable {
        var name: String
        var addresses: [String]
    }

    /// Same payload → same Idempotency-Key, so a retry after a timeout or a crash never
    /// creates a second order.
    private struct PendingOrder: Codable {
        let payload: Data
        let key: UUID
    }

    init(service: OrderService = OrderServiceFactory.make()) {
        self.service = service
        let saved = customerStore.load()
        name = saved?.name ?? ""
        savedAddresses = saved?.addresses ?? []
        address = saved?.addresses.first ?? ""
    }

    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedAddress: String { address.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedComment: String { comment.trimmingCharacters(in: .whitespacesAndNewlines) }

    func clearError(_ field: Field) {
        fieldErrors[field] = nil
    }

    // MARK: Validation

    @discardableResult
    func validate() -> Bool {
        var errors: [Field: String] = [:]
        if !Self.nameRange.contains(trimmedName.count) {
            errors[.name] = trimmedName.isEmpty ? "Укажите имя" : "Имя: от 2 до 120 символов"
        }
        if !Self.addressRange.contains(trimmedAddress.count) {
            errors[.address] = trimmedAddress.isEmpty ? "Укажите адрес доставки" : "Адрес: от 5 до 500 символов"
        }
        if trimmedComment.count > Self.commentMax {
            errors[.comment] = "Комментарий: не более 500 символов"
        }
        fieldErrors = errors
        return errors.isEmpty
    }

    // MARK: Submit

    func submit(cart: CartStore, verifiedPhone: String?) async {
        guard !isSubmitting else { return }
        orderError = nil
        guard validate() else { return }
        guard let phone = verifiedPhone, phone.hasPrefix(TajikPhone.countryCode) else {
            orderError = .validation(message: "Подтвердите номер телефона")
            return
        }
        guard !cart.items.isEmpty else { return }
        guard cart.amountToMinimum == 0 else {
            orderError = .minimumNotReached
            return
        }

        let request = CreateOrderRequest(
            customerName: trimmedName,
            phone: String(phone.dropFirst(TajikPhone.countryCode.count)),
            address: trimmedAddress,
            comment: trimmedComment.isEmpty ? nil : trimmedComment,
            items: cart.items.map { CreateOrderRequest.Item(medicineId: $0.medicine.medicineId, quantity: $0.quantity) }
        )
        let key = idempotencyKey(for: request)
        let snapshot = cart.items

        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let order = try await service.placeOrder(request, idempotencyKey: key, cartSnapshot: snapshot)
            pendingStore.clear()
            rememberCustomer()
            cart.clear()
            placedOrder = order
        } catch is CancellationError {
            return
        } catch let error as OrderError {
            // Keep the key only when the same request may be resent; otherwise start fresh.
            if !error.isRetryableWithSameKey { pendingStore.clear() }
            orderError = error
            if error == .itemsUnavailable(medicineIds: []) || error == .medicineNotFound(medicineIds: []) {
                await refreshCart(cart)
            }
        } catch {
            orderError = .server
        }
    }

    /// Re-reads every cart item to find what is no longer available (the API does not say which).
    func refreshCart(_ cart: CartStore) async {
        isRefreshingCart = true
        defer { isRefreshingCart = false }
        var fresh: [Medicine] = []
        var missing: Set<Int> = []
        await withTaskGroup(of: (Int, Medicine?).self) { group in
            for item in cart.items {
                let id = item.id
                group.addTask { (id, try? await APIClient.shared.medicine(id: id)) }
            }
            for await (id, medicine) in group {
                if let medicine = medicine { fresh.append(medicine) } else { missing.insert(id) }
            }
        }
        cart.refresh(with: fresh)
        unavailableIds = missing.union(fresh.filter { !$0.inStock }.map(\.id))
    }

    func removeUnavailable(from cart: CartStore) {
        for id in unavailableIds { cart.remove(id) }
        unavailableIds = []
        orderError = nil
    }

    // MARK: Helpers

    private func idempotencyKey(for request: CreateOrderRequest) -> UUID {
        let payload = (try? JSONEncoder().encode(request)) ?? Data()
        if let pending = pendingStore.load(), pending.payload == payload {
            return pending.key
        }
        let key = UUID()
        pendingStore.save(PendingOrder(payload: payload, key: key))
        return key
    }

    private func rememberCustomer() {
        var addresses = savedAddresses.filter { $0 != trimmedAddress }
        addresses.insert(trimmedAddress, at: 0)
        savedAddresses = Array(addresses.prefix(5))
        customerStore.save(SavedCustomer(name: trimmedName, addresses: savedAddresses))
    }
}
