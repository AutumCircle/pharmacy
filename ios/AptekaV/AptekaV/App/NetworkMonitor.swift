import Network
import SwiftUI

/// Publishes whether the device currently has a network path.
@MainActor
final class NetworkMonitor: ObservableObject {
    @Published private(set) var isOnline = true

    private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self = self, self.isOnline != online else { return }
                self.isOnline = online
            }
        }
        monitor.start(queue: DispatchQueue(label: "AptekaV.NetworkMonitor"))
    }

    deinit {
        monitor.cancel()
    }
}

/// Thin banner under the status bar while offline (UI spec §11 «Offline/timeout»).
struct OfflineBanner: View {
    var body: some View {
        Label("Нет соединения. Проверьте интернет и повторите", systemImage: "wifi.slash")
            .font(.system(size: 13, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity)
            .background(Theme.textPrimary.opacity(0.92))
            .accessibilityAddTraits(.isHeader)
    }
}
