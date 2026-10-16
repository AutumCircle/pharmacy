//
//  AptekaVApp.swift
//  AptekaV
//
//  Created by Developer on 12/10/26.
//

import SwiftUI

@main
struct AptekaVApp: App {
    @StateObject private var design = DesignSettings()
    @StateObject private var cart = CartStore()
    @StateObject private var favorites = FavoritesStore()
    @StateObject private var designPanel = DesignPanelState()
    @StateObject private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(design)
                .environmentObject(cart)
                .environmentObject(favorites)
                .environmentObject(designPanel)
                .environmentObject(auth)
        }
    }
}
