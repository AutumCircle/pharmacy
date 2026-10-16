import SwiftUI

/// Full error state (UI_DESIGN_SPEC §8.8, §11): human Russian text, «Повторить» and «На главную».
/// Never shows technical details, request payloads or server internals.
struct ErrorStateView: View {
    enum Kind: Equatable {
        /// Server or unexpected error; `message` is an already user-friendly text.
        case failed(message: String?)
        case notFound(title: String)
    }

    @EnvironmentObject private var network: NetworkMonitor
    @Environment(\.selectTab) private var selectTab
    @Environment(\.popToRoot) private var popToRoot

    let kind: Kind
    var retry: (() -> Void)?
    /// Shows «На главную» (off where the screen already is the home tab root).
    var showsHomeButton = true

    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 40, weight: .semibold))
                .foregroundColor(Theme.brandPrimary)
                .frame(width: 96, height: 96)
                .background(Circle().fill(Theme.brandSoft))
                .accessibilityHidden(true)
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(Theme.textPrimary)
                .multilineTextAlignment(.center)
            Text(text)
                .font(.system(size: 15))
                .foregroundColor(Theme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            VStack(spacing: 10) {
                if let retry = retry, !isNotFound {
                    Button(action: retry) {
                        Text("Повторить")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(Capsule().fill(Theme.brandPrimary))
                    }
                    .accessibilityIdentifier("error.retry")
                }
                if showsHomeButton {
                    Button {
                        popToRoot()
                        selectTab(.home)
                    } label: {
                        Text("На главную")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Theme.brandPrimary)
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .background(Capsule().stroke(Theme.border, lineWidth: 1))
                    }
                }
                if isNotFound {
                    Button {
                        popToRoot()
                        selectTab(.catalog)
                    } label: {
                        Text("Открыть каталог")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Theme.brandPrimary)
                            .frame(maxWidth: .infinity, minHeight: 50)
                    }
                }
            }
            .padding(.top, 8)
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 40)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }

    private var isOffline: Bool {
        if case .failed = kind { return !network.isOnline }
        return false
    }

    private var isNotFound: Bool {
        if case .notFound = kind { return true }
        return false
    }

    private var icon: String {
        if isOffline { return "wifi.slash" }
        return isNotFound ? "magnifyingglass" : "exclamationmark.triangle"
    }

    private var title: String {
        if isOffline { return "Нет соединения" }
        switch kind {
        case .failed: return "Что-то пошло не так"
        case .notFound(let title): return title
        }
    }

    private var text: String {
        if isOffline { return "Проверьте интернет и повторите" }
        switch kind {
        case .failed(let message):
            return message ?? "Не удалось загрузить данные. Попробуйте ещё раз."
        case .notFound:
            return "Возможно, товар больше не продаётся или ссылка устарела."
        }
    }
}
