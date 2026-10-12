import SwiftUI

/// Main screen: a search bar that queries the live catalogue through `/api/search`.
struct HomeView: View {
    @StateObject private var search = SearchViewModel()
    // Owned by the app shell until the shared cart/favourites stores exist.
    @Binding var cart: [Int: Int]
    @Binding var favorites: Set<Int>
    /// Optional trailing navigation bar item (the design-review shell puts its style menu here).
    var trailingToolbarItem: AnyView?

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.surfacePage.ignoresSafeArea())
                .navigationTitle("Аптека «Ватан»")
                .navigationBarTitleDisplayMode(.inline)
                .searchable(
                    text: $search.query,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Поиск лекарств"
                )
                .autocorrectionDisabled()
                .toolbar {
                    ToolbarItem(placement: .navigationBarTrailing) {
                        if let item = trailingToolbarItem {
                            item
                        }
                    }
                }
                .task(id: search.query) {
                    await search.queryChanged()
                }
                .task {
                    await search.applyLaunchQuery()
                }
        }
        .tint(Theme.brandPrimary)
    }

    @ViewBuilder
    private var content: some View {
        switch search.state {
        case .idle:
            message(
                icon: "magnifyingglass",
                title: "Найдите лекарство",
                text: "Введите название, например «аспирин» или «нурофен»"
            )
        case .loading:
            ProgressView("Ищем…")
                .foregroundColor(Theme.textSecondary)
        case .empty:
            VStack(spacing: 16) {
                message(
                    icon: "questionmark.circle",
                    title: "Ничего не найдено",
                    text: "Проверьте название или попробуйте другой запрос"
                )
                suggestion
            }
        case .failed(let text):
            VStack(spacing: 16) {
                message(icon: "wifi.exclamationmark", title: "Ошибка поиска", text: text)
                Button("Повторить") {
                    Task { await search.retry() }
                }
                .buttonStyle(.borderedProminent)
                .frame(minHeight: 44)
            }
        case .loaded:
            results
        }
    }

    private var results: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                suggestion
                if let total = search.totalItems {
                    Text("Найдено: \(total)")
                        .font(.footnote)
                        .foregroundColor(Theme.textSecondary)
                }
                ForEach(search.results) { medicine in
                    MedicineCardView(
                        medicine: medicine,
                        quantityInCart: cart[medicine.id] ?? 0,
                        isFavorite: favorites.contains(medicine.id),
                        style: .row,
                        actions: actions(for: medicine)
                    )
                    .onAppear { search.loadMoreIfNeeded(current: medicine) }
                }
                if search.isLoadingMore {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.immediately)
    }

    @ViewBuilder
    private var suggestion: some View {
        if let didYouMean = search.didYouMean {
            Button {
                search.applySuggestion()
            } label: {
                HStack(spacing: 4) {
                    Text("Возможно, вы имели в виду:")
                        .foregroundColor(Theme.textSecondary)
                    Text(didYouMean)
                        .fontWeight(.semibold)
                        .foregroundColor(Theme.brandPrimary)
                }
                .font(.subheadline)
                .frame(minHeight: 44)
            }
        }
    }

    private func message(icon: String, title: String, text: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundColor(Theme.textSecondary)
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .foregroundColor(Theme.textPrimary)
            Text(text)
                .font(.subheadline)
                .foregroundColor(Theme.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 32)
    }

    private func actions(for medicine: Medicine) -> MedicineCardActions {
        MedicineCardActions(
            toggleFavorite: {
                if favorites.contains(medicine.id) {
                    favorites.remove(medicine.id)
                } else {
                    favorites.insert(medicine.id)
                }
            },
            addToCart: {
                guard medicine.inStock else { return }
                cart[medicine.id] = 1
            },
            changeQuantity: { quantity in
                cart[medicine.id] = quantity > 0 ? min(quantity, CartLimits.maxQuantity) : nil
            }
        )
    }
}

struct HomeView_Previews: PreviewProvider {
    static var previews: some View {
        HomeView(cart: .constant([:]), favorites: .constant([]))
    }
}
