import SwiftUI

// Development-only design panel: pick the home layout, navigation bar, search bar and card style.
// Everything here compiles only in DEBUG; in Release the modifiers do nothing and the app uses
// `DesignSettings.production`. Remove this file before release once the design is final.

/// Shows/hides the panel; owned by the app.
@MainActor
final class DesignPanelState: ObservableObject {
    @Published var isPresented = false

    init() {
        #if DEBUG
        // Launch argument `-openDesignPanel YES` opens the panel at start (simulator screenshots).
        isPresented = UserDefaults.standard.bool(forKey: "openDesignPanel")
        #endif
    }
}

extension View {
    /// Toolbar button that opens the design panel (DEBUG only).
    /// Pass `onBrandBar: true` when the navigation bar is red so the icon is drawn in white.
    func designPanelButton(onBrandBar: Bool = false) -> some View {
        #if DEBUG
        return modifier(DesignPanelButtonModifier(onBrandBar: onBrandBar))
        #else
        return self
        #endif
    }

    /// Floating panel button for screens without a navigation bar, e.g. sign-in (DEBUG only).
    func designPanelOverlayButton() -> some View {
        #if DEBUG
        return modifier(DesignPanelOverlayButtonModifier())
        #else
        return self
        #endif
    }

    /// Attaches the panel sheet and the shake gesture to the app root (DEBUG only).
    func designPanelHost() -> some View {
        #if DEBUG
        return modifier(DesignPanelHostModifier())
        #else
        return self
        #endif
    }
}

#if DEBUG
private struct DesignPanelButtonModifier: ViewModifier {
    @EnvironmentObject private var panel: DesignPanelState
    let onBrandBar: Bool

    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button {
                    panel.isPresented = true
                } label: {
                    Image(systemName: "paintpalette")
                        .foregroundColor(onBrandBar ? .white : Theme.brandPrimary)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .accessibilityLabel("Дизайн (только для разработки)")
            }
        }
    }
}

private struct DesignPanelOverlayButtonModifier: ViewModifier {
    @EnvironmentObject private var panel: DesignPanelState

    func body(content: Content) -> some View {
        content.overlay(alignment: .topTrailing) {
            Button {
                panel.isPresented = true
            } label: {
                Image(systemName: "paintpalette")
                    .foregroundColor(Theme.brandPrimary)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Theme.surfaceCard).shadow(color: .black.opacity(0.08), radius: 6, y: 2))
            }
            .padding(.trailing, 16)
            .accessibilityLabel("Дизайн (только для разработки)")
        }
    }
}

private struct DesignPanelHostModifier: ViewModifier {
    @EnvironmentObject private var panel: DesignPanelState
    @EnvironmentObject private var design: DesignSettings
    @EnvironmentObject private var auth: AuthStore

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $panel.isPresented) {
                DesignPanelView()
                    .environmentObject(design)
                    .environmentObject(auth)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                    // Keep the app usable behind the half-height panel to see changes live.
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            }
            .onReceive(NotificationCenter.default.publisher(for: .deviceDidShake)) { _ in
                panel.isPresented = true
            }
    }
}

/// The panel itself.
struct DesignPanelView: View {
    @EnvironmentObject private var design: DesignSettings
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var confirmReset = false
    @State private var siteOverride = UserDefaults.standard.string(forKey: AppConfig.siteOverrideKey) ?? ""
    @State private var sendRealOrders = UserDefaults.standard.bool(forKey: OrderServiceFactory.realOrdersKey)
    @State private var vercelBypass = UserDefaults.standard.string(forKey: AppConfig.vercelBypassKey) ?? ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Выбор сохраняется на устройстве. В сборке для App Store панели нет, используются значения `DesignSettings.production`.")
                        .font(.footnote)
                        .foregroundColor(Theme.textSecondary)
                }

                optionSection(
                    "Главный экран",
                    options: HomeLayoutStyle.allCases,
                    selection: $design.home,
                    number: \.rawValue, title: \.title, summary: \.summary
                )

                optionSection(
                    "Окно товара",
                    options: ProductPageStyle.allCases,
                    selection: $design.productPage,
                    number: \.rawValue, title: \.title, summary: \.summary
                )

                optionSection(
                    "Навигация (нижняя панель)",
                    options: TabBarStyle.allCases,
                    selection: $design.tabBar,
                    number: \.rawValue, title: \.title, summary: \.summary,
                    compare: AnyView(TabBarComparisonView().navigationTitle("Все панели"))
                )

                optionSection(
                    "Строка поиска",
                    options: SearchBarStyle.allCases,
                    selection: $design.searchBar,
                    number: \.rawValue, title: \.title, summary: \.summary,
                    compare: AnyView(SearchBarComparisonView().navigationTitle("Все поиски"))
                )

                optionSection(
                    "Карточка товара",
                    options: MedicineCardStyle.allCases,
                    selection: $design.card,
                    number: \.rawValue, title: \.title, summary: \.summary,
                    compare: AnyView(CardGalleryView(initialStyle: design.card))
                )

                Section {
                    if let phone = auth.phone {
                        Text("Вошли как \(TajikPhone.display(phone))")
                            .foregroundColor(Theme.textSecondary)
                        Button("Выйти", role: .destructive) {
                            auth.signOut()
                        }
                    } else {
                        Text("Не выполнен вход. Вход: «Профиль» → «Войти» или при оформлении заказа. Тестовый код: \(MockPhoneAuthService.testCode)")
                            .foregroundColor(Theme.textSecondary)
                    }
                } header: {
                    Text("Вход по SMS")
                }

                Section {
                    Toggle("Отправлять реальные заказы", isOn: $sendRealOrders)
                        .tint(Theme.brandPrimary)
                        .onChange(of: sendRealOrders) { value in
                            UserDefaults.standard.set(value, forKey: OrderServiceFactory.realOrdersKey)
                        }
                } header: {
                    Text("Заказы")
                } footer: {
                    Text(sendRealOrders
                         ? "Внимание: заказ уйдёт в аптеку и сотрудники получат уведомление."
                         : "Тестовый режим: заказ создаётся только в приложении (номер TEST-…), в аптеку ничего не отправляется.")
                }

                Section {
                    TextField("https://…vercel.app", text: $siteOverride)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("Vercel bypass-ключ (для защищённого preview)", text: $vercelBypass)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Применить") {
                        let text = siteOverride.trimmingCharacters(in: .whitespaces)
                        if text.isEmpty {
                            UserDefaults.standard.removeObject(forKey: AppConfig.siteOverrideKey)
                        } else {
                            UserDefaults.standard.set(text, forKey: AppConfig.siteOverrideKey)
                        }
                        siteOverride = UserDefaults.standard.string(forKey: AppConfig.siteOverrideKey) ?? ""
                        let token = vercelBypass.trimmingCharacters(in: .whitespaces)
                        if token.isEmpty {
                            UserDefaults.standard.removeObject(forKey: AppConfig.vercelBypassKey)
                        } else {
                            UserDefaults.standard.set(token, forKey: AppConfig.vercelBypassKey)
                        }
                    }
                } header: {
                    Text("Сайт для данных")
                } footer: {
                    Text("Сейчас: \(AppConfig.siteBaseURL.absoluteString). Пусто — рабочий сайт. Только https. Потяните главную вниз, чтобы перезагрузить данные.")
                }

                Section {
                    Button("Сбросить к выбору для production", role: .destructive) {
                        confirmReset = true
                    }
                }
            }
            .navigationTitle("Дизайн")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Готово") { dismiss() }
                }
            }
            .confirmationDialog("Сбросить выбор дизайна?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Сбросить", role: .destructive) { design.resetToProduction() }
            }
        }
        .tint(Theme.brandPrimary)
    }

    private func optionSection<Option: Hashable & Identifiable>(
        _ header: String,
        options: [Option],
        selection: Binding<Option>,
        number: KeyPath<Option, Int>,
        title: KeyPath<Option, String>,
        summary: KeyPath<Option, String>,
        compare: AnyView? = nil
    ) -> some View {
        Section {
            ForEach(options) { option in
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { selection.wrappedValue = option }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(option[keyPath: number])")
                            .font(.system(size: 13, weight: .bold).monospacedDigit())
                            .foregroundColor(selection.wrappedValue == option ? .white : Theme.textSecondary)
                            .frame(width: 26, height: 26)
                            .background(Circle().fill(selection.wrappedValue == option ? Theme.brandPrimary : Theme.surfaceMuted))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(option[keyPath: title])
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(Theme.textPrimary)
                            Text(option[keyPath: summary])
                                .font(.system(size: 12))
                                .foregroundColor(Theme.textSecondary)
                        }
                        Spacer(minLength: 0)
                        if selection.wrappedValue == option {
                            Image(systemName: "checkmark")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(Theme.brandPrimary)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection.wrappedValue == option ? .isSelected : [])
            }
            if let compare = compare {
                NavigationLink {
                    compare
                } label: {
                    Label("Сравнить все варианты", systemImage: "square.stack")
                        .foregroundColor(Theme.brandPrimary)
                }
            }
        } header: {
            Text(header)
        }
    }
}

extension Notification.Name {
    static let deviceDidShake = Notification.Name("AptekaV.deviceDidShake")
}

extension UIWindow {
    /// Shake (⌃⌘Z in the Simulator) opens the design panel in debug builds.
    open override func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake {
            NotificationCenter.default.post(name: .deviceDidShake, object: nil)
        }
        super.motionEnded(motion, with: event)
    }
}
#endif
