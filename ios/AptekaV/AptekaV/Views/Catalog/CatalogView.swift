import SwiftUI

/// «Каталог» tab: live categories from `/api/categories`.
struct CatalogView: View {
    @Environment(\.openRoute) private var openRoute
    @EnvironmentObject private var network: NetworkMonitor
    @State private var categories: [MedicineCategory] = []
    @State private var state: LoadState = .loading

    var body: some View {
        ScrollView {
            content.padding(16)
        }
        .background(AppBackground())
        .navigationTitle("Каталог")
        .refreshable { await load() }
        .task { if categories.isEmpty { await load() } }
        .onChange(of: network.isOnline) { online in
            if online, case .failed = state { Task { await load() } }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch state {
        case .loading:
            ProgressView("Загружаем категории…")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 60)
        case .failed(let message):
            ErrorStateView(kind: .failed(message: message), retry: { Task { await load() } })
        case .loaded:
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(categories) { category in
                    Button {
                        openRoute(.category(category))
                    } label: {
                        CategoryTile(category: category)
                    }
                    .buttonStyle(PressDimButtonStyle())
                }
            }
        }
    }

    private func load() async {
        if categories.isEmpty { state = .loading }
        do {
            categories = try await APIClient.shared.categories()
            state = .loaded
        } catch is CancellationError {
            return
        } catch {
            state = .failed((error as? APIError)?.message ?? APIError.server(code: nil).message)
        }
    }
}

enum LoadState: Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Category tile with the admin-configured icon and colour.
struct CategoryTile: View {
    let category: MedicineCategory

    var body: some View {
        HStack(spacing: 10) {
            Text(category.icon ?? "💊")
                .font(.system(size: 22))
                .frame(width: 44, height: 44)
                .background(Circle().fill(category.accentColor.opacity(0.14)))
                .accessibilityHidden(true)
            Text(category.name)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(Theme.textPrimary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.surfaceCard))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.mediaBorder, lineWidth: 1)
        )
    }
}

/// Products of one category, 24 per page, next page loads on scroll.
struct CategoryProductsView: View {
    @StateObject private var model: CategoryProductsViewModel
    @Environment(\.openRoute) private var openRoute
    private let category: MedicineCategory

    init(category: MedicineCategory) {
        self.category = category
        _model = StateObject(wrappedValue: CategoryProductsViewModel(slug: category.slug))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if let total = model.totalItems {
                    Text("Товаров: \(total)")
                        .font(.footnote)
                        .foregroundColor(Theme.textSecondary)
                }
                switch model.state {
                case .loading:
                    ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60)
                case .failed(let message):
                    ErrorStateView(kind: .failed(message: message), retry: { Task { await model.reload() } })
                case .loaded where model.medicines.isEmpty:
                    StateMessageView(icon: "shippingbox", title: "В этой категории пока нет доступных товаров")
                case .loaded:
                    MedicineCollectionView(
                        medicines: model.medicines,
                        onOpen: { openRoute(.medicine($0)) },
                        onItemAppear: { model.loadMoreIfNeeded(current: $0) }
                    )
                    if model.isLoadingMore {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 8)
                    }
                }
            }
            .padding(16)
        }
        .background(AppBackground())
        .navigationTitle(category.name)
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.reload() }
        .task { await model.loadFirstPageIfNeeded() }
    }
}

@MainActor
final class CategoryProductsViewModel: ObservableObject {
    @Published private(set) var medicines: [Medicine] = []
    @Published private(set) var state: LoadState = .loading
    @Published private(set) var totalItems: Int?
    @Published private(set) var isLoadingMore = false

    private let slug: String
    private var page = 0
    private var totalPages = 1
    private static let pageSize = 24

    init(slug: String) {
        self.slug = slug
    }

    func loadFirstPageIfNeeded() async {
        guard medicines.isEmpty else { return }
        await reload()
    }

    func reload() async {
        if medicines.isEmpty { state = .loading }
        do {
            let response = try await APIClient.shared.categoryMedicines(slug: slug, page: 1, limit: Self.pageSize)
            medicines = response.data.medicines
            page = 1
            totalPages = response.page.totalPages
            totalItems = response.page.totalItems
            state = .loaded
        } catch is CancellationError {
            return
        } catch {
            state = .failed((error as? APIError)?.message ?? APIError.server(code: nil).message)
        }
    }

    func loadMoreIfNeeded(current medicine: Medicine) {
        guard medicine.id == medicines.last?.id, page < totalPages, !isLoadingMore else { return }
        isLoadingMore = true
        Task {
            defer { isLoadingMore = false }
            guard let response = try? await APIClient.shared.categoryMedicines(slug: slug, page: page + 1, limit: Self.pageSize) else { return }
            let known = Set(medicines.map(\.id))
            medicines.append(contentsOf: response.data.medicines.filter { !known.contains($0.id) })
            page = response.page.number
            totalPages = response.page.totalPages
        }
    }
}
