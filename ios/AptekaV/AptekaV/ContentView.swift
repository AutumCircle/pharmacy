//
//  ContentView.swift
//  AptekaV
//
//  Created by Developer on 12/10/26.
//

import SwiftUI
import UIKit

// MARK: - Tabs

enum AppTab: Int, CaseIterable, Identifiable {
    case home, catalog, cart, favorites, profile

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .home: return "Главная"
        case .catalog: return "Каталог"
        case .cart: return "Корзина"
        case .favorites: return "Избранное"
        case .profile: return "Профиль"
        }
    }

    var icon: String {
        switch self {
        case .home: return "house"
        case .catalog: return "square.grid.2x2"
        case .cart: return "cart"
        case .favorites: return "heart"
        case .profile: return "person"
        }
    }

    var selectedIcon: String { icon + ".fill" }
}

extension Color {
    /// Фирменный красный «Ватан» (#E31E24), тот же, что на сайте.
    static let vatanRed = Color(red: 227 / 255, green: 30 / 255, blue: 36 / 255)
}

// MARK: - Root

struct ContentView: View {
    @State private var selection: AppTab = .home
    @State private var cartCount = 3

    var body: some View {
        ZStack(alignment: .bottom) {
            TabScreen(tab: selection, onAddToCart: { cartCount += 1 })

            LiquidGlassTabBar(selection: $selection, cartCount: cartCount)
                .padding(.horizontal, 14)
                .padding(.bottom, 2)
        }
    }
}

// MARK: - Liquid Glass tab bar
//
// Настоящий Liquid Glass (`.glassEffect`) появился только в iOS 26 / Xcode 26.
// Для Xcode 14.3 и iOS 16 стекло собирается из `.ultraThinMaterial`, блика и тонкой светлой кромки.

struct LiquidGlassTabBar: View {
    @Binding var selection: AppTab
    var cartCount: Int

    @Namespace private var selectionNamespace

    var body: some View {
        HStack(spacing: 0) {
            ForEach(AppTab.allCases) { tab in
                Button {
                    guard selection != tab else { return }
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    withAnimation(.spring(response: 0.38, dampingFraction: 0.72)) {
                        selection = tab
                    }
                } label: {
                    TabBarItem(
                        tab: tab,
                        isSelected: selection == tab,
                        badge: tab == .cart ? cartCount : 0
                    )
                    .background {
                        if selection == tab {
                            SelectionDrop()
                                .matchedGeometryEffect(id: "selection", in: selectionNamespace)
                        }
                    }
                }
                .buttonStyle(PressScaleButtonStyle())
                .accessibilityLabel(tab.title)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
            }
        }
        .padding(5)
        .background { GlassCapsule() }
    }
}

private struct TabBarItem: View {
    let tab: AppTab
    let isSelected: Bool
    let badge: Int

    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: isSelected ? tab.selectedIcon : tab.icon)
                .font(.system(size: 19, weight: .semibold))
                .frame(height: 24)
                .overlay(alignment: .topTrailing) {
                    if badge > 0 {
                        Text("\(badge)")
                            .font(.system(size: 11, weight: .bold))
                            .monospacedDigit()
                            .foregroundColor(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Capsule().fill(Color.vatanRed))
                            .offset(x: 12, y: -6)
                    }
                }

            Text(tab.title)
                .font(.system(size: 10, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundColor(isSelected ? .vatanRed : .primary)
        .frame(maxWidth: .infinity, minHeight: 54)
        .contentShape(Capsule())
    }
}

/// «Капля» под выбранной вкладкой. Переезжает между вкладками через matchedGeometryEffect.
private struct SelectionDrop: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Capsule(style: .continuous)
            .fill(Color.vatanRed.opacity(colorScheme == .dark ? 0.22 : 0.12))
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(Color.white.opacity(colorScheme == .dark ? 0.18 : 0.6), lineWidth: 0.5)
            )
    }
}

/// Стеклянная капсула: размытие + блик сверху + светлая кромка + мягкая тень.
private struct GlassCapsule: View {
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
                                Color.white.opacity(isDark ? 0.02 : 0.08)
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
                                Color.white.opacity(isDark ? 0.15 : 0.45)
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

private struct PressScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.65), value: configuration.isPressed)
    }
}

// MARK: - Sample screens (примеры, позже заменим данными из API)

private struct SampleProduct: Identifiable {
    let id = UUID()
    let name: String
    let detail: String
    let price: Int
    let tint: Color
}

private let sampleProducts: [SampleProduct] = [
    SampleProduct(name: "Парацетамол 500 мг", detail: "Таблетки, 20 шт.", price: 9, tint: .red),
    SampleProduct(name: "Ибупрофен 200 мг", detail: "Таблетки, 50 шт.", price: 18, tint: .blue),
    SampleProduct(name: "Витамин C 1000 мг", detail: "Шипучие таблетки, 20 шт.", price: 34, tint: .orange),
    SampleProduct(name: "Називин 0,05%", detail: "Спрей назальный, 10 мл", price: 41, tint: .teal),
    SampleProduct(name: "Смекта", detail: "Порошок, 10 пакетов", price: 52, tint: .green),
    SampleProduct(name: "Лоратадин 10 мг", detail: "Таблетки, 10 шт.", price: 12, tint: .purple),
    SampleProduct(name: "Хлоргексидин 0,05%", detail: "Раствор, 100 мл", price: 7, tint: .cyan),
    SampleProduct(name: "Омега-3", detail: "Капсулы, 60 шт.", price: 96, tint: .indigo)
]

private struct TabScreen: View {
    let tab: AppTab
    var onAddToCart: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    switch tab {
                    case .home:
                        PromoCard()
                        Text("Популярное").font(.title2.bold())
                        ProductGrid(products: sampleProducts, onAdd: onAddToCart)
                    case .catalog:
                        ProductGrid(products: Array(sampleProducts.reversed()), onAdd: onAddToCart)
                    case .cart:
                        ProductGrid(products: Array(sampleProducts.prefix(4)), onAdd: onAddToCart)
                        Text("Стоимость доставки рассчитывается и оплачивается напрямую курьеру при доставке.")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    case .profile:
                        ProfileContent()
                        Text("Заказать снова").font(.title2.bold())
                        ProductGrid(products: Array(sampleProducts.prefix(4)), onAdd: onAddToCart)
                    case .favorites:
                        ProductGrid(products: [2, 3, 7, 5, 1, 6].map { sampleProducts[$0] }, onAdd: onAddToCart)
                    }
                }
                .padding(.horizontal, 16)
                // Место под плавающую панель, чтобы последний ряд не прятался под стеклом.
                .padding(.bottom, 100)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(tab == .home ? "Аптека «Ватан»" : tab.title)
        }
    }
}

private struct ProfileContent: View {
    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 14) {
                Text("М")
                    .font(.title2.bold())
                    .foregroundColor(.white)
                    .frame(width: 56, height: 56)
                    .background(
                        Circle().fill(
                            LinearGradient(
                                colors: [Color(red: 1, green: 0.42, blue: 0.36), .vatanRed],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text("Мадина").font(.headline)
                    Text("+992 90 123 45 67")
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundColor(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundColor(.secondary)
            }
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color(.secondarySystemGroupedBackground))
            )

            ProfileSection(rows: [
                ProfileRow(icon: "shippingbox.fill", tint: .red, title: "Мои заказы", subtitle: "Заказ № 1042 · 61 TJS", trailing: "Подтверждён"),
                ProfileRow(icon: "heart.fill", tint: .orange, title: "Избранное", subtitle: "6 товаров", trailing: nil),
                ProfileRow(icon: "mappin.and.ellipse", tint: .blue, title: "Адреса доставки", subtitle: "ул. Рудаки, 45", trailing: nil)
            ])

            ProfileSection(rows: [
                ProfileRow(icon: "bell.fill", tint: .green, title: "Уведомления", subtitle: "Статус заказа", trailing: nil),
                ProfileRow(icon: "globe", tint: .purple, title: "Язык", subtitle: nil, trailing: "Русский"),
                ProfileRow(icon: "phone.fill", tint: .teal, title: "Связаться с аптекой", subtitle: "Телефон и адреса", trailing: nil)
            ])

            Text("Заказы находятся по номеру телефона, регистрация не нужна.")
                .font(.footnote)
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ProfileRow: Identifiable {
    let id = UUID()
    let icon: String
    let tint: Color
    let title: String
    let subtitle: String?
    let trailing: String?
}

private struct ProfileSection: View {
    let rows: [ProfileRow]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(rows) { row in
                HStack(spacing: 12) {
                    Image(systemName: row.icon)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 32, height: 32)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(row.tint))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title)
                        if let subtitle = row.subtitle {
                            Text(subtitle).font(.footnote).foregroundColor(.secondary)
                        }
                    }
                    Spacer()
                    if let trailing = row.trailing {
                        Text(trailing).font(.subheadline).foregroundColor(.secondary)
                    }
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundColor(Color(.tertiaryLabel))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)

                if row.id != rows.last?.id {
                    Divider().padding(.leading, 58)
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }
}

private struct PromoCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Заказ от 50 TJS").font(.title3.bold())
            Text("Оплата за лекарства при получении. Регистрация не нужна.")
                .font(.subheadline)
                .opacity(0.9)
        }
        .foregroundColor(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(
                colors: [Color(red: 1, green: 0.42, blue: 0.36), .vatanRed, Color(red: 0.64, green: 0.07, blue: 0.1)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct ProductGrid: View {
    let products: [SampleProduct]
    var onAdd: () -> Void

    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 12) {
            ForEach(products) { product in
                ProductCard(product: product, onAdd: onAdd)
            }
        }
    }
}

private struct ProductCard: View {
    let product: SampleProduct
    var onAdd: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(product.tint.opacity(0.18))
                .frame(height: 110)
                .overlay(
                    Image(systemName: "pills")
                        .font(.system(size: 30))
                        .foregroundColor(product.tint)
                )

            Text(product.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            Text(product.detail)
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(1)

            HStack {
                Text("\(product.price) TJS")
                    .font(.headline)
                    .monospacedDigit()
                Spacer()
                Button(action: onAdd) {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(Color.vatanRed))
                }
                .accessibilityLabel("В корзину")
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(.secondarySystemGroupedBackground))
        )
    }
}

// MARK: - Previews

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        Group {
            ContentView()
                .previewDisplayName("Светлая")
            ContentView()
                .preferredColorScheme(.dark)
                .previewDisplayName("Тёмная")
        }
    }
}
