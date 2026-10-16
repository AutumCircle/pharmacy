import SwiftUI

/// «Профиль»: sign in / register by phone, the verified number, «Мои заказы» and sign-out.
struct ProfileView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.selectTab) private var selectTab
    @Environment(\.openRoute) private var openRoute
    @State private var confirmSignOut = false
    // Launch argument `-showLogin YES` opens the sign-in sheet (debug screenshots).
    @State private var showLogin = UserDefaults.standard.bool(forKey: "showLogin")

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if auth.isSignedIn {
                    accountCard
                } else {
                    signInCard
                }

                VStack(spacing: 0) {
                    row(icon: "shippingbox.fill", title: "Мои заказы", subtitle: "Статус и состав заказов") {
                        openRoute(.orders)
                    }
                    Divider().padding(.leading, 58)
                    row(icon: "heart.fill", title: "Избранное", subtitle: nil) {
                        selectTab(.favorites)
                    }
                }
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.surfaceCard))

                if auth.isSignedIn {
                    Button(role: .destructive) {
                        confirmSignOut = true
                    } label: {
                        Text("Выйти")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Theme.danger)
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Theme.surfaceCard))
                    }
                }
            }
            .padding(16)
        }
        .background(AppBackground())
        .navigationTitle("Профиль")
        .designPanelButton()
        .loginSheet(isPresented: $showLogin)
        .task {
            #if DEBUG
            // Launch argument `-openOrders YES` opens «Мои заказы» (simulator screenshots).
            if UserDefaults.standard.bool(forKey: "openOrders") { openRoute(.orders) }
            #endif
        }
        .confirmationDialog("Выйти из аккаунта?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { auth.signOut() }
        } message: {
            Text("Корзина и избранное останутся на этом устройстве.")
        }
    }

    private var accountCard: some View {
        HStack(spacing: 14) {
            Image(systemName: "person.fill")
                .font(.system(size: 24, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 56, height: 56)
                .background(Circle().fill(Theme.brandPrimary))
            VStack(alignment: .leading, spacing: 3) {
                Text(auth.phone.map(TajikPhone.display) ?? "")
                    .font(.system(size: 17, weight: .semibold).monospacedDigit())
                    .foregroundColor(Theme.textPrimary)
                Text("Номер подтверждён по SMS")
                    .font(.system(size: 14))
                    .foregroundColor(Theme.textSecondary)
            }
            Spacer()
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surfaceCard))
    }

    /// Signed out: invite to register / sign in with the phone number.
    private var signInCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Войдите по номеру телефона, чтобы оформлять заказы и видеть их статус")
                .font(.system(size: 15))
                .foregroundColor(Theme.textSecondary)
            Button {
                showLogin = true
            } label: {
                Text("Войти или зарегистрироваться")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(Capsule().fill(Theme.brandPrimary))
            }
            .accessibilityIdentifier("profile.signIn")
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Theme.surfaceCard))
    }

    private func row(icon: String, title: String, subtitle: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 32, height: 32)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Theme.brandPrimary))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16))
                        .foregroundColor(Theme.textPrimary)
                    if let subtitle = subtitle {
                        Text(subtitle)
                            .font(.system(size: 13))
                            .foregroundColor(Theme.textSecondary)
                    }
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Theme.disabledFill)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
