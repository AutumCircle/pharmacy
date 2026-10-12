import SwiftUI
import UIKit

// Bottom navigation bar options for review. Every style takes the same selection binding and
// cart count, so the chosen one can replace the others without touching the screens.

/// Tab bar design options under review. Once the owner picks one, the others can be removed.
enum TabBarStyle: Int, CaseIterable, Identifiable {
    case classic = 1
    case liquidGlass
    case pill
    case centerCart
    case indicator
    case bubble
    case glassDrop

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .classic: return "Классика"
        case .liquidGlass: return "Liquid Glass (iOS 26)"
        case .pill: return "Пилюля"
        case .centerCart: return "Корзина в центре"
        case .indicator: return "Линия-индикатор"
        case .bubble: return "Пузырь"
        case .glassDrop: return "Стекло · капля (youthful-ramanujan)"
        }
    }

    var summary: String {
        switch self {
        case .classic:
            return "Стандартная панель iOS на всю ширину: иконки с подписями, активная вкладка красная"
        case .liquidGlass:
            return "Плавающая стеклянная капсула со стеклянной «линзой» под активной вкладкой, корзина — отдельная стеклянная кнопка, как в iOS 26 (имитация для iOS 16)"
        case .pill:
            return "Тёмная плавающая панель: активная вкладка раскрывается в красную капсулу с подписью"
        case .centerCart:
            return "Белая панель с выпуклой красной кнопкой корзины по центру"
        case .indicator:
            return "Плоская панель: красная полоска переезжает над активной вкладкой"
        case .bubble:
            return "Иконка активной вкладки поднимается в красный круг над панелью"
        case .glassDrop:
            return "Вариант из ветки claude/youthful-ramanujan-l3ur5f: стеклянная капсула с красной «каплей» под активной вкладкой"
        }
    }

    /// Glass styles need a colourful backdrop to read as glass.
    var isGlass: Bool {
        self == .liquidGlass || self == .glassDrop
    }
}

/// Bottom navigation bar. Place it with `.safeAreaInset(edge: .bottom)` so scroll content
/// gets the right inset and still scrolls behind floating styles.
struct AppTabBar: View {
    let style: TabBarStyle
    @Binding var selection: AppTab
    let cartCount: Int

    var body: some View {
        switch style {
        case .classic:
            ClassicTabBar(selection: $selection, cartCount: cartCount)
        case .liquidGlass:
            LiquidGlassTabBar(selection: $selection, cartCount: cartCount)
        case .pill:
            PillTabBar(selection: $selection, cartCount: cartCount)
        case .centerCart:
            CenterCartTabBar(selection: $selection, cartCount: cartCount)
        case .indicator:
            IndicatorTabBar(selection: $selection, cartCount: cartCount)
        case .bubble:
            BubbleTabBar(selection: $selection, cartCount: cartCount)
        case .glassDrop:
            GlassDropTabBar(selection: $selection, cartCount: cartCount)
        }
    }
}

// MARK: - Shared pieces

private extension Binding where Value == AppTab {
    /// Switches tab with a light haptic and a spring, ignoring taps on the current tab.
    func select(_ tab: AppTab) {
        guard wrappedValue != tab else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.spring(response: 0.38, dampingFraction: 0.75)) {
            wrappedValue = tab
        }
    }
}

/// Cart counter. Inverted colours are used when the icon sits on a red background.
private struct TabBadge: View {
    let count: Int
    var inverted = false

    var body: some View {
        if count > 0 {
            Text(count > 99 ? "99+" : "\(count)")
                .font(.system(size: 11, weight: .bold))
                .monospacedDigit()
                .foregroundColor(inverted ? Theme.brandPrimary : .white)
                .padding(.horizontal, 5)
                .frame(minWidth: 18, minHeight: 18)
                .background(Capsule().fill(inverted ? Color.white : Theme.brandPrimary))
                .overlay(Capsule().stroke(Color.white, lineWidth: inverted ? 0 : 1.5))
                .fixedSize()
                .offset(x: 12, y: -7)
                .accessibilityHidden(true)
        }
    }
}

/// Tab icon with an optional cart badge.
private struct TabIcon: View {
    let tab: AppTab
    let isSelected: Bool
    var cartCount = 0
    var size: CGFloat = 20
    var invertedBadge = false

    var body: some View {
        Image(systemName: tab.icon(selected: isSelected))
            .font(.system(size: size, weight: .semibold))
            .frame(height: size + 4)
            .overlay(alignment: .topTrailing) {
                if tab == .cart {
                    TabBadge(count: cartCount, inverted: invertedBadge)
                }
            }
    }
}

private struct TabButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.65), value: configuration.isPressed)
    }
}

private extension View {
    /// VoiceOver: tab name, selected trait and cart count.
    func tabAccessibility(_ tab: AppTab, isSelected: Bool, cartCount: Int) -> some View {
        accessibilityElement(children: .ignore)
            .accessibilityLabel(tab.title)
            .accessibilityValue(tab == .cart && cartCount > 0 ? "\(cartCount) товаров" : "")
            .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - 1. Classic

struct ClassicTabBar: View {
    @Binding var selection: AppTab
    let cartCount: Int

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                let isSelected = selection == tab
                Button { $selection.select(tab) } label: {
                    VStack(spacing: 3) {
                        TabIcon(tab: tab, isSelected: isSelected, cartCount: cartCount)
                        Text(tab.title)
                            .font(.system(size: 10, weight: .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundColor(isSelected ? Theme.brandPrimary : Theme.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: 49)
                    .contentShape(Rectangle())
                }
                .buttonStyle(TabButtonStyle())
                .tabAccessibility(tab, isSelected: isSelected, cartCount: cartCount)
            }
        }
        .padding(.top, 4)
        .background(
            Rectangle()
                .fill(.regularMaterial)
                .overlay(Theme.surfaceCard.opacity(0.6))
                .ignoresSafeArea(edges: .bottom)
        )
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.border).frame(height: 0.5)
        }
    }
}

// MARK: - 2. Liquid Glass (iOS 26)
//
// Real Liquid Glass (`.glassEffect`) needs the iOS 26 SDK. With Xcode 14.3 / iOS 16 the glass
// is built from `.ultraThinMaterial`, a specular highlight and a light rim.

struct LiquidGlassTabBar: View {
    @Binding var selection: AppTab
    let cartCount: Int

    @Namespace private var lens
    private let mainTabs: [AppTab] = [.home, .catalog, .favorites, .profile]

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 0) {
                ForEach(mainTabs) { tab in
                    let isSelected = selection == tab
                    Button { $selection.select(tab) } label: {
                        VStack(spacing: 2) {
                            TabIcon(tab: tab, isSelected: isSelected, size: 19)
                            Text(tab.title)
                                .font(.system(size: 10, weight: .semibold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.75)
                        }
                        .foregroundColor(isSelected ? Theme.brandPrimary : Theme.textPrimary)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background {
                            if isSelected {
                                GlassLens()
                                    .matchedGeometryEffect(id: "lens", in: lens)
                            }
                        }
                        .contentShape(Capsule())
                    }
                    .buttonStyle(TabButtonStyle())
                    .tabAccessibility(tab, isSelected: isSelected, cartCount: cartCount)
                }
            }
            .padding(5)
            .background(LiquidGlassSurface(shape: Capsule(style: .continuous)))

            cartButton
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    /// Cart sits apart like the search tab in iOS 26; it turns red when active.
    private var cartButton: some View {
        let isSelected = selection == .cart
        return Button { $selection.select(.cart) } label: {
            TabIcon(tab: .cart, isSelected: isSelected, cartCount: cartCount, size: 21, invertedBadge: isSelected)
                .foregroundColor(isSelected ? .white : Theme.textPrimary)
                .frame(width: 62, height: 62)
                .background {
                    if isSelected {
                        GlassCapsule(tint: Theme.brandPrimary)
                            .shadow(color: Theme.brandPrimary.opacity(0.35), radius: 14, x: 0, y: 8)
                    } else {
                        LiquidGlassSurface(shape: Circle())
                    }
                }
                .contentShape(Circle())
        }
        .buttonStyle(TabButtonStyle())
        .tabAccessibility(.cart, isSelected: isSelected, cartCount: cartCount)
    }
}

/// Frosted glass surface with highlight, rim and a soft floating shadow.
private struct LiquidGlassSurface<S: Shape>: View {
    let shape: S
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let isDark = colorScheme == .dark
        shape
            .fill(.ultraThinMaterial)
            .overlay(shape.fill(GlassStyle.highlight).opacity(isDark ? 0.25 : 0.7))
            .overlay(shape.stroke(GlassStyle.rim, lineWidth: 1).opacity(isDark ? 0.5 : 1))
            .shadow(color: Color.black.opacity(isDark ? 0.45 : 0.12), radius: 20, x: 0, y: 10)
    }
}

/// Clear, brighter glass "lens" that slides under the active tab.
private struct GlassLens: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let isDark = colorScheme == .dark
        Capsule(style: .continuous)
            .fill(Color.white.opacity(isDark ? 0.14 : 0.55))
            .overlay(
                Capsule(style: .continuous)
                    .stroke(Color.white.opacity(isDark ? 0.25 : 0.9), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 6, x: 0, y: 3)
    }
}

// MARK: - 3. Pill

struct PillTabBar: View {
    @Binding var selection: AppTab
    let cartCount: Int

    @Namespace private var pill

    var body: some View {
        HStack(spacing: 4) {
            ForEach(AppTab.allCases) { tab in
                let isSelected = selection == tab
                Button { $selection.select(tab) } label: {
                    HStack(spacing: 6) {
                        TabIcon(tab: tab, isSelected: isSelected, cartCount: cartCount, size: 18, invertedBadge: true)
                        if isSelected {
                            Text(tab.title)
                                .font(.system(size: 13, weight: .semibold))
                                .lineLimit(1)
                                .fixedSize()
                                .transition(.opacity.combined(with: .scale(scale: 0.8, anchor: .leading)))
                        }
                    }
                    .foregroundColor(isSelected ? .white : Color.white.opacity(0.65))
                    .padding(.horizontal, isSelected ? 16 : 0)
                    .frame(maxWidth: isSelected ? nil : .infinity, minHeight: 48)
                    .background {
                        if isSelected {
                            Capsule(style: .continuous)
                                .fill(Theme.brandPrimary)
                                .matchedGeometryEffect(id: "pill", in: pill)
                        }
                    }
                    .contentShape(Capsule())
                }
                .buttonStyle(TabButtonStyle())
                .tabAccessibility(tab, isSelected: isSelected, cartCount: cartCount)
            }
        }
        .padding(6)
        .background(
            Capsule(style: .continuous)
                .fill(Color(hex: 0x1C1D20))
                .shadow(color: Color.black.opacity(0.25), radius: 18, x: 0, y: 10)
        )
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }
}

// MARK: - 4. Center cart

struct CenterCartTabBar: View {
    @Binding var selection: AppTab
    let cartCount: Int

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                if tab == .cart {
                    cartButton
                } else {
                    let isSelected = selection == tab
                    Button { $selection.select(tab) } label: {
                        VStack(spacing: 3) {
                            TabIcon(tab: tab, isSelected: isSelected)
                            Text(tab.title)
                                .font(.system(size: 10, weight: .medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                        }
                        .foregroundColor(isSelected ? Theme.brandPrimary : Theme.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 49)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(TabButtonStyle())
                    .tabAccessibility(tab, isSelected: isSelected, cartCount: cartCount)
                }
            }
        }
        .padding(.top, 4)
        .background(
            Theme.surfaceCard
                .shadow(color: Color.black.opacity(0.08), radius: 12, x: 0, y: -4)
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private var cartButton: some View {
        let isSelected = selection == .cart
        return Button { $selection.select(.cart) } label: {
            VStack(spacing: 3) {
                TabIcon(tab: .cart, isSelected: true, cartCount: cartCount, size: 22, invertedBadge: true)
                    .foregroundColor(.white)
                    .frame(width: 60, height: 60)
                    .background(
                        Circle()
                            .fill(isSelected ? Theme.brandPrimaryPressed : Theme.brandPrimary)
                            .shadow(color: Theme.brandPrimary.opacity(0.4), radius: 10, x: 0, y: 6)
                    )
                    .overlay(Circle().stroke(Theme.surfaceCard, lineWidth: 4))
                Text(AppTab.cart.title)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(isSelected ? Theme.brandPrimary : Theme.textSecondary)
            }
            .offset(y: -5)
            .padding(.top, -26)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(TabButtonStyle())
        .tabAccessibility(.cart, isSelected: isSelected, cartCount: cartCount)
    }
}

// MARK: - 5. Indicator line

struct IndicatorTabBar: View {
    @Binding var selection: AppTab
    let cartCount: Int

    @Namespace private var indicator

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                let isSelected = selection == tab
                Button { $selection.select(tab) } label: {
                    VStack(spacing: 4) {
                        ZStack {
                            if isSelected {
                                Capsule()
                                    .fill(Theme.brandPrimary)
                                    .frame(width: 28, height: 3)
                                    .matchedGeometryEffect(id: "indicator", in: indicator)
                            }
                        }
                        .frame(height: 3)
                        .padding(.bottom, 4)

                        TabIcon(tab: tab, isSelected: isSelected, cartCount: cartCount)
                        Text(tab.title)
                            .font(.system(size: 10, weight: isSelected ? .bold : .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundColor(isSelected ? Theme.textPrimary : Theme.textSecondary.opacity(0.8))
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .top)
                    .contentShape(Rectangle())
                }
                .buttonStyle(TabButtonStyle())
                .tabAccessibility(tab, isSelected: isSelected, cartCount: cartCount)
            }
        }
        .padding(.bottom, 2)
        .background(Theme.surfaceCard.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .top) {
            Rectangle().fill(Theme.border).frame(height: 0.5)
        }
    }
}

// MARK: - 6. Bubble

struct BubbleTabBar: View {
    @Binding var selection: AppTab
    let cartCount: Int

    @Namespace private var bubble

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                let isSelected = selection == tab
                Button { $selection.select(tab) } label: {
                    VStack(spacing: 4) {
                        TabIcon(tab: tab, isSelected: isSelected, cartCount: cartCount, invertedBadge: isSelected)
                            .foregroundColor(isSelected ? .white : Theme.textSecondary)
                            // The active circle is taller than the bar and rises above its top edge.
                            .frame(width: 52, height: isSelected ? 52 : 28)
                            .background {
                                if isSelected {
                                    Circle()
                                        .fill(Theme.brandPrimary)
                                        .overlay(Circle().stroke(Theme.surfaceCard, lineWidth: 5))
                                        .shadow(color: Theme.brandPrimary.opacity(0.35), radius: 8, x: 0, y: 5)
                                        .matchedGeometryEffect(id: "bubble", in: bubble)
                                }
                            }

                        Text(tab.title)
                            .font(.system(size: 10, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                            .foregroundColor(isSelected ? Theme.brandPrimary : Theme.textSecondary)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(TabButtonStyle())
                .tabAccessibility(tab, isSelected: isSelected, cartCount: cartCount)
            }
        }
        .frame(height: 50, alignment: .bottom)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .background(
            UnevenTopRoundedRectangle(radius: 24)
                .fill(Theme.surfaceCard)
                .shadow(color: Color.black.opacity(0.08), radius: 14, x: 0, y: -4)
                .ignoresSafeArea(edges: .bottom)
        )
    }
}

/// Rectangle with only the top corners rounded (`UnevenRoundedRectangle` is iOS 17+).
private struct UnevenTopRoundedRectangle: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        Path(
            UIBezierPath(
                roundedRect: rect,
                byRoundingCorners: [.topLeft, .topRight],
                cornerRadii: CGSize(width: radius, height: radius)
            ).cgPath
        )
    }
}

// MARK: - 7. Glass drop (branch claude/youthful-ramanujan-l3ur5f)
//
// Ported from that branch's ContentView: glass capsule with a red-tinted "drop" under the
// active tab. Visuals unchanged; colours now come from Theme.

struct GlassDropTabBar: View {
    @Binding var selection: AppTab
    let cartCount: Int

    @Namespace private var selectionNamespace

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                let isSelected = selection == tab
                Button { $selection.select(tab) } label: {
                    VStack(spacing: 3) {
                        TabIcon(tab: tab, isSelected: isSelected, cartCount: cartCount, size: 19)
                        Text(tab.title)
                            .font(.system(size: 10, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundColor(isSelected ? Theme.brandPrimary : .primary)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .contentShape(Capsule())
                    .background {
                        if isSelected {
                            SelectionDrop()
                                .matchedGeometryEffect(id: "selection", in: selectionNamespace)
                        }
                    }
                }
                .buttonStyle(TabButtonStyle())
                .tabAccessibility(tab, isSelected: isSelected, cartCount: cartCount)
            }
        }
        .padding(5)
        .background { DropGlassCapsule() }
        .padding(.horizontal, 14)
        .padding(.bottom, 2)
    }
}

/// Red-tinted "drop" under the active tab.
private struct SelectionDrop: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Capsule(style: .continuous)
            .fill(Theme.brandPrimary.opacity(colorScheme == .dark ? 0.22 : 0.12))
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.18 : 0.6), lineWidth: 0.5)
            )
    }
}

/// Glass capsule: blur + top highlight + light rim + soft shadow.
private struct DropGlassCapsule: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        let isDark = colorScheme == .dark
        Capsule(style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay(
                Capsule(style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(isDark ? 0.10 : 0.40),
                                Color.white.opacity(isDark ? 0.02 : 0.08),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            )
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(isDark ? 0.35 : 0.85),
                                Color.white.opacity(isDark ? 0.05 : 0.20),
                                Color.white.opacity(isDark ? 0.15 : 0.45),
                            ],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: 1
                    )
            )
            .shadow(color: Color.black.opacity(isDark ? 0.45 : 0.14), radius: 18, x: 0, y: 10)
    }
}
