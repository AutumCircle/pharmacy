import SwiftUI

/// «Главная»: search bar on top. With an empty query it shows the home feed (banners,
/// categories, product rows) in the selected layout; while typing it shows live search results.
struct HomeView: View {
    @EnvironmentObject private var design: DesignSettings
    @Environment(\.openRoute) private var openRoute
    @Environment(\.selectTab) private var selectTab
    @StateObject private var search = SearchViewModel()
    @StateObject private var feed = HomeFeedViewModel()

    var body: some View {
        Group {
            if search.state == .idle {
                feedContent
            } else {
                searchContent
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppBackground())
        .navigationTitle("Аптека «Ватан»")
        .navigationBarTitleDisplayMode(.inline)
        .appSearchBar(style: design.searchBar, text: $search.query, prompt: "Найти лекарство")
        .autocorrectionDisabled()
        .designPanelButton(onBrandBar: design.searchBar.hasBrandNavigationBar)
        .task(id: search.query) {
            await search.queryChanged()
        }
        .task {
            await search.applyLaunchQuery()
        }
        .task {
            await feed.loadIfNeeded()
        }
        .task {
            #if DEBUG
            // Launch argument `-openMedicineId N` opens that product page (simulator screenshots).
            let id = UserDefaults.standard.integer(forKey: "openMedicineId")
            if id > 0, let medicine = try? await APIClient.shared.medicine(id: id) {
                openRoute(.medicine(medicine))
            }
            #endif
        }
    }

    // MARK: Feed

    private var feedContent: some View {
        ScrollView {
            switch feed.state {
            case .loading:
                ProgressView("Загружаем…")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 80)
            case .failed(let message):
                StateMessageView(icon: "wifi.exclamationmark", title: "Не удалось загрузить главную", text: message, actionTitle: "Повторить") {
                    Task { await feed.load() }
                }
            case .loaded:
                HomeFeedLayout(
                    layout: design.home,
                    feed: feed,
                    onBanner: openBanner,
                    onAllCategories: { selectTab(.catalog) },
                    onCategory: { openRoute(.category($0)) },
                    onMedicine: { openRoute(.medicine($0)) }
                )
                .padding(.bottom, 24)
            }
        }
        .refreshable { await feed.load() }
    }

    private func openBanner(_ banner: HomeBanner) {
        if let slug = banner.linkedCategorySlug,
           let category = feed.categories.first(where: { $0.slug == slug }) {
            openRoute(.category(category))
        } else {
            selectTab(.catalog)
        }
    }

    // MARK: Search

    @ViewBuilder
    private var searchContent: some View {
        switch search.state {
        case .idle:
            EmptyView()
        case .loading:
            ProgressView("Ищем…")
                .foregroundColor(Theme.textSecondary)
        case .empty:
            VStack(spacing: 0) {
                StateMessageView(icon: "questionmark.circle", title: "Ничего не найдено", text: "Проверьте название или попробуйте другой запрос")
                suggestion
            }
        case .failed(let text):
            StateMessageView(icon: "wifi.exclamationmark", title: "Ошибка поиска", text: text, actionTitle: "Повторить") {
                Task { await search.retry() }
            }
        case .loaded:
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    suggestion
                    if let total = search.totalItems {
                        Text("Найдено: \(total)")
                            .font(.footnote)
                            .foregroundColor(Theme.textSecondary)
                    }
                    MedicineCollectionView(
                        medicines: search.results,
                        onOpen: { openRoute(.medicine($0)) },
                        onItemAppear: { search.loadMoreIfNeeded(current: $0) }
                    )
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
}

/// The home feed arranged in one of the `HomeLayoutStyle` options.
struct HomeFeedLayout: View {
    let layout: HomeLayoutStyle
    @ObservedObject var feed: HomeFeedViewModel
    let onBanner: (HomeBanner) -> Void
    let onAllCategories: () -> Void
    let onCategory: (MedicineCategory) -> Void
    let onMedicine: (Medicine) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            switch layout {
            case .classic:
                banners(look: .rounded, height: 170)
                    .padding(.top, 8)
                CategoryChipsRow(categories: feed.categories, onAll: onAllCategories, onSelect: onCategory)
                BenefitsRow()
                carousels(glass: false)
            case .showcase:
                banners(look: .edgeToEdge, height: 230)
                if !feed.categories.isEmpty {
                    SectionHeader(title: "Категории", actionTitle: "Все", action: onAllCategories)
                    CategoryTilesGrid(categories: feed.categories, onSelect: onCategory)
                }
                carousels(glass: false)
                BenefitsRow()
            case .compact:
                if !feed.banners.isEmpty {
                    BannerPeekRow(banners: feed.banners, isDemo: feed.bannersAreDemo, onTap: onBanner)
                        .padding(.top, 8)
                }
                CategoryCirclesRow(categories: feed.categories, onSelect: onCategory)
                carousels(glass: false)
                BenefitsRow()
            case .website:
                WebsiteHeroBanner(banners: feed.banners, isDemo: feed.bannersAreDemo, onTap: onBanner)
                    .padding(.top, 8)
                carousels(glass: false)
                WebsiteBenefits()
                if !feed.categories.isEmpty {
                    SectionHeader(title: "Категории", actionTitle: "Смотреть все", action: onAllCategories)
                    WebsiteCategoryGrid(categories: feed.categories, onSelect: onCategory)
                }
            case .glass:
                banners(look: .glass, height: 180)
                    .padding(.top, 8)
                CategoryChipsRow(categories: feed.categories, glass: true, onAll: onAllCategories, onSelect: onCategory)
                BenefitsRow(glass: true)
                carousels(glass: true)
            }
        }
    }

    @ViewBuilder
    private func banners(look: BannerCarousel.Look, height: CGFloat) -> some View {
        if !feed.banners.isEmpty {
            BannerCarousel(banners: feed.banners, look: look, height: height, isDemo: feed.bannersAreDemo, onTap: onBanner)
        }
    }

    private func carousels(glass: Bool) -> some View {
        ForEach(feed.carousels) { carousel in
            VStack(alignment: .leading, spacing: 0) {
                SectionHeader(
                    title: carousel.title,
                    action: carousel.category.map { category in { onCategory(category) } }
                )
                .padding(.top, glass ? 6 : 0)
                MedicineCarouselRow(medicines: carousel.products, onOpen: onMedicine)
            }
            .background {
                if glass {
                    GlassCardBackground(cornerRadius: 28)
                        .padding(.horizontal, 8)
                }
            }
        }
    }
}
