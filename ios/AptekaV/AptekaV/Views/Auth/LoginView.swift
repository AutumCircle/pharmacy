import SwiftUI

/// Phone sign-in, presented as a sheet when it is needed (placing an order, or «Войти» in
/// «Профиль»). Two steps: Tajik number (+992 and 9 digits) → 5-digit SMS code.
/// Only the logo, the form and one button, on Liquid Glass.
struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss

    /// Called after a successful sign-in, before the sheet closes.
    private let onSignedIn: () -> Void

    private enum Step { case phone, code }

    private let service: PhoneAuthService = MockPhoneAuthService()
    private let codeLength = MockPhoneAuthService.codeLength

    @State private var step: Step = .phone
    @State private var localPhone = ""
    @State private var code = ""
    @State private var isBusy = false
    @State private var errorText: String?
    @State private var resendSeconds = 0
    @FocusState private var phoneFocused: Bool
    @FocusState private var codeFocused: Bool

    init(onSignedIn: @escaping () -> Void = {}) {
        self.onSignedIn = onSignedIn
        #if DEBUG
        // Launch argument `-loginPhone 931234567` opens the code step directly (simulator screenshots).
        let phone = TajikPhone.sanitize(UserDefaults.standard.string(forKey: "loginPhone") ?? "")
        if TajikPhone.isValid(phone) {
            _localPhone = State(initialValue: phone)
            _step = State(initialValue: .code)
            _resendSeconds = State(initialValue: 60)
        }
        #endif
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 32) {
                Image("VatanLogoName")
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(height: 64)
                    .accessibilityLabel("Аптека «Ватан»")
                    .padding(.top, 64)

                VStack(spacing: 16) {
                    switch step {
                    case .phone: phoneForm
                    case .code: codeForm
                    }
                }
                .padding(18)
                .background(GlassCardBackground(cornerRadius: 30))
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(GlassBackdrop())
        .overlay(alignment: .topLeading) { topButton }
        .animation(.easeInOut(duration: 0.25), value: step)
    }

    /// Icon-only: close on the phone step, back to the number on the code step.
    private var topButton: some View {
        Button {
            if step == .code {
                step = .phone
                code = ""
                errorText = nil
            } else {
                dismiss()
            }
        } label: {
            Image(systemName: step == .code ? "chevron.left" : "xmark")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Theme.textPrimary)
                .frame(width: 44, height: 44)
                .background(GlassCapsule(tint: nil))
        }
        .padding(.leading, 16)
        .padding(.top, 16)
        .accessibilityLabel(step == .code ? "Изменить номер" : "Закрыть")
    }

    // MARK: Step 1 — phone

    private var phoneForm: some View {
        VStack(spacing: 16) {
            HStack(spacing: 8) {
                Text(TajikPhone.countryCode)
                    .font(.system(size: 20, weight: .semibold).monospacedDigit())
                    .foregroundColor(Theme.textPrimary)
                TextField("00 000 00 00", text: Binding(
                    get: { TajikPhone.format(localPhone) },
                    set: { localPhone = TajikPhone.sanitize($0); errorText = nil }
                ))
                .keyboardType(.numberPad)
                .textContentType(.telephoneNumber)
                .font(.system(size: 20, weight: .semibold).monospacedDigit())
                .focused($phoneFocused)
                .accessibilityLabel("Номер телефона, 9 цифр после +992")
                .accessibilityIdentifier("login.phone")
                // Filled digits counter: 0/9 … 9/9.
                Text("\(localPhone.count)/\(TajikPhone.localLength)")
                    .font(.system(size: 14, weight: .semibold).monospacedDigit())
                    .foregroundColor(TajikPhone.isValid(localPhone) ? Theme.success : Theme.textSecondary)
                    .accessibilityLabel("Введено \(localPhone.count) из \(TajikPhone.localLength) цифр")
            }
            .padding(.horizontal, 18)
            .frame(height: 58)
            .background(fieldBackground(active: phoneFocused))

            errorLabel

            glassButton(title: isBusy ? "Отправляем…" : "Получить код", enabled: TajikPhone.isValid(localPhone) && !isBusy) {
                Task { await sendCode() }
            }
            .accessibilityIdentifier("login.sendCode")
        }
        .task { await focusSoon { phoneFocused = true } }
    }

    // MARK: Step 2 — code

    private var codeForm: some View {
        VStack(spacing: 16) {
            codeBoxes
            errorLabel
            glassButton(title: isBusy ? "Проверяем…" : "Войти", enabled: code.count == codeLength && !isBusy) {
                Task { await verify() }
            }
            resendButton
            #if DEBUG
            Text("Тестовый код: \(MockPhoneAuthService.testCode)")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Theme.warningText)
            #endif
        }
        .task { await focusSoon { codeFocused = true } }
        .task(id: resendSeconds > 0) {
            while resendSeconds > 0 {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { return }
                resendSeconds -= 1
            }
        }
    }

    @ViewBuilder
    private var resendButton: some View {
        if resendSeconds > 0 {
            Text("Повторно через 0:\(String(format: "%02d", resendSeconds))")
                .font(.system(size: 14).monospacedDigit())
                .foregroundColor(Theme.textSecondary)
        } else {
            Button("Отправить код ещё раз") {
                Task { await sendCode() }
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundColor(Theme.brandPrimary)
            .frame(minHeight: 44)
            .disabled(isBusy)
        }
    }

    /// Digit boxes with one real text field laid over them: tapping anywhere on the boxes
    /// focuses it, and iOS can autofill the code from the SMS (`.oneTimeCode`).
    private var codeBoxes: some View {
        HStack(spacing: 8) {
            ForEach(0..<codeLength, id: \.self) { index in
                let digit = index < code.count ? String(code[code.index(code.startIndex, offsetBy: index)]) : ""
                let isActive = codeFocused && index == min(code.count, codeLength - 1)
                Text(digit)
                    .font(.system(size: 26, weight: .bold).monospacedDigit())
                    .foregroundColor(Theme.textPrimary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 60)
                    .background(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(Color.white.opacity(0.75))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(
                                errorText != nil ? Theme.danger : (isActive ? Theme.brandPrimary : Color.white),
                                lineWidth: isActive || errorText != nil ? 2 : 1
                            )
                    )
            }
        }
        .accessibilityHidden(true)
        .overlay {
            TextField("", text: Binding(
                get: { code },
                set: { newValue in
                    let digits = String(newValue.filter(\.isNumber).prefix(codeLength))
                    guard digits != code else { return }
                    code = digits
                    errorText = nil
                    if code.count == codeLength {
                        Task { await verify() }
                    }
                }
            ))
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .focused($codeFocused)
            // Typed text and caret are invisible; the boxes show the digits.
            .foregroundColor(.clear)
            .tint(.clear)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .accessibilityLabel("Код из SMS, \(codeLength) цифр")
            .accessibilityValue(code)
            .accessibilityIdentifier("login.code")
        }
    }

    // MARK: Shared

    private func fieldBackground(active: Bool) -> some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color.white.opacity(0.75))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(active ? Theme.brandPrimary : Color.white, lineWidth: active ? 2 : 1)
            )
    }

    @ViewBuilder
    private var errorLabel: some View {
        if let errorText = errorText {
            Label(errorText, systemImage: "exclamationmark.circle.fill")
                .font(.system(size: 14))
                .foregroundColor(Theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Red tinted glass when enabled, clear glass when disabled.
    private func glassButton(title: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(enabled ? .white : Theme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(GlassCapsule(tint: enabled ? Theme.brandPrimary : nil))
                .contentShape(Capsule())
        }
        .buttonStyle(PressDimButtonStyle())
        .disabled(!enabled)
    }

    /// Focus after the sheet/step transition has settled; focus set during it can be dropped.
    private func focusSoon(_ apply: () -> Void) async {
        try? await Task.sleep(nanoseconds: 450_000_000)
        guard !Task.isCancelled else { return }
        apply()
    }

    private func sendCode() async {
        guard TajikPhone.isValid(localPhone), !isBusy else { return }
        isBusy = true
        errorText = nil
        defer { isBusy = false }
        do {
            try await service.sendCode(to: TajikPhone.e164(localPhone))
            code = ""
            resendSeconds = 60
            step = .code
        } catch {
            errorText = PhoneAuthError.network.message
        }
    }

    private func verify() async {
        guard code.count == codeLength, !isBusy else { return }
        isBusy = true
        defer { isBusy = false }
        do {
            try await service.verify(code: code, for: TajikPhone.e164(localPhone))
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            auth.signIn(phone: TajikPhone.e164(localPhone))
            onSignedIn()
            dismiss()
        } catch {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            errorText = (error as? PhoneAuthError)?.message ?? PhoneAuthError.network.message
            code = ""
        }
    }
}

extension View {
    /// Presents the phone sign-in sheet; `onSignedIn` runs after a successful sign-in.
    func loginSheet(isPresented: Binding<Bool>, onSignedIn: @escaping () -> Void = {}) -> some View {
        modifier(LoginSheetModifier(isPresented: isPresented, onSignedIn: onSignedIn))
    }
}

private struct LoginSheetModifier: ViewModifier {
    @EnvironmentObject private var auth: AuthStore
    @Binding var isPresented: Bool
    let onSignedIn: () -> Void

    func body(content: Content) -> some View {
        content.sheet(isPresented: $isPresented) {
            LoginView(onSignedIn: onSignedIn)
                .environmentObject(auth)
        }
    }
}
