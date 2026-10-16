import SwiftUI

/// Home screen layout options under review.
enum HomeLayoutStyle: Int, CaseIterable, Identifiable {
    case classic = 1
    case showcase
    case compact
    case glass
    case website
    case compactGlass

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .classic: return "Классика"
        case .showcase: return "Витрина"
        case .compact: return "Компакт"
        case .glass: return "Стекло"
        case .website: return "Как на сайте"
        case .compactGlass: return "Компакт · Стекло"
        }
    }

    var summary: String {
        switch self {
        case .classic:
            return "Баннер-карусель на всю ширину, категории-чипсы, преимущества, ряды товаров"
        case .showcase:
            return "Большой баннер от края до края, плитки категорий 4×2, ряды товаров"
        case .compact:
            return "Баннеры-карточки с краем следующего, круглые категории как «истории»"
        case .glass:
            return "Liquid Glass: стеклянные баннер, категории и секции на цветном фоне"
        case .website:
            return "Порядок и блоки как на aptekavatan.tj: мобильный баннер, карусели сайта, преимущества, категории"
        case .compactGlass:
            return "Вариант 3 в Liquid Glass: баннер в стеклянной рамке, стеклянные круги категорий и секции"
        }
    }

    var isGlass: Bool { self == .glass || self == .compactGlass }
}

/// Product page («окно товара») layout options under review.
enum ProductPageStyle: Int, CaseIterable, Identifiable {
    case classic = 1
    case hero
    case purchaseCard
    case glass
    case minimal

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .classic: return "Классика"
        case .hero: return "Фото сверху"
        case .purchaseCard: return "Блок покупки"
        case .glass: return "Стекло"
        case .minimal: return "Минимал"
        }
    }

    var summary: String {
        switch self {
        case .classic:
            return "Фото в рамке, название, цена, таблица; кнопка закреплена снизу"
        case .hero:
            return "Большое фото на всю ширину, белый лист с информацией наезжает на фото; снизу «Итого» и кнопка"
        case .purchaseCard:
            return "Как на сайте: отдельный блок покупки с ценой, количеством, «В корзину» и «В избранное»"
        case .glass:
            return "Liquid Glass: стеклянные блоки и плавающая стеклянная панель покупки"
        case .minimal:
            return "Всё по центру на сером фоне, крупная цена, круглые кнопки"
        }
    }

    var isGlass: Bool { self == .glass }
}

/// Design choices for navigation, search bar, card and home layout.
///
/// Debug builds: changed in the «Дизайн» panel, saved in UserDefaults, and can be forced
/// with launch arguments (`-homeStyle N -tabBarStyle N -searchBarStyle N -cardStyle N`).
/// Release builds: always the fixed `production` values; the panel does not exist.
@MainActor
final class DesignSettings: ObservableObject {
    struct Choice: Equatable {
        var home: HomeLayoutStyle
        var tabBar: TabBarStyle
        var searchBar: SearchBarStyle
        var card: MedicineCardStyle
        var productPage: ProductPageStyle
    }

    /// Final design for production. Update this when the owner makes the final choice.
    static let production = Choice(home: .website, tabBar: .liquidGlass, searchBar: .floating, card: .glassMinimalFramed, productPage: .hero)

    @Published var home: HomeLayoutStyle { didSet { save(home.rawValue, Keys.home) } }
    @Published var tabBar: TabBarStyle { didSet { save(tabBar.rawValue, Keys.tabBar) } }
    @Published var searchBar: SearchBarStyle { didSet { save(searchBar.rawValue, Keys.searchBar) } }
    @Published var card: MedicineCardStyle { didSet { save(card.rawValue, Keys.card) } }
    @Published var productPage: ProductPageStyle { didSet { save(productPage.rawValue, Keys.productPage) } }

    private enum Keys {
        static let home = "design.home.v2" // v2: reset to «Как на сайте»
        static let tabBar = "design.tabBar"
        static let searchBar = "design.searchBar"
        static let card = "design.card"
        static let productPage = "design.productPage"
    }

    init() {
        let fallback = Self.production
        #if DEBUG
        let defaults = UserDefaults.standard
        // Launch arguments win over saved choices (simulator screenshots).
        func value(_ argument: String, _ key: String) -> Int {
            let forced = defaults.integer(forKey: argument)
            return forced != 0 ? forced : defaults.integer(forKey: key)
        }
        home = HomeLayoutStyle(rawValue: value("homeStyle", Keys.home)) ?? fallback.home
        tabBar = TabBarStyle(rawValue: value("tabBarStyle", Keys.tabBar)) ?? fallback.tabBar
        searchBar = SearchBarStyle(rawValue: value("searchBarStyle", Keys.searchBar)) ?? fallback.searchBar
        card = MedicineCardStyle(rawValue: value("cardStyle", Keys.card)) ?? fallback.card
        productPage = ProductPageStyle(rawValue: value("productStyle", Keys.productPage)) ?? fallback.productPage
        #else
        home = fallback.home
        tabBar = fallback.tabBar
        searchBar = fallback.searchBar
        card = fallback.card
        productPage = fallback.productPage
        #endif
    }

    func resetToProduction() {
        let fallback = Self.production
        home = fallback.home
        tabBar = fallback.tabBar
        searchBar = fallback.searchBar
        card = fallback.card
        productPage = fallback.productPage
    }

    /// Glass elements need a colourful backdrop behind them to read as glass.
    var usesGlassBackdrop: Bool {
        home.isGlass || tabBar.isGlass || searchBar.isGlass || card.isGlass
    }

    /// Card style for full-width list rows (cart, search results with a grid card style).
    var rowCardStyle: MedicineCardStyle {
        card.isGlass ? .glassRow : .row
    }

    private func save(_ value: Int, _ key: String) {
        #if DEBUG
        UserDefaults.standard.set(value, forKey: key)
        #endif
    }
}

/// Page background that follows the design choice.
struct AppBackground: View {
    @EnvironmentObject private var design: DesignSettings

    var body: some View {
        if design.usesGlassBackdrop {
            GlassBackdrop()
        } else {
            Theme.surfacePage.ignoresSafeArea()
        }
    }
}
