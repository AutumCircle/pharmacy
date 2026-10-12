import SwiftUI

/// Bottom navigation tabs. «Мои заказы» is not a tab: orders are found by phone from the profile.
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

    func icon(selected: Bool) -> String {
        selected ? selectedIcon : icon
    }
}
