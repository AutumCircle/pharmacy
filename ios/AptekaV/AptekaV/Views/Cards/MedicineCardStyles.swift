import SwiftUI

// Card design options for review. Every style receives the same data and actions,
// so the chosen one can replace the others without touching the screens.

// MARK: - 1. Classic (website card)

struct ClassicMedicineCard: View {
    let medicine: Medicine
    let quantityInCart: Int
    let isFavorite: Bool
    let actions: MedicineCardActions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: actions.open) {
                Color.white
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(MedicineImageView(medicine: medicine).padding(12))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Theme.mediaBorder, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                FavoriteButton(isFavorite: isFavorite, action: actions.toggleFavorite)
            }
            .padding(.bottom, 12)

            MedicineNameButton(medicine: medicine, action: actions.open)

            Spacer(minLength: 8)

            PriceText(price: medicine.sellingUnitPrice, color: Theme.brandPrimary)
                .padding(.bottom, 10)

            if !medicine.inStock {
                OutOfStockLabel()
            } else if quantityInCart > 0 {
                QuantityStepper(quantity: quantityInCart, onChange: actions.changeQuantity)
            } else {
                AddToCartButton(action: actions.addToCart)
            }
        }
        .padding(12)
        .background(Theme.surfaceCard)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.mediaBorder, lineWidth: 1)
        )
        .outOfStockTreatment(medicine.inStock)
    }
}

// MARK: - 2. Liquid Glass

struct GlassMedicineCard: View {
    let medicine: Medicine
    let quantityInCart: Int
    let isFavorite: Bool
    let actions: MedicineCardActions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: actions.open) {
                GlassPhotoTile.color
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(MedicineImageView(medicine: medicine).padding(14))
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                FavoriteButton(isFavorite: isFavorite, style: .glass, action: actions.toggleFavorite)
                    .padding(2)
            }
            .padding(.bottom, 12)

            MedicineNameButton(medicine: medicine, action: actions.open)
                .padding(.horizontal, 2)

            Spacer(minLength: 8)

            PriceText(price: medicine.sellingUnitPrice, color: Theme.textPrimary)
                .padding(.horizontal, 2)
                .padding(.bottom, 10)

            if !medicine.inStock {
                GlassOutOfStockLabel()
            } else if quantityInCart > 0 {
                QuantityStepper(quantity: quantityInCart, style: .glass, onChange: actions.changeQuantity)
            } else {
                GlassAddToCartButton(action: actions.addToCart)
            }
        }
        .padding(10)
        .background(GlassCardBackground())
        .outOfStockTreatment(medicine.inStock)
    }
}

// MARK: - 3. Minimal (no card frame, "+" on the photo)

struct MinimalMedicineCard: View {
    let medicine: Medicine
    let quantityInCart: Int
    let isFavorite: Bool
    let actions: MedicineCardActions

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: actions.open) {
                Theme.surfaceMuted
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(MedicineImageView(medicine: medicine).padding(18))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                FavoriteButton(isFavorite: isFavorite, action: actions.toggleFavorite)
            }
            .overlay(alignment: .bottomTrailing) {
                photoControl.padding(8)
            }
            .outOfStockTreatment(medicine.inStock)

            PriceText(price: medicine.sellingUnitPrice, color: medicine.inStock ? Theme.textPrimary : Theme.textSecondary)
                .padding(.top, 2)

            MedicineNameButton(
                medicine: medicine,
                font: .system(size: 13),
                color: Theme.textSecondary,
                action: actions.open
            )
        }
    }

    @ViewBuilder
    private var photoControl: some View {
        if !medicine.inStock {
            Text("Нет в наличии")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Capsule().fill(Theme.textPrimary.opacity(0.75)))
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if quantityInCart > 0 {
            QuantityStepper(quantity: quantityInCart, style: .brand, height: 40, onChange: actions.changeQuantity)
                .shadow(color: Theme.brandPrimary.opacity(0.3), radius: 6, y: 3)
        } else {
            Button(action: actions.addToCart) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Theme.brandPrimary))
                    .shadow(color: Theme.brandPrimary.opacity(0.3), radius: 6, y: 3)
            }
            .buttonStyle(PressDimButtonStyle())
            .accessibilityLabel("В корзину")
        }
    }
}

// MARK: - 4. Row (horizontal, for search results and long lists)

struct RowMedicineCard: View {
    let medicine: Medicine
    let quantityInCart: Int
    let isFavorite: Bool
    let actions: MedicineCardActions

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: actions.open) {
                Color.white
                    .frame(width: 92, height: 92)
                    .overlay(MedicineImageView(medicine: medicine, placeholderSize: 30).padding(8))
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Theme.mediaBorder, lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 0) {
                    MedicineNameButton(medicine: medicine, font: .system(size: 15, weight: .medium), action: actions.open)
                    FavoriteButton(isFavorite: isFavorite, action: actions.toggleFavorite)
                        .padding(.top, -10)
                        .padding(.trailing, -10)
                }

                HStack(spacing: 8) {
                    PriceText(price: medicine.sellingUnitPrice, color: Theme.brandPrimary)
                        .layoutPriority(1)
                    Spacer(minLength: 0)
                    rowControl
                }
            }
        }
        .padding(12)
        .background(Theme.surfaceCard)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Theme.mediaBorder, lineWidth: 1)
        )
        .outOfStockTreatment(medicine.inStock)
    }

    @ViewBuilder
    private var rowControl: some View {
        if !medicine.inStock {
            Text("Нет в наличии")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(Theme.disabledText)
                .padding(.horizontal, 12)
                .frame(height: 36)
                .background(Capsule().fill(Theme.disabledFill))
        } else if quantityInCart > 0 {
            QuantityStepper(quantity: quantityInCart, height: 36, onChange: actions.changeQuantity)
                .frame(width: 116)
        } else {
            AddToCartButton(height: 36, action: actions.addToCart)
                .frame(width: 116)
        }
    }
}

// MARK: - 5. Showcase (full-bleed photo, price chip, outlined CTA)

struct ShowcaseMedicineCard: View {
    let medicine: Medicine
    let quantityInCart: Int
    let isFavorite: Bool
    let actions: MedicineCardActions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: actions.open) {
                LinearGradient(
                    colors: [Color(hex: 0xF2F4F7), .white],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .aspectRatio(1, contentMode: .fit)
                .overlay(MedicineImageView(medicine: medicine).padding(16))
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                FavoriteButton(isFavorite: isFavorite, style: .glass, action: actions.toggleFavorite)
                    .padding(4)
            }
            .overlay(alignment: .bottomLeading) {
                PriceText(price: medicine.sellingUnitPrice, color: medicine.inStock ? Theme.brandPrimary : Theme.textSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.white))
                    .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
                    .padding(10)
            }

            VStack(alignment: .leading, spacing: 10) {
                MedicineNameButton(medicine: medicine, action: actions.open)

                if !medicine.inStock {
                    OutOfStockLabel(height: 42)
                } else if quantityInCart > 0 {
                    QuantityStepper(quantity: quantityInCart, style: .brand, height: 42, onChange: actions.changeQuantity)
                } else {
                    Button(action: actions.addToCart) {
                        HStack(spacing: 6) {
                            Image(systemName: "cart")
                            Text("В корзину")
                        }
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(Theme.brandPrimary)
                        .frame(maxWidth: .infinity, minHeight: 42)
                        .background(Capsule().fill(Color.white))
                        .overlay(Capsule().stroke(Theme.brandPrimary, lineWidth: 1.5))
                        .contentShape(Capsule())
                    }
                    .buttonStyle(PressDimButtonStyle())
                }
            }
            .padding(12)
        }
        .background(Theme.surfaceCard)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .shadow(color: .black.opacity(0.06), radius: 12, y: 4)
        .outOfStockTreatment(medicine.inStock)
    }
}

// MARK: - 6 / 7. Showcase in Liquid Glass (outlined or solid CTA)

struct GlassShowcaseMedicineCard: View {
    let medicine: Medicine
    let quantityInCart: Int
    let isFavorite: Bool
    let buttonKind: GlassAddToCartButton.Kind
    let actions: MedicineCardActions

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: actions.open) {
                GlassPhotoTile.color
                    .aspectRatio(1, contentMode: .fit)
                    .overlay(MedicineImageView(medicine: medicine).padding(16))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
            .buttonStyle(.plain)
            .overlay(alignment: .topTrailing) {
                FavoriteButton(isFavorite: isFavorite, style: .glass, action: actions.toggleFavorite)
                    .padding(2)
            }
            .overlay(alignment: .bottomLeading) {
                PriceText(price: medicine.sellingUnitPrice, color: medicine.inStock ? Theme.brandPrimary : Theme.textSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(GlassCapsule(tint: nil))
                    .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
                    .padding(8)
            }

            VStack(alignment: .leading, spacing: 10) {
                MedicineNameButton(medicine: medicine, action: actions.open)

                if !medicine.inStock {
                    GlassOutOfStockLabel(height: 42)
                } else if quantityInCart > 0 {
                    QuantityStepper(quantity: quantityInCart, style: .glassBrand, height: 42, onChange: actions.changeQuantity)
                } else {
                    GlassAddToCartButton(
                        kind: buttonKind,
                        showsIcon: buttonKind == .outlined,
                        height: 42,
                        action: actions.addToCart
                    )
                }
            }
            .padding(.horizontal, 4)
            .padding(.top, 12)
            .padding(.bottom, 4)
        }
        .padding(8)
        .background(GlassCardBackground())
        .outOfStockTreatment(medicine.inStock)
    }
}

// MARK: - 8. Row in Liquid Glass

struct GlassRowMedicineCard: View {
    let medicine: Medicine
    let quantityInCart: Int
    let isFavorite: Bool
    let actions: MedicineCardActions

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button(action: actions.open) {
                GlassPhotoTile.color
                    .frame(width: 92, height: 92)
                    .overlay(MedicineImageView(medicine: medicine, placeholderSize: 30).padding(8))
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 0) {
                    MedicineNameButton(medicine: medicine, font: .system(size: 15, weight: .medium), action: actions.open)
                    FavoriteButton(isFavorite: isFavorite, action: actions.toggleFavorite)
                        .padding(.top, -10)
                        .padding(.trailing, -10)
                }

                HStack(spacing: 8) {
                    PriceText(price: medicine.sellingUnitPrice, color: Theme.textPrimary)
                        .layoutPriority(1)
                    Spacer(minLength: 0)
                    rowControl
                }
            }
        }
        .padding(10)
        .background(GlassCardBackground(cornerRadius: 22))
        .outOfStockTreatment(medicine.inStock)
    }

    @ViewBuilder
    private var rowControl: some View {
        if !medicine.inStock {
            GlassOutOfStockLabel(height: 36, fontSize: 13)
                .fixedSize()
        } else if quantityInCart > 0 {
            QuantityStepper(quantity: quantityInCart, style: .glass, height: 36, onChange: actions.changeQuantity)
                .frame(width: 116)
        } else {
            GlassAddToCartButton(height: 36, action: actions.addToCart)
                .frame(width: 116)
        }
    }
}

// MARK: - Shared text pieces

struct MedicineNameButton: View {
    let medicine: Medicine
    var font: Font = .system(size: 14, weight: .medium)
    var color: Color = Theme.textPrimary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(medicine.medicineName)
                .font(font)
                .foregroundColor(color)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, minHeight: 36, alignment: .topLeading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Открыть \(medicine.medicineName)")
    }
}

struct PriceText: View {
    let price: Decimal
    let color: Color

    var body: some View {
        Text(PriceFormatter.string(price))
            .font(.system(size: 18, weight: .bold).monospacedDigit())
            .foregroundColor(color)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }
}
