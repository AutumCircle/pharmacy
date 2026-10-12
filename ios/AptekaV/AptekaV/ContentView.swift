//
//  ContentView.swift
//  AptekaV
//
//  Created by Developer on 12/10/26.
//

import SwiftUI

/// Temporary root: the card-style gallery for design review.
/// Will be replaced by the real tab-based app shell.
struct ContentView: View {
    var body: some View {
        #if DEBUG
        // Launch argument `-cardStyle N` opens option N (used for simulator screenshots).
        CardGalleryView(
            initialStyle: MedicineCardStyle(rawValue: UserDefaults.standard.integer(forKey: "cardStyle")) ?? .classic
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
