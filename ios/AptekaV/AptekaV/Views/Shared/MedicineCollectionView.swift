import SwiftUI

/// Medicines in the selected card style: two-column grid, or full-width rows for row styles.
/// Put it inside a ScrollView. `onItemAppear` drives infinite scrolling.
struct MedicineCollectionView: View {
    @EnvironmentObject private var design: DesignSettings
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore

    let medicines: [Medicine]
    /// Overrides the design choice (e.g. the cart always uses rows).
    var style: MedicineCardStyle?
    let onOpen: (Medicine) -> Void
    var onItemAppear: (Medicine) -> Void = { _ in }

    private var cardStyle: MedicineCardStyle { style ?? design.card }

    var body: some View {
        if cardStyle.columns == 1 {
            LazyVStack(spacing: 12) { cards }
        } else {
            LazyVGrid(
                columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)],
                spacing: cardStyle.isFrameless ? 20 : 12
            ) { cards }
        }
    }

    private var cards: some View {
        ForEach(medicines) { medicine in
            MedicineCardView(
                medicine: medicine,
                quantityInCart: cart.quantity(of: medicine.id),
                isFavorite: favorites.contains(medicine.id),
                style: cardStyle,
                actions: .standard(for: medicine, cart: cart, favorites: favorites) { onOpen(medicine) }
            )
            .onAppear { onItemAppear(medicine) }
        }
    }
}

/// Horizontal product row for the home screen.
struct MedicineCarouselRow: View {
    @EnvironmentObject private var design: DesignSettings
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore

    let medicines: [Medicine]
    let onOpen: (Medicine) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(medicines) { medicine in
                    MedicineCardView(
                        medicine: medicine,
                        quantityInCart: cart.quantity(of: medicine.id),
                        isFavorite: favorites.contains(medicine.id),
                        style: design.card,
                        actions: .standard(for: medicine, cart: cart, favorites: favorites) { onOpen(medicine) }
                    )
                    // Row styles are wide by design; grid styles get a phone-column width.
                    .frame(width: design.card.columns == 1 ? 320 : 168)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }
}

extension MedicineCardStyle {
    /// Styles without a card frame need more vertical space between rows.
    var isFrameless: Bool { self == .minimal || self == .glassMinimal }
}

/// Centered icon + title + text for loading/empty/error states.
struct StateMessageView: View {
    let icon: String
    let title: String
    var text: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 44))
                .foregroundColor(Theme.textSecondary)
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
                .foregroundColor(Theme.textPrimary)
            if let text = text {
                Text(text)
                    .font(.subheadline)
                    .foregroundColor(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
            if let actionTitle = actionTitle, let action = action {
                Button(actionTitle, action: action)
                    .buttonStyle(.borderedProminent)
                    .tint(Theme.brandPrimary)
                    .frame(minHeight: 44)
                    .padding(.top, 6)
            }
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

/// Website carousels shown on empty screens (cart, favourites), «Дермокосметика» first,
/// so the customer can add products right there.
struct SuggestedCarouselsSection: View {
    @Environment(\.openRoute) private var openRoute
    var limit = 2
    @State private var carousels: [ProductCarousel] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(carousels) { carousel in
                SectionHeader(title: carousel.title, action: nil)
                MedicineCarouselRow(medicines: carousel.products, onOpen: { openRoute(.medicine($0)) })
            }
        }
        .task {
            guard carousels.isEmpty, let loaded = try? await APIClient.shared.productCarousels() else { return }
            let preferred = loaded.filter { $0.slug == "dermocosmetics" }
            let others = loaded.filter { $0.slug != "dermocosmetics" && !$0.products.isEmpty }
            carousels = Array((preferred + others).prefix(limit))
        }
    }
}
