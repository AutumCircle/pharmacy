import SwiftUI

#if DEBUG
/// Temporary review shell: pick a bottom navigation style and tap through the tabs.
/// «Главная» is the real live-search screen; «Каталог» hosts the card gallery so both reviews
/// stay reachable. The other tabs use local sample data only.
struct TabBarGalleryView: View {
    @State private var style: TabBarStyle
    @State private var selection: AppTab = .home
    @State private var cart: [Int: Int] = [Medicine.sampleLongName.id: 2, Medicine.sampleInStock.id: 1]
    @State private var favorites: Set<Int> = [Medicine.sampleLongName.id, Medicine.sampleWithPhoto.id]
    @State private var showComparison = false

    private let initialCardStyle: MedicineCardStyle

    private let medicines: [Medicine] = [
        .sampleWithPhoto,
        .sampleLongName,
        .sampleInStock,
        .sampleOutOfStock,
    ]

    init(initialStyle: TabBarStyle = .liquidGlass, initialCardStyle: MedicineCardStyle = .classic) {
        _style = State(initialValue: initialStyle)
        self.initialCardStyle = initialCardStyle
    }

    private var cartCount: Int { cart.values.reduce(0, +) }

    var body: some View {
        tabContent
            .safeAreaInset(edge: .bottom, spacing: 0) {
                AppTabBar(style: style, selection: $selection, cartCount: cartCount)
            }
            .sheet(isPresented: $showComparison) {
                NavigationStack {
                    TabBarComparisonView()
                        .navigationTitle("Все панели")
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Готово") { showComparison = false }
                            }
                        }
                }
            }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch selection {
        case .home:
            HomeView(cart: $cart, favorites: $favorites, trailingToolbarItem: AnyView(styleMenu))
        case .catalog:
            CardGalleryView(initialStyle: initialCardStyle)
        case .cart:
            screen(AppTab.cart.title) {
                let items = medicines.filter { cart[$0.id] != nil }
                if items.isEmpty {
                    emptyState(icon: "cart", text: "Корзина пуста")
                } else {
                    ForEach(items) { medicine in
                        card(medicine, style: style.isGlass ? .glassRow : .row)
                    }
                }
                Text("Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке")
                    .font(.system(size: 13))
                    .foregroundColor(Theme.textSecondary)
            }
        case .favorites:
            screen(AppTab.favorites.title) {
                let items = medicines.filter { favorites.contains($0.id) }
                if items.isEmpty {
                    emptyState(icon: "heart", text: "В избранном пока пусто")
                } else {
                    grid(items)
                }
            }
        case .profile:
            screen(AppTab.profile.title) {
                ProfileSample()
            }
        }
    }

    // MARK: Style menu

    private var styleMenu: some View {
        Menu {
            Picker("Вариант панели", selection: $style) {
                ForEach(TabBarStyle.allCases) { option in
                    Text("\(option.rawValue). \(option.title)").tag(option)
                }
            }
            Button {
                showComparison = true
            } label: {
                Label("Сравнить все панели", systemImage: "square.stack")
            }
        } label: {
            Image(systemName: "rectangle.bottomthird.inset.filled")
                .foregroundColor(Theme.brandPrimary)
                .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityLabel("Вариант панели навигации")
    }

    // MARK: Building blocks

    private func screen<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    content()
                }
                .padding(16)
            }
            .background(background)
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) { styleMenu }
            }
        }
    }

    @ViewBuilder
    private var background: some View {
        if style.isGlass {
            GlassBackdrop()
        } else {
            Theme.surfacePage.ignoresSafeArea()
        }
    }

    private func grid(_ items: [Medicine]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(items) { medicine in
                card(medicine, style: style.isGlass ? .glass : .classic)
            }
        }
    }

    private func card(_ medicine: Medicine, style cardStyle: MedicineCardStyle) -> some View {
        let id = medicine.id
        return MedicineCardView(
            medicine: medicine,
            quantityInCart: cart[id] ?? 0,
            isFavorite: favorites.contains(id),
            style: cardStyle,
            actions: MedicineCardActions(
                open: {},
                toggleFavorite: {
                    if favorites.contains(id) {
                        favorites.remove(id)
                    } else {
                        favorites.insert(id)
                    }
                },
                addToCart: { cart[id] = 1 },
                changeQuantity: { quantity in
                    cart[id] = quantity > 0 ? quantity : nil
                }
            )
        )
    }

    private func emptyState(icon: String, text: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 40))
                .foregroundColor(Theme.disabledFill)
            Text(text)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }
}

/// Profile placeholder. No accounts: orders are found by phone number («Мои заказы» lives here).
private struct ProfileSample: View {
    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 14) {
                Image(systemName: "person.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 56, height: 56)
                    .background(Circle().fill(Theme.brandPrimary))
                VStack(alignment: .leading, spacing: 3) {
                    Text("Гость")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(Theme.textPrimary)
                    Text("Регистрация не нужна")
                        .font(.system(size: 14))
                        .foregroundColor(Theme.textSecondary)
                }
                Spacer()
            }
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surfaceCard))

            VStack(spacing: 0) {
                row(icon: "shippingbox.fill", title: "Мои заказы", subtitle: "Поиск по номеру телефона")
                Divider().padding(.leading, 58)
                row(icon: "heart.fill", title: "Избранное", subtitle: nil)
                Divider().padding(.leading, 58)
                row(icon: "phone.fill", title: "Связаться с аптекой", subtitle: nil)
            }
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.surfaceCard))
        }
    }

    private func row(icon: String, title: String, subtitle: String?) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 32, height: 32)
                .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.brandPrimary))
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16))
                    .foregroundColor(Theme.textPrimary)
                if let subtitle = subtitle {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(Theme.textSecondary)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Theme.disabledFill)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 56)
    }
}

/// All bars stacked on one canvas for side-by-side comparison in Xcode previews.
struct TabBarComparisonView: View {
    @State private var selections: [TabBarStyle: AppTab] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                ForEach(TabBarStyle.allCases) { style in
                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(style.rawValue). \(style.title)")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                            .padding(.horizontal, 16)
                        AppTabBar(
                            style: style,
                            selection: Binding(
                                get: { selections[style] ?? .home },
                                set: { selections[style] = $0 }
                            ),
                            cartCount: 3
                        )
                        .padding(.top, style == .centerCart || style == .bubble ? 26 : 0)
                    }
                }
            }
            .padding(.vertical, 20)
        }
        .background(GlassBackdrop())
    }
}

struct TabBarGalleryView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            TabBarComparisonView()
                .previewDisplayName("Все панели")
            ForEach(TabBarStyle.allCases) { style in
                TabBarGalleryView(initialStyle: style)
                    .previewDisplayName("\(style.rawValue). \(style.title)")
            }
        }
    }
}
#endif
