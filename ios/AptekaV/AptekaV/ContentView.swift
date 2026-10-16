//
//  ContentView.swift
//  AptekaV
//
//  Created by Developer on 12/10/26.
//

import SwiftUI

/// App root: the tab shell. Sign-in is optional and asked for only when needed
/// (placing an order, or «Войти» in «Профиль»).
/// Design options are picked in the debug-only «Дизайн» panel.
struct ContentView: View {
    var body: some View {
        RootView()
            .designPanelHost()
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
            .environmentObject(DesignSettings())
            .environmentObject(CartStore(fileName: "preview_cart.json"))
            .environmentObject(FavoritesStore(fileName: "preview_favorites.json"))
            .environmentObject(DesignPanelState())
            .environmentObject(AuthStore())
    }
}
