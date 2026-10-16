import SwiftUI

/// App shell: the five tabs with the bottom bar in the selected navigation style.
/// Each tab keeps its own NavigationStack (and back stack) while switching.
struct RootView: View {
    @EnvironmentObject private var design: DesignSettings
    @EnvironmentObject private var cart: CartStore
    @EnvironmentObject private var network: NetworkMonitor
    @State private var selection: AppTab
    /// Tabs whose visible screen asked to hide the tab bar.
    @State private var tabsHidingBar: Set<AppTab> = []
    /// Routes to open in a tab after switching to it (`openInTab`).
    @State private var deepLinks: [AppTab: AppRoute] = [:]

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
        .safeAreaInset(edge: .top, spacing: 0) {
            if !network.isOnline {
                OfflineBanner().transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: network.isOnline)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !tabsHidingBar.contains(selection) {
                AppTabBar(style: design.tabBar, selection: $selection, cartCount: cart.totalQuantity)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: tabsHidingBar)
        .task {
            #if DEBUG
            // Launch argument `-seedCart "7023,4856"` fills an empty cart (simulator screenshots).
            let ids = (UserDefaults.standard.string(forKey: "seedCart") ?? "")
                .split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
            guard cart.items.isEmpty, !ids.isEmpty else { return }
            for id in ids {
                if let medicine = try? await APIClient.shared.medicine(id: id) {
                    cart.add(medicine)
                }
            }
            #endif
        }
        .environment(\.selectTab) { tab in
            withAnimation(.easeInOut(duration: 0.2)) { selection = tab }
        }
        .environment(\.openInTab) { tab, route in
            deepLinks[tab] = route
            withAnimation(.easeInOut(duration: 0.2)) { selection = tab }
        }
    }

    @ViewBuilder
    private func tabRoot(_ tab: AppTab) -> some View {
        switch tab {
        case .home:
            RoutedNavigationStack(deepLink: deepLink(.home)) { HomeView() }
        case .catalog:
            RoutedNavigationStack(deepLink: deepLink(.catalog)) { CatalogView() }
        case .cart:
            RoutedNavigationStack(deepLink: deepLink(.cart)) { CartView() }
        case .favorites:
            RoutedNavigationStack(deepLink: deepLink(.favorites)) { FavoritesView() }
        case .profile:
            RoutedNavigationStack(deepLink: deepLink(.profile)) { ProfileView() }
        }
    }

    private func deepLink(_ tab: AppTab) -> Binding<AppRoute?> {
        Binding(get: { deepLinks[tab] }, set: { deepLinks[tab] = $0 })
    }
}
