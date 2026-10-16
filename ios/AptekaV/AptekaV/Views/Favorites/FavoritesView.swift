import SwiftUI

/// «Избранное» (UI spec §8.5). Saved on the device; out-of-stock items stay visible.
struct FavoritesView: View {
    @EnvironmentObject private var favorites: FavoritesStore
    @Environment(\.openRoute) private var openRoute
    @Environment(\.selectTab) private var selectTab
    @State private var confirmClear = false

    var body: some View {
        ScrollView {
            if favorites.medicines.isEmpty {
                StateMessageView(icon: "heart", title: "В избранном пока ничего нет", actionTitle: "Перейти в каталог") {
                    selectTab(.catalog)
                }
                .padding(.top, 60)
            } else {
                MedicineCollectionView(medicines: favorites.medicines, onOpen: { openRoute(.medicine($0)) })
                    .padding(16)
            }
        }
        .background(AppBackground())
        .navigationTitle(favorites.medicines.isEmpty ? "Избранное" : "Избранное · \(favorites.medicines.count)")
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                if !favorites.medicines.isEmpty {
                    Button("Очистить") { confirmClear = true }
                }
            }
        }
        .designPanelButton()
        .confirmationDialog("Очистить избранное?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Очистить", role: .destructive) { favorites.clear() }
        }
    }
}
