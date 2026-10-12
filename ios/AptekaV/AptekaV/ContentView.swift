//
//  ContentView.swift
//  AptekaV
//
//  Created by Developer on 12/10/26.
//

import SwiftUI

/// Temporary root: the tab bar and card style galleries for design review.
/// Will be replaced by the real tab-based app shell.
struct ContentView: View {
    var body: some View {
        #if DEBUG
        // Launch arguments `-tabBarStyle N` and `-cardStyle N` open option N (used for simulator screenshots).
        TabBarGalleryView(
            initialStyle: TabBarStyle(rawValue: UserDefaults.standard.integer(forKey: "tabBarStyle")) ?? .liquidGlass,
            initialCardStyle: MedicineCardStyle(rawValue: UserDefaults.standard.integer(forKey: "cardStyle")) ?? .classic
        )
        #else
        Text("Аптека «Ватан»")
        #endif
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
