import Foundation

/// Local cart. Prices here are display snapshots only: the order request will send just
/// `medicine_id` and `quantity`, and the server recalculates every price (API_CONTRACT §6).
@MainActor
final class CartStore: ObservableObject {
    struct Item: Codable, Identifiable, Equatable {
        var medicine: Medicine
        var quantity: Int

        var id: Int { medicine.id }
        var lineTotal: Decimal { medicine.sellingUnitPrice * Decimal(quantity) }
    }

    /// Orders below this server-calculated subtotal are rejected (API_CONTRACT §6).
    static let minimumOrderTotal: Decimal = 50
    /// API limit on unique positions per order.
    static let maxUniqueItems = 50

    @Published private(set) var items: [Item] = [] {
        didSet { persistence.save(items) }
    }

    private let persistence: JSONFileStore<[Item]>

    init(fileName: String = "cart_v1.json") {
        persistence = JSONFileStore(fileName: fileName)
        items = persistence.load() ?? []
    }

    var totalQuantity: Int { items.reduce(0) { $0 + $1.quantity } }
    var subtotal: Decimal { items.reduce(0) { $0 + $1.lineTotal } }
    var amountToMinimum: Decimal { max(0, Self.minimumOrderTotal - subtotal) }

    func quantity(of medicineId: Int) -> Int {
        items.first { $0.id == medicineId }?.quantity ?? 0
    }

    func add(_ medicine: Medicine) {
        guard medicine.inStock else { return }
        if let index = items.firstIndex(where: { $0.id == medicine.id }) {
            items[index].quantity = min(CartLimits.maxQuantity, items[index].quantity + 1)
        } else if items.count < Self.maxUniqueItems {
            items.append(Item(medicine: medicine, quantity: 1))
        }
    }

    /// Quantity 0 removes the item.
    func setQuantity(_ quantity: Int, for medicine: Medicine) {
        guard let index = items.firstIndex(where: { $0.id == medicine.id }) else {
            if quantity > 0 { add(medicine) }
            return
        }
        if quantity <= 0 {
            items.remove(at: index)
        } else {
            items[index].quantity = min(CartLimits.maxQuantity, quantity)
        }
    }

    func remove(_ medicineId: Int) {
        items.removeAll { $0.id == medicineId }
    }

    /// Replaces stored snapshots with fresh catalogue data (price, availability).
    func refresh(with medicines: [Medicine]) {
        let fresh = Dictionary(uniqueKeysWithValues: medicines.map { ($0.id, $0) })
        items = items.map { item in
            var item = item
            if let medicine = fresh[item.id] { item.medicine = medicine }
            return item
        }
    }
}

/// Saved medicines, newest first.
@MainActor
final class FavoritesStore: ObservableObject {
    @Published private(set) var medicines: [Medicine] = [] {
        didSet { persistence.save(medicines) }
    }

    private let persistence: JSONFileStore<[Medicine]>

    init(fileName: String = "favorites_v1.json") {
        persistence = JSONFileStore(fileName: fileName)
        medicines = persistence.load() ?? []
    }

    func contains(_ medicineId: Int) -> Bool {
        medicines.contains { $0.id == medicineId }
    }

    func toggle(_ medicine: Medicine) {
        if contains(medicine.id) {
            medicines.removeAll { $0.id == medicine.id }
        } else {
            medicines.insert(medicine, at: 0)
        }
    }

    func clear() {
        medicines = []
    }
}

/// Builds the card actions shared by every screen that shows medicine cards.
extension MedicineCardActions {
    @MainActor
    static func standard(
        for medicine: Medicine,
        cart: CartStore,
        favorites: FavoritesStore,
        open: @escaping () -> Void
    ) -> MedicineCardActions {
        MedicineCardActions(
            open: open,
            toggleFavorite: { favorites.toggle(medicine) },
            addToCart: { cart.add(medicine) },
            changeQuantity: { cart.setQuantity($0, for: medicine) }
        )
    }
}

/// Small JSON file in Application Support. Contains no secrets; cart and favourites only.
struct JSONFileStore<Value: Codable> {
    private let url: URL?

    init(fileName: String) {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        if let directory = directory {
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        url = directory?.appendingPathComponent(fileName)
    }

    func load() -> Value? {
        guard let url = url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: data)
    }

    func save(_ value: Value) {
        guard let url = url, let data = try? JSONEncoder().encode(value) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
