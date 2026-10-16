import SwiftUI

/// Screens pushed inside a tab's NavigationStack.
enum AppRoute: Hashable {
    case medicine(Medicine)
    case category(MedicineCategory)
    case checkout
    case orders
    case order(PublicOrder)
}

extension View {
    /// Registers the shared push destinations once per NavigationStack.
    func appRouteDestinations() -> some View {
        navigationDestination(for: AppRoute.self) { route in
            switch route {
            case .medicine(let medicine):
                MedicineDetailView(medicine: medicine)
                    .toolbarRole(.editor)
            case .category(let category):
                CategoryProductsView(category: category)
                    .toolbarRole(.editor)
            case .checkout:
                CheckoutView()
                    .toolbarRole(.editor)
            case .orders:
                OrdersView()
                    .toolbarRole(.editor)
            case .order(let order):
                OrderDetailView(order: order)
                    .toolbarRole(.editor)
            }
        }
    }
}

/// Pushes a route onto the current tab's NavigationStack. Each tab root injects it, so nested
/// screens can open products and categories without `navigationDestination(item:)` (iOS 17).
private struct OpenRouteKey: EnvironmentKey {
    static let defaultValue: (AppRoute) -> Void = { _ in }
}

extension EnvironmentValues {
    var openRoute: (AppRoute) -> Void {
        get { self[OpenRouteKey.self] }
        set { self[OpenRouteKey.self] = newValue }
    }
}

/// NavigationStack with a path, shared destinations and `openRoute` wired up.
struct RoutedNavigationStack<Root: View>: View {
    @State private var path = NavigationPath()
    let root: Root

    init(@ViewBuilder root: () -> Root) {
        self.root = root()
    }

    var body: some View {
        NavigationStack(path: $path) {
            // `.editor`: back buttons show only the arrow, without the previous screen's title.
            root
                .toolbarRole(.editor)
                .appRouteDestinations()
        }
        .environment(\.openRoute) { path.append($0) }
        .environment(\.popToRoot) { path = NavigationPath() }
        .tint(Theme.brandPrimary)
    }
}

/// Switches the bottom tab (e.g. «Все товары» on the home screen opens «Каталог»).
private struct SelectTabKey: EnvironmentKey {
    static let defaultValue: (AppTab) -> Void = { _ in }
}

extension EnvironmentValues {
    var selectTab: (AppTab) -> Void {
        get { self[SelectTabKey.self] }
        set { self[SelectTabKey.self] = newValue }
    }
}

/// Set by screens with their own bottom purchase bar (product page) to hide the tab bar.
struct HidesTabBarKey: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) {
        value = value || nextValue()
    }
}

/// Returns the current tab to its first screen (e.g. after an order is placed).
private struct PopToRootKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    var popToRoot: () -> Void {
        get { self[PopToRootKey.self] }
        set { self[PopToRootKey.self] = newValue }
    }
}
