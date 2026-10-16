import SwiftUI

/// User actions shared by every medicine card style.
struct MedicineCardActions {
    var open: () -> Void = {}
    var toggleFavorite: () -> Void = {}
    var addToCart: () -> Void = {}
    /// New quantity; 0 means "remove from cart".
    var changeQuantity: (Int) -> Void = { _ in }
}

enum CartLimits {
    static let maxQuantity = 99
}

// MARK: - Image

/// Product photo (HTTPS only) with a neutral package placeholder.
struct MedicineImageView: View {
    let medicine: Medicine
    var placeholderSize: CGFloat = 44

    var body: some View {
        if let url = medicine.secureImageURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    // Product photos usually have a white background; multiply makes
                    // that white blend into the card surface instead of showing a box.
                    image.resizable().scaledToFit().blendMode(.multiply)
                case .empty:
                    ProgressView().tint(Theme.textSecondary)
                default:
                    placeholder
                }
            }
            .accessibilityHidden(true)
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        Image(systemName: "pills")
            .font(.system(size: placeholderSize, weight: .light))
            .foregroundColor(Color(hex: 0xDDDDDD))
            .accessibilityHidden(true)
    }
}

// MARK: - Favourite

struct FavoriteButton: View {
    enum Style { case plain, glass }

    let isFavorite: Bool
    var style: Style = .plain
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                if style == .glass {
                    Circle()
                        .fill(.ultraThinMaterial)
                        .overlay(Circle().stroke(GlassStyle.rim, lineWidth: 1))
                        .frame(width: 36, height: 36)
                        .shadow(color: .black.opacity(0.08), radius: 6, y: 3)
                }
                Image(systemName: isFavorite ? "heart.fill" : "heart")
                    .font(.system(size: style == .glass ? 16 : 20, weight: .medium))
                    .foregroundColor(isFavorite ? Theme.brandPrimary : iconColor)
            }
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isFavorite ? "Удалить из избранного" : "Добавить в избранное")
    }

    private var iconColor: Color {
        style == .glass ? Theme.textPrimary.opacity(0.7) : Color(hex: 0xCCCCCC)
    }
}

// MARK: - Quantity stepper

/// "− qty +" control. At quantity 1 the minus button removes the item, like on the website.
struct QuantityStepper: View {
    enum Style { case neutral, brand, glass, glassBrand }

    let quantity: Int
    var style: Style = .neutral
    var height: CGFloat = 44
    let onChange: (Int) -> Void

    var body: some View {
        HStack(spacing: 0) {
            stepButton(
                systemName: quantity == 1 ? "trash" : "minus",
                label: quantity == 1 ? "Удалить из корзины" : "Уменьшить количество"
            ) {
                onChange(quantity - 1)
            }

            Text("\(quantity)")
                .font(.system(size: 15, weight: .semibold).monospacedDigit())
                .frame(maxWidth: .infinity)
                .accessibilityLabel("Количество \(quantity)")

            stepButton(systemName: "plus", label: "Увеличить количество") {
                onChange(min(CartLimits.maxQuantity, quantity + 1))
            }
            .disabled(quantity >= CartLimits.maxQuantity)
        }
        .frame(height: height)
        .foregroundColor(foreground)
        .background(background)
    }

    private func stepButton(systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 40, height: max(44, height))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    private var foreground: Color {
        (style == .brand || style == .glassBrand) ? .white : Theme.textPrimary
    }

    @ViewBuilder
    private var background: some View {
        switch style {
        case .neutral:
            Capsule().fill(Theme.surfaceMuted)
        case .brand:
            Capsule().fill(Theme.brandPrimary)
        case .glass:
            GlassCapsule(tint: nil)
        case .glassBrand:
            GlassCapsule(tint: Theme.brandPrimary)
        }
    }
}

// MARK: - Buttons

/// Solid red capsule CTA «В корзину».
struct AddToCartButton: View {
    var title = "В корзину"
    var height: CGFloat = 44
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, minHeight: height)
                .background(Capsule().fill(Theme.brandPrimary))
                .contentShape(Capsule())
        }
        .buttonStyle(PressDimButtonStyle())
    }
}

/// Disabled grey capsule shown instead of the CTA for out-of-stock medicine.
struct OutOfStockLabel: View {
    var height: CGFloat = 44

    var body: some View {
        Text("Нет в наличии")
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(Theme.disabledText)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(Capsule().fill(Theme.disabledFill))
    }
}

struct PressDimButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
    }
}

// MARK: - Glass look (iOS 16 approximation of iOS 26 Liquid Glass)

enum GlassStyle {
    /// Light rim that makes material edges read as glass.
    static let rim = LinearGradient(
        colors: [.white.opacity(0.9), .white.opacity(0.15), .white.opacity(0.5)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Soft specular highlight on the upper part of a glass surface.
    static let highlight = LinearGradient(
        colors: [.white.opacity(0.45), .white.opacity(0)],
        startPoint: .top,
        endPoint: .center
    )
}

struct GlassCapsule: View {
    /// Optional colour tint mixed into the glass (e.g. brand red for the CTA).
    let tint: Color?

    var body: some View {
        ZStack {
            Capsule().fill(.ultraThinMaterial)
            if let tint = tint {
                Capsule().fill(tint.opacity(0.82))
            }
            Capsule().fill(GlassStyle.highlight).opacity(tint == nil ? 0.8 : 0.35)
            Capsule().stroke(GlassStyle.rim, lineWidth: 1)
        }
    }
}

/// Frosted card surface with highlight and rim.
struct GlassCardBackground: View {
    var cornerRadius: CGFloat = 26

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        ZStack {
            shape.fill(.ultraThinMaterial)
            shape.fill(GlassStyle.highlight).opacity(0.6)
            shape.stroke(GlassStyle.rim, lineWidth: 1.2)
        }
        .shadow(color: .black.opacity(0.08), radius: 18, y: 8)
    }
}

/// Opaque near-white photo tile. Photos multiply-blend into it (see MedicineImageView);
/// a translucent tile would leave the photo's own white background visible.
enum GlassPhotoTile {
    static let color = Color(hex: 0xFBFBFD)
}

/// «В корзину» on glass. `.solid` is red tinted glass, `.outlined` is clear glass with a red rim.
struct GlassAddToCartButton: View {
    enum Kind { case solid, outlined }

    var kind: Kind = .solid
    var showsIcon = false
    var height: CGFloat = 44
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if showsIcon {
                    Image(systemName: "cart")
                }
                Text("В корзину")
            }
            .font(.system(size: 15, weight: .semibold))
            .foregroundColor(kind == .solid ? .white : Theme.brandPrimary)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(GlassCapsule(tint: kind == .solid ? Theme.brandPrimary : nil))
            .overlay {
                if kind == .outlined {
                    Capsule().stroke(Theme.brandPrimary, lineWidth: 1.5)
                }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(PressDimButtonStyle())
    }
}

struct GlassOutOfStockLabel: View {
    var height: CGFloat = 44
    var fontSize: CGFloat = 15

    var body: some View {
        Text("Нет в наличии")
            .font(.system(size: fontSize, weight: .semibold))
            .foregroundColor(Theme.textSecondary)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: height)
            .background(GlassCapsule(tint: nil))
    }
}

/// Colourful backdrop so the glass cards have something to refract in previews.
struct GlassBackdrop: View {
    var body: some View {
        ZStack {
            Theme.surfacePage
            Circle()
                .fill(Theme.brandPrimary.opacity(0.35))
                .frame(width: 320)
                .blur(radius: 80)
                .offset(x: -120, y: -200)
            Circle()
                .fill(Color(hex: 0x1565C0).opacity(0.25))
                .frame(width: 300)
                .blur(radius: 80)
                .offset(x: 140, y: 120)
            Circle()
                .fill(Color(hex: 0x2E7D32).opacity(0.18))
                .frame(width: 260)
                .blur(radius: 80)
                .offset(x: -100, y: 420)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Out-of-stock treatment

extension View {
    /// Muted, greyscale look for unavailable medicine (UI spec §7.1).
    func outOfStockTreatment(_ inStock: Bool) -> some View {
        opacity(inStock ? 1 : 0.55)
            .grayscale(inStock ? 0 : 1)
    }
}
