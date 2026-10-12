//
//  ContentView.swift
//  AptekaV
//
//  Created by Developer on 12/10/26.
//

import SwiftUI

/// App root: the home screen with live search.
/// Will become the first tab of the tab-based app shell.
struct ContentView: View {
    var body: some View {
        #if DEBUG
        // Launch argument `-cardStyle N` opens the card-style gallery (used for simulator screenshots).
        if let style = MedicineCardStyle(rawValue: UserDefaults.standard.integer(forKey: "cardStyle")) {
            CardGalleryView(initialStyle: style)
        } else {
            HomeView()
        }
        #else
        HomeView()
        #endif
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
