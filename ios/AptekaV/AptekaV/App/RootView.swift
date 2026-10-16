import SwiftUI

/// App shell: the five tabs with the bottom bar in the selected navigation style.
/// Each tab keeps its own NavigationStack (and back stack) while switching.
struct RootView: View {
    @EnvironmentObject private var design: DesignSettings
    @EnvironmentObject private var cart: CartStore
    @State private var selection: AppTab
    /// Tabs whose visible screen asked to hide the tab bar.
    @State private var tabsHidingBar: Set<AppTab> = []

    init() {
        #if DEBUG
        // Launch argument `-initialTab N` opens tab N (AppTab raw value) for simulator screenshots.
        _selection = State(initialValue: AppTab(rawValue: UserDefaults.standard.integer(forKey: "initialTab")) ?? .home)
        #else
        _selection = State(initialValue: .home)
        #endif
    }

    var body: some View {
        ZStack {
            // All tabs stay alive so scroll position and navigation survive tab switches.
            ForEach(AppTab.allCases) { tab in
                tabRoot(tab)
                    .onPreferenceChange(HidesTabBarKey.self) { hides in
                        if hides { tabsHidingBar.insert(tab) } else { tabsHidingBar.remove(tab) }
                    }
                    .opacity(selection == tab ? 1 : 0)
                    .allowsHitTesting(selection == tab)
                    .accessibilityHidden(selection != tab)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !tabsHidingBar.contains(selection) {
                AppTabBar(style: design.tabBar, selection: $selection, cartCount: cart.totalQuantity)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: tabsHidingBar)
        .environment(\.selectTab) { tab in
            withAnimation(.easeInOut(duration: 0.2)) { selection = tab }
        }
    }

    @ViewBuilder
    private func tabRoot(_ tab: AppTab) -> some View {
        switch tab {
        case .home:
            RoutedNavigationStack { HomeView() }
        case .catalog:
            RoutedNavigationStack { CatalogView() }
        case .cart:
            RoutedNavigationStack { CartView() }
        case .favorites:
            RoutedNavigationStack { FavoritesView() }
        case .profile:
            RoutedNavigationStack { ProfileView() }
        }
    }
}
