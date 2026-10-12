import SwiftUI

#if DEBUG
/// Temporary review screen: switch between card styles and tap through every state
/// (add to cart, stepper, favourite, out of stock). Uses local sample data only.
struct CardGalleryView: View {
    @State private var style: MedicineCardStyle
    @State private var cart: [Int: Int] = [Medicine.sampleLongName.id: 2]
    @State private var favorites: Set<Int> = [Medicine.sampleLongName.id]

    private let medicines: [Medicine] = [
        .sampleWithPhoto,
        .sampleLongName,
        .sampleInStock,
        .sampleOutOfStock,
    ]

    init(initialStyle: MedicineCardStyle = .classic) {
        _style = State(initialValue: initialStyle)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    styleHeader

                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 12), count: style.columns),
                        spacing: style == .minimal ? 20 : 12
                    ) {
                        ForEach(medicines) { medicine in
                            MedicineCardView(
                                medicine: medicine,
                                quantityInCart: cart[medicine.id] ?? 0,
                                isFavorite: favorites.contains(medicine.id),
                                style: style,
                                actions: actions(for: medicine)
                            )
                        }
                    }
                }
                .padding(16)
            }
            .background(background)
            .navigationTitle("Карточки товара")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private var styleHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Вариант", selection: $style) {
                ForEach(MedicineCardStyle.allCases) { option in
                    Text("\(option.rawValue)").tag(option)
                }
            }
            .pickerStyle(.segmented)

            Text("\(style.rawValue). \(style.title)")
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Theme.textPrimary)
            Text(style.summary)
                .font(.system(size: 14))
                .foregroundColor(Theme.textSecondary)
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

    private func actions(for medicine: Medicine) -> MedicineCardActions {
        let id = medicine.id
        return MedicineCardActions(
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
    }
}

struct CardGalleryView_Previews: PreviewProvider {
    static var previews: some View {
        CardGalleryView()
    }
}
#endif
