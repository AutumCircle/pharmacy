import Foundation

/// Data for the home screen: banners, categories and product rows, loaded in parallel.
///
/// Banners and curated carousels come from `/api/homepage-banners` and `/api/product-carousels`.
/// Until the website deploys those routes they return 404; then product rows are built from the
/// first categories (live data), and banners fall back to demo banners in debug builds only.
@MainActor
final class HomeFeedViewModel: ObservableObject {
    @Published private(set) var banners: [HomeBanner] = []
    @Published private(set) var categories: [MedicineCategory] = []
    @Published private(set) var carousels: [ProductCarousel] = []
    @Published private(set) var state: LoadState = .loading
    /// True when the banners are local demo data (debug builds only).
    @Published private(set) var bannersAreDemo = false
    /// True when the rows are the website's curated carousels (not built from categories).
    @Published private(set) var carouselsAreFromWebsite = false

    private let client: APIClient
    private static let categoryRows = 4
    private static let productsPerRow = 12

    init(client: APIClient = .shared) {
        self.client = client
    }

    func loadIfNeeded() async {
        guard categories.isEmpty, carousels.isEmpty else { return }
        await load()
    }

    func load() async {
        if categories.isEmpty && carousels.isEmpty { state = .loading }

        async let bannersResult = result { try await self.client.homepageBanners() }
        async let categoriesResult = result { try await self.client.categories() }
        async let carouselsResult = result { try await self.client.productCarousels() }
        let (bannersOutcome, categoriesOutcome, carouselsOutcome) = await (bannersResult, categoriesResult, carouselsResult)
        guard !Task.isCancelled else { return }

        applyBanners(bannersOutcome)

        let loadedCategories = (try? categoriesOutcome.get()) ?? []
        categories = loadedCategories

        let curated = ((try? carouselsOutcome.get()) ?? []).filter { !$0.products.isEmpty }
        carouselsAreFromWebsite = !curated.isEmpty
        if curated.isEmpty {
            carousels = await categoryCarousels(from: loadedCategories)
        } else {
            carousels = curated
        }

        if case .failure(let error) = categoriesOutcome, carousels.isEmpty {
            state = .failed((error as? APIError)?.message ?? APIError.server(code: nil).message)
        } else {
            state = .loaded
        }
    }

    private func applyBanners(_ outcome: Result<[HomeBanner], Error>) {
        // The app shows only the banner designed for phones (`mobile` slot), like the website on mobile.
        let live = ((try? outcome.get()) ?? [])
            .filter { $0.slot == "mobile" && ($0.secureImageURL != nil || !($0.title ?? "").isEmpty) }
        #if DEBUG
        bannersAreDemo = live.isEmpty
        banners = live.isEmpty ? HomeBanner.demo : live
        #else
        bannersAreDemo = false
        banners = live
        #endif
    }

    /// One product row per leading category, fetched in parallel, kept in category order.
    private func categoryCarousels(from categories: [MedicineCategory]) async -> [ProductCarousel] {
        let leading = Array(categories.prefix(Self.categoryRows))
        let client = self.client
        let rows = await withTaskGroup(of: (Int, ProductCarousel?).self) { group -> [(Int, ProductCarousel?)] in
            for (index, category) in leading.enumerated() {
                group.addTask {
                    guard let response = try? await client.categoryMedicines(slug: category.slug, page: 1, limit: Self.productsPerRow),
                          !response.data.medicines.isEmpty else {
                        return (index, nil)
                    }
                    var row = ProductCarousel(slug: category.slug, title: category.name, products: response.data.medicines)
                    row.category = category
                    return (index, row)
                }
            }
            var collected: [(Int, ProductCarousel?)] = []
            for await item in group { collected.append(item) }
            return collected
        }
        return rows.sorted { $0.0 < $1.0 }.compactMap { $0.1 }
    }

    private func result<T>(_ operation: @escaping () async throws -> T) async -> Result<T, Error> {
        do {
            return .success(try await operation())
        } catch {
            return .failure(error)
        }
    }
}
