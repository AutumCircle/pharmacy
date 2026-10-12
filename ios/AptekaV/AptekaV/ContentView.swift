//
//  ContentView.swift
//  AptekaV
//
//  Created by Developer on 12/10/26.
//

import SwiftUI

/// Debug: the tab bar design-review shell, whose «Главная» tab is the live-search home screen.
/// Release: the home screen alone, until the real tab-based app shell replaces both.
struct ContentView: View {
    @State private var cart: [Int: Int] = [:]
    @State private var favorites: Set<Int> = []

    var body: some View {
        #if DEBUG
        // Launch arguments `-tabBarStyle N`, `-cardStyle N` and `-searchBarStyle N` open option N
        // (used for simulator screenshots).
        TabBarGalleryView(
            initialStyle: TabBarStyle(rawValue: UserDefaults.standard.integer(forKey: "tabBarStyle")) ?? .liquidGlass,
            initialCardStyle: MedicineCardStyle(rawValue: UserDefaults.standard.integer(forKey: "cardStyle")) ?? .classic,
            initialSearchBarStyle: SearchBarStyle(rawValue: UserDefaults.standard.integer(forKey: "searchBarStyle")) ?? .system
        )
        #else
        HomeView(cart: $cart, favorites: $favorites)
        #endif
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
