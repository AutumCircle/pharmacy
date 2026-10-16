import SwiftUI

/// Product page (UI_DESIGN_SPEC §8.4) in the selected `ProductPageStyle`.
/// Shows only fields the API supplies; no indications, dosage or medical claims.
struct MedicineDetailView: View {
    @EnvironmentObject private var design: DesignSettings
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore

    @State private var medicine: Medicine
    /// The product no longer exists in the catalogue (404 from the API).
    @State private var isMissing = false

    init(medicine: Medicine) {
        _medicine = State(initialValue: medicine)
    }

    var body: some View {
        content
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            // The page has its own bottom purchase bar; the tab bar would cover it.
            .preference(key: HidesTabBarKey.self, value: !isMissing)
            .task {
                // Fresh price and availability; keep the passed snapshot on network errors.
                do {
                    let fresh = try await APIClient.shared.medicine(id: medicine.id)
                    medicine = fresh
                    cart.refresh(with: [fresh])
                } catch APIError.notFound {
                    isMissing = true
                } catch {}
            }
    }

    @ViewBuilder
    private var content: some View {
        if isMissing {
            ScrollView {
                ErrorStateView(kind: .notFound(title: "Товар не найден"))
            }
            .background(AppBackground())
        } else {
            pageStyle
        }
    }

    @ViewBuilder
    private var pageStyle: some View {
        switch design.productPage {
        case .classic: ClassicProductPage(medicine: medicine)
        case .hero: HeroProductPage(medicine: medicine)
        case .purchaseCard: PurchaseCardProductPage(medicine: medicine)
        case .glass: GlassProductPage(medicine: medicine)
        case .minimal: MinimalProductPage(medicine: medicine)
        }
    }
}

// MARK: - 1. Classic

private struct ClassicProductPage: View {
    let medicine: Medicine

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductPhoto(medicine: medicine, aspect: 1.2, cornerRadius: 20, bordered: true)
                ProductTitle(medicine: medicine)
                AvailabilityBadge(inStock: medicine.inStock)
                ProductPrice(medicine: medicine, size: 28)
                ProductInfoTable(medicine: medicine)
            }
            .padding(16)
            .padding(.bottom, 90)
        }
        .background(AppBackground())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            PurchaseControls(medicine: medicine)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(.ultraThinMaterial)
        }
    }
}

// MARK: - 2. Hero photo with an overlapping sheet

private struct HeroProductPage: View {
    @EnvironmentObject private var cart: CartStore
    let medicine: Medicine

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Color.white
                    .frame(height: 340)
                    .overlay(MedicineImageView(medicine: medicine, placeholderSize: 96).padding(36))
                    .outOfStockTreatment(medicine.inStock)

                VStack(alignment: .leading, spacing: 14) {
                    Capsule().fill(Theme.border).frame(width: 40, height: 5)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 10)
                    HStack(spacing: 8) {
                        AvailabilityBadge(inStock: medicine.inStock)
                        Text("Артикул \(String(medicine.medicineId))")
                            .font(.system(size: 13, weight: .medium).monospacedDigit())
                            .foregroundColor(Theme.textSecondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Capsule().fill(Theme.surfaceMuted))
                    }
                    ProductTitle(medicine: medicine, size: 24)
                    ProductPrice(medicine: medicine, size: 32)
                    Divider()
                    ProductInfoTable(medicine: medicine, boxed: false, showsArticle: false)
                    DeliveryNote()
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 120)
                .background(
                    RoundedCornersShape(radius: 28, corners: [.topLeft, .topRight])
                        .fill(Theme.surfacePage)
                        .shadow(color: .black.opacity(0.06), radius: 12, y: -4)
                )
                .padding(.top, -28)
            }
        }
        .background(Theme.surfacePage.ignoresSafeArea())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 14) {
                if medicine.inStock {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cart.quantity(of: medicine.id) > 0 ? "Итого" : "Цена")
                            .font(.system(size: 12))
                            .foregroundColor(Theme.textSecondary)
                        Text(PriceFormatter.string(medicine.sellingUnitPrice * Decimal(max(1, cart.quantity(of: medicine.id)))))
                            .font(.system(size: 20, weight: .bold).monospacedDigit())
                            .foregroundColor(Theme.textPrimary)
                    }
                    .frame(minWidth: 96, alignment: .leading)
                }
                PurchaseControls(medicine: medicine)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Theme.surfaceCard.shadow(color: .black.opacity(0.08), radius: 10, y: -2))
        }
    }
}

// MARK: - 3. Purchase card (website product page)

private struct PurchaseCardProductPage: View {
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore
    let medicine: Medicine

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ProductPhoto(medicine: medicine, aspect: 1.5, cornerRadius: 16, bordered: true)
                ProductTitle(medicine: medicine)

                VStack(alignment: .leading, spacing: 14) {
                    ProductPrice(medicine: medicine, size: 30)
                    AvailabilityBadge(inStock: medicine.inStock)
                    if medicine.catalogUpdatedAt != nil {
                        Text("Цена и наличие обновляются из аптеки")
                            .font(.system(size: 13))
                            .foregroundColor(Theme.textSecondary)
                    }
                    PurchaseControls(medicine: medicine)
                    DeliveryNote()
                }
                .padding(16)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surfaceCard))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.mediaBorder, lineWidth: 1))

                ProductInfoTable(medicine: medicine)
            }
            .padding(16)
            .padding(.bottom, 24)
        }
        .background(AppBackground())
    }
}

// MARK: - 4. Liquid Glass

private struct GlassProductPage: View {
    @EnvironmentObject private var cart: CartStore
    let medicine: Medicine

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                GlassPhotoTile.color
                    .aspectRatio(1.1, contentMode: .fit)
                    .overlay(MedicineImageView(medicine: medicine, placeholderSize: 80).padding(28))
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    .padding(8)
                    .background(GlassCardBackground(cornerRadius: 32))
                    .outOfStockTreatment(medicine.inStock)

                VStack(alignment: .leading, spacing: 12) {
                    AvailabilityBadge(inStock: medicine.inStock)
                    ProductTitle(medicine: medicine)
                    ProductPrice(medicine: medicine, size: 30)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(18)
                .background(GlassCardBackground(cornerRadius: 26))

                ProductInfoTable(medicine: medicine, boxed: false)
                    .padding(18)
                    .background(GlassCardBackground(cornerRadius: 26))
            }
            .padding(16)
            .padding(.bottom, 110)
        }
        .background(GlassBackdrop())
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Group {
                if !medicine.inStock {
                    GlassOutOfStockLabel(height: 50)
                } else if cart.quantity(of: medicine.id) > 0 {
                    ProductCartControls(medicine: medicine, style: .glassBrand, height: 50)
                } else {
                    GlassAddToCartButton(height: 50) { cart.add(medicine) }
                }
            }
            .padding(10)
            .background(GlassCardBackground(cornerRadius: 34))
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }
}

// MARK: - 5. Minimal, centred

private struct MinimalProductPage: View {
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var favorites: FavoritesStore
    let medicine: Medicine

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Theme.surfaceCard
                    .frame(width: 260, height: 260)
                    .overlay(MedicineImageView(medicine: medicine, placeholderSize: 80).padding(28))
                    .clipShape(Circle())
                    .shadow(color: .black.opacity(0.06), radius: 20, y: 8)
                    .outOfStockTreatment(medicine.inStock)
                    .padding(.top, 12)

                ProductTitle(medicine: medicine, centered: true)

                ProductPrice(medicine: medicine, size: 40, centered: true)

                AvailabilityBadge(inStock: medicine.inStock)

                HStack(spacing: 18) {
                    if medicine.inStock {
                        if cart.quantity(of: medicine.id) > 0 {
                            ProductCartControls(medicine: medicine, style: .brand, height: 60)
                        } else {
                            Button { cart.add(medicine) } label: {
                                Image(systemName: "cart.badge.plus")
                                    .font(.system(size: 24, weight: .semibold))
                                    .foregroundColor(.white)
                                    .frame(width: 60, height: 60)
                                    .background(Circle().fill(Theme.brandPrimary))
                                    .shadow(color: Theme.brandPrimary.opacity(0.35), radius: 10, y: 4)
                            }
                            .accessibilityLabel("В корзину")
                        }
                    }
                }
                .padding(.vertical, 6)

                ProductInfoTable(medicine: medicine)
            }
            .padding(20)
            .padding(.bottom, 24)
        }
        .background(Theme.surfaceMuted.ignoresSafeArea())
    }
}

// MARK: - Shared pieces

private struct ProductPhoto: View {
    let medicine: Medicine
    let aspect: CGFloat
    let cornerRadius: CGFloat
    var bordered = false

    var body: some View {
        Color.white
            .aspectRatio(aspect, contentMode: .fit)
            .overlay(MedicineImageView(medicine: medicine, placeholderSize: 80).padding(24))
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(bordered ? Theme.mediaBorder : .clear, lineWidth: 1)
            )
            .outOfStockTreatment(medicine.inStock)
    }
}

private struct ProductTitle: View {
    let medicine: Medicine
    var size: CGFloat = 22
    var centered = false

    var body: some View {
        Text(medicine.medicineName)
            .font(.system(size: size, weight: .bold))
            .foregroundColor(Theme.textPrimary)
            .multilineTextAlignment(centered ? .center : .leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
    }
}

/// Price on the left, favourite heart at the opposite (right) end of the same row.
private struct ProductPrice: View {
    let medicine: Medicine
    let size: CGFloat
    var centered = false

    var body: some View {
        HStack(spacing: 12) {
            if centered { Spacer(minLength: 0) }
            Text(PriceFormatter.string(medicine.sellingUnitPrice))
                .font(.system(size: size, weight: .bold).monospacedDigit())
                .foregroundColor(medicine.inStock ? Theme.brandPrimary : Theme.textSecondary)
            Spacer(minLength: centered ? 12 : 0)
            FavoriteHeartButton(medicine: medicine)
            if centered { Spacer(minLength: 0) }
        }
    }
}

private struct FavoriteHeartButton: View {
    @EnvironmentObject private var favorites: FavoritesStore
    let medicine: Medicine

    var body: some View {
        Button {
            favorites.toggle(medicine)
        } label: {
            Image(systemName: favorites.contains(medicine.id) ? "heart.fill" : "heart")
                .font(.system(size: 22, weight: .semibold))
                .foregroundColor(Theme.brandPrimary)
                .frame(width: 48, height: 48)
                .background(Circle().fill(Theme.brandSoft))
        }
        .accessibilityLabel(favorites.contains(medicine.id) ? "Удалить из избранного" : "Добавить в избранное")
    }
}

struct AvailabilityBadge: View {
    let inStock: Bool

    var body: some View {
        Label(inStock ? "В наличии" : "Нет в наличии", systemImage: inStock ? "checkmark.circle.fill" : "xmark.circle.fill")
            .font(.system(size: 13, weight: .semibold))
            .foregroundColor(inStock ? Theme.success : Theme.danger)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(Capsule().fill((inStock ? Theme.success : Theme.danger).opacity(0.1)))
    }
}

/// «Информация о товаре»: vendor, country and article number when supplied.
private struct ProductInfoTable: View {
    let medicine: Medicine
    var boxed = true
    var showsArticle = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Информация о товаре")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(Theme.textPrimary)
                .padding(.bottom, 8)
            if let vendor = clean(medicine.vendor) {
                row("Производитель", vendor)
            }
            if let country = clean(medicine.country) {
                row("Страна", country)
            }
            if showsArticle {
                row("Артикул", String(medicine.medicineId))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(boxed ? 16 : 0)
        .background {
            if boxed {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.surfaceCard)
            }
        }
    }

    /// Catalogue values sometimes contain placeholders like "," or a leading "*".
    private func clean(_ value: String?) -> String? {
        let text = (value ?? "").trimmingCharacters(in: CharacterSet(charactersIn: " ,*"))
        return text.isEmpty ? nil : text
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(title).foregroundColor(Theme.textSecondary)
            Spacer(minLength: 16)
            Text(value)
                .foregroundColor(Theme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .font(.system(size: 15))
        .padding(.vertical, 8)
    }
}

private struct DeliveryNote: View {
    var body: some View {
        Label("Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке", systemImage: "shippingbox")
            .font(.system(size: 13))
            .foregroundColor(Theme.textSecondary)
    }
}

/// «В корзину» / stepper / «Нет в наличии», full width.
private struct PurchaseControls: View {
    @EnvironmentObject private var cart: CartStore
    let medicine: Medicine

    var body: some View {
        if !medicine.inStock {
            OutOfStockLabel(height: 50)
        } else if cart.quantity(of: medicine.id) > 0 {
            ProductCartControls(medicine: medicine, style: .brand, height: 50)
        } else {
            AddToCartButton(height: 50) { cart.add(medicine) }
        }
    }
}

/// In-cart controls on the product page: 🗑 remove, − quantity +, 🛒 open the cart.
private struct ProductCartControls: View {
    @EnvironmentObject private var cart: CartStore
    @Environment(\.selectTab) private var selectTab
    let medicine: Medicine
    let style: QuantityStepper.Style
    let height: CGFloat

    private var isGlass: Bool { style == .glassBrand || style == .glass }

    var body: some View {
        HStack(spacing: 10) {
            iconButton("trash", label: "Удалить из корзины", tint: Theme.danger) {
                cart.setQuantity(0, for: medicine)
            }
            QuantityStepper(quantity: cart.quantity(of: medicine.id), style: style, height: height, trashAtOne: false) {
                cart.setQuantity($0, for: medicine)
            }
            iconButton("cart.fill", label: "Перейти в корзину", tint: Theme.brandPrimary) {
                selectTab(.cart)
            }
        }
    }

    private func iconButton(_ icon: String, label: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 19, weight: .semibold))
                .foregroundColor(tint)
                .frame(width: height, height: height)
                .background {
                    if isGlass {
                        GlassCapsule(tint: nil)
                    } else {
                        Circle().fill(Theme.surfaceMuted)
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(PressDimButtonStyle())
        .accessibilityLabel(label)
    }
}
