import SwiftUI

// Building blocks of the home screen. Each home layout combines them differently.

// MARK: - Banners

/// Paged banner carousel that advances every 5 seconds (paused while the user is swiping).
struct BannerCarousel: View {
    enum Look { case rounded, edgeToEdge, glass }

    let banners: [HomeBanner]
    var look: Look = .rounded
    var height: CGFloat = 170
    var isDemo = false
    let onTap: (HomeBanner) -> Void

    @State private var index = 0

    var body: some View {
        VStack(spacing: 8) {
            TabView(selection: $index) {
                ForEach(Array(banners.enumerated()), id: \.element.id) { offset, banner in
                    Button { onTap(banner) } label: {
                        BannerCard(banner: banner, isDemo: isDemo, cornerRadius: look == .edgeToEdge ? 0 : 20)
                    }
                    .buttonStyle(PressDimButtonStyle())
                    .padding(.horizontal, look == .edgeToEdge ? 0 : 16)
                    .tag(offset)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .frame(height: height)
            .modifier(BannerFrame(look: look))

            if banners.count > 1 {
                PageDots(count: banners.count, index: index)
            }
        }
        .task(id: banners.count) {
            guard banners.count > 1 else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                guard !Task.isCancelled else { return }
                withAnimation(.easeInOut(duration: 0.4)) {
                    index = (index + 1) % banners.count
                }
            }
        }
    }
}

private struct BannerFrame: ViewModifier {
    let look: BannerCarousel.Look

    func body(content: Content) -> some View {
        switch look {
        case .edgeToEdge:
            content.clipShape(RoundedCornersShape(radius: 28, corners: [.bottomLeft, .bottomRight]))
        case .glass:
            content
                .padding(.vertical, 6)
        case .rounded:
            content
        }
    }
}

/// Banners as horizontally scrolling cards with the next one peeking in.
struct BannerPeekRow: View {
    let banners: [HomeBanner]
    var isDemo = false
    let onTap: (HomeBanner) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(banners) { banner in
                    Button { onTap(banner) } label: {
                        BannerCard(banner: banner, isDemo: isDemo, cornerRadius: 18, compact: true)
                            .frame(width: 300, height: 140)
                    }
                    .buttonStyle(PressDimButtonStyle())
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

/// One banner: admin image (HTTPS) with optional overlay, or a brand gradient when there is none.
struct BannerCard: View {
    let banner: HomeBanner
    var isDemo = false
    var cornerRadius: CGFloat = 20
    var compact = false

    private var baseColor: Color {
        banner.overlayColor.flatMap(Color.init(hexString:)) ?? Theme.brandPrimary
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            background
            if hasText {
                text.padding(compact ? 14 : 18)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(alignment: .topTrailing) {
            if isDemo {
                Text("демо")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Color.black.opacity(0.35)))
                    .padding(10)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(banner.altText ?? banner.title ?? "Баннер")
    }

    private var hasText: Bool {
        !(banner.title ?? "").isEmpty || !(banner.subtitle ?? "").isEmpty
    }

    @ViewBuilder
    private var background: some View {
        if let url = banner.secureImageURL {
            ZStack {
                baseColor.opacity(0.15)
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFill()
                    } else {
                        ProgressView()
                    }
                }
                if hasText {
                    LinearGradient(
                        colors: [overlayColor.opacity(overlayOpacity), overlayColor.opacity(0)],
                        startPoint: .bottom,
                        endPoint: .top
                    )
                }
            }
        } else {
            ZStack(alignment: .topTrailing) {
                LinearGradient(
                    colors: [baseColor, baseColor.opacity(0.75)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                Circle()
                    .fill(Color.white.opacity(0.12))
                    .frame(width: 180)
                    .offset(x: 60, y: -50)
                Image(systemName: "cross.case.fill")
                    .font(.system(size: compact ? 40 : 56))
                    .foregroundColor(.white.opacity(0.22))
                    .padding(compact ? 16 : 22)
                    .padding(.top, 14)
            }
        }
    }

    private var overlayColor: Color {
        banner.overlayColor.flatMap(Color.init(hexString:)) ?? .black
    }

    private var overlayOpacity: Double {
        guard banner.overlayEnabled != false else { return 0.45 }
        return min(max((banner.overlayOpacity ?? 45) / 100, 0.25), 0.85)
    }

    private var text: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let title = banner.title, !title.isEmpty {
                Text(title)
                    .font(.system(size: compact ? 18 : 22, weight: .bold))
                    .lineLimit(2)
            }
            if let subtitle = banner.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.system(size: compact ? 13 : 14))
                    .lineLimit(2)
                    .opacity(0.9)
            }
            if let cta = banner.ctaText, !cta.isEmpty, !compact {
                Text(cta)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(baseColor)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(Capsule().fill(Color.white))
                    .padding(.top, 4)
            }
        }
        .foregroundColor(banner.foreground)
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PageDots: View {
    let count: Int
    let index: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { dot in
                Capsule()
                    .fill(dot == index ? Theme.brandPrimary : Theme.disabledFill)
                    .frame(width: dot == index ? 18 : 6, height: 6)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: index)
        .accessibilityHidden(true)
    }
}

struct RoundedCornersShape: Shape {
    let radius: CGFloat
    let corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        Path(UIBezierPath(roundedRect: rect, byRoundingCorners: corners, cornerRadii: CGSize(width: radius, height: radius)).cgPath)
    }
}

// MARK: - Categories

/// Horizontal capsules: «Все товары» first, then active categories (UI spec §6.1 category strip).
struct CategoryChipsRow: View {
    let categories: [MedicineCategory]
    var glass = false
    let onAll: () -> Void
    let onSelect: (MedicineCategory) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(icon: "square.grid.2x2", emoji: nil, title: "Все товары", tint: Theme.brandPrimary, action: onAll)
                ForEach(categories) { category in
                    chip(icon: nil, emoji: category.icon, title: category.name, tint: category.accentColor) {
                        onSelect(category)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func chip(icon: String?, emoji: String?, title: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon = icon {
                    Image(systemName: icon).foregroundColor(tint)
                } else if let emoji = emoji {
                    Text(emoji)
                }
                Text(title)
                    .foregroundColor(Theme.textPrimary)
            }
            .font(.system(size: 14, weight: .medium))
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background {
                if glass {
                    GlassCapsule(tint: nil)
                } else {
                    Capsule().fill(Theme.surfaceCard)
                    Capsule().stroke(Theme.border, lineWidth: 1)
                }
            }
        }
        .buttonStyle(PressDimButtonStyle())
    }
}

/// 4 columns × up to 2 rows of soft-coloured tiles.
struct CategoryTilesGrid: View {
    let categories: [MedicineCategory]
    let onSelect: (MedicineCategory) -> Void

    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4), spacing: 12) {
            ForEach(categories.prefix(8)) { category in
                Button { onSelect(category) } label: {
                    VStack(spacing: 6) {
                        Text(category.icon ?? "💊")
                            .font(.system(size: 26))
                            .frame(maxWidth: .infinity)
                            .frame(height: 62)
                            .background(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(category.accentColor.opacity(0.13))
                            )
                        Text(category.name)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(Theme.textPrimary)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .frame(height: 28, alignment: .top)
                    }
                }
                .buttonStyle(PressDimButtonStyle())
            }
        }
        .padding(.horizontal, 16)
    }
}

/// Round category icons with a coloured ring, like stories.
struct CategoryCirclesRow: View {
    let categories: [MedicineCategory]
    let onSelect: (MedicineCategory) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(categories) { category in
                    Button { onSelect(category) } label: {
                        VStack(spacing: 6) {
                            Text(category.icon ?? "💊")
                                .font(.system(size: 28))
                                .frame(width: 64, height: 64)
                                .background(Circle().fill(Theme.surfaceCard))
                                .overlay(Circle().stroke(category.accentColor, lineWidth: 2.5).padding(-4))
                                .padding(4)
                            Text(category.name)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(Theme.textPrimary)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                                .frame(width: 76)
                        }
                    }
                    .buttonStyle(PressDimButtonStyle())
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 4)
        }
    }
}

// MARK: - Benefits and section headers

/// The three approved service facts (UI spec §8.1).
struct BenefitsRow: View {
    var glass = false

    private let items: [(icon: String, title: String)] = [
        ("checkmark.seal", "Актуальное наличие"),
        ("person.crop.circle.badge.checkmark", "Заказ без регистрации"),
        ("banknote", "Оплата при получении"),
    ]

    var body: some View {
        HStack(spacing: 8) {
            ForEach(items, id: \.title) { item in
                VStack(spacing: 6) {
                    Image(systemName: item.icon)
                        .font(.system(size: 20))
                        .foregroundColor(Theme.brandPrimary)
                    Text(item.title)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(Theme.textPrimary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .frame(maxWidth: .infinity, minHeight: 72)
                .padding(.horizontal, 4)
                .background {
                    if glass {
                        GlassCardBackground(cornerRadius: 16)
                    } else {
                        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surfaceCard)
                    }
                }
            }
        }
        .padding(.horizontal, 16)
    }
}

struct SectionHeader: View {
    let title: String
    var actionTitle: String? = "Все"
    var action: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Theme.textPrimary)
                .lineLimit(1)
            Spacer()
            if let action = action, let actionTitle = actionTitle {
                Button(action: action) {
                    HStack(spacing: 2) {
                        Text(actionTitle)
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
                    }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(Theme.brandPrimary)
                    .frame(minHeight: 44)
                }
            }
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - «Как на сайте» (mirrors src/app/page.tsx on phones)

/// Website phone layout shows only the `mobile` banner slot, at the image's own aspect ratio.
/// When no mobile banner is configured, the app falls back to a carousel of the other slots.
struct WebsiteHeroBanner: View {
    let banners: [HomeBanner]
    var isDemo = false
    let onTap: (HomeBanner) -> Void

    var body: some View {
        if let mobile = banners.first(where: { $0.slot == "mobile" }) {
            Button { onTap(mobile) } label: {
                WebsiteBannerImage(banner: mobile)
            }
            .buttonStyle(PressDimButtonStyle())
            .padding(.horizontal, 16)
        } else if !banners.isEmpty {
            BannerCarousel(banners: banners, look: .rounded, height: 170, isDemo: isDemo, onTap: onTap)
        }
    }
}

/// Banner image shown whole (designed artwork usually contains its own text).
private struct WebsiteBannerImage: View {
    let banner: HomeBanner

    var body: some View {
        Group {
            if let url = banner.secureImageURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: banner.fitMode == "contain" ? .fit : .fill)
                    case .failure:
                        BannerCard(banner: banner, cornerRadius: 0)
                    default:
                        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .aspectRatio(banner.imageAspectRatio ?? 16.0 / 9.0, contentMode: .fit)
                .frame(maxWidth: .infinity)
                .background(banner.containBackgroundColor.flatMap(Color.init(hexString:)) ?? Theme.surfaceMuted)
                .overlay(alignment: .bottomLeading) {
                    if let title = banner.title, !title.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(title).font(.system(size: 20, weight: .bold))
                            if let subtitle = banner.subtitle, !subtitle.isEmpty {
                                Text(subtitle).font(.system(size: 14))
                            }
                        }
                        .foregroundColor(banner.foreground)
                        .padding(16)
                    }
                }
            } else {
                BannerCard(banner: banner, cornerRadius: 0)
                    .frame(height: 170)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityLabel(banner.altText ?? banner.title ?? "Баннер")
    }
}

/// The three benefit cards from src/components/StoreBenefits.tsx, same copy.
struct WebsiteBenefits: View {
    private let items: [(icon: String, title: String, text: String)] = [
        ("cross.case.fill", "Более 11 000 лекарств", "Один из крупнейших актуальных ассортиментов лекарств в Душанбе."),
        ("drop.fill", "БАДы и дермокосметика", "Один из самых больших ассортиментов БАДов и дермокосметики в Душанбе."),
        ("tag.fill", "Выгодные цены", "Хорошие цены на лекарства и товары для здоровья без лишней переплаты."),
    ]

    var body: some View {
        VStack(spacing: 10) {
            ForEach(items, id: \.title) { item in
                HStack(alignment: .top, spacing: 14) {
                    Image(systemName: item.icon)
                        .font(.system(size: 20))
                        .foregroundColor(Theme.brandPrimary)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(Theme.brandSoft))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.title)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundColor(Theme.textPrimary)
                        Text(item.text)
                            .font(.system(size: 14))
                            .foregroundColor(Theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.surfaceCard))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Theme.mediaBorder, lineWidth: 1))
            }
        }
        .padding(.horizontal, 16)
    }
}

/// Website category cards: centred icon in the category colour and the name.
struct WebsiteCategoryGrid: View {
    let categories: [MedicineCategory]
    let onSelect: (MedicineCategory) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
            ForEach(categories) { category in
                Button { onSelect(category) } label: {
                    VStack(spacing: 8) {
                        Text(category.icon ?? "💊")
                            .font(.system(size: 32))
                        Text(category.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(Theme.textPrimary)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 104)
                    .padding(.horizontal, 8)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.surfaceCard))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color(hex: 0xEEEEEE), lineWidth: 1))
                }
                .buttonStyle(PressDimButtonStyle())
            }
        }
        .padding(.horizontal, 16)
    }
}
