import Foundation

/// Phone-number sign-in state. The verified number is the only thing stored (no tokens yet).
@MainActor
final class AuthStore: ObservableObject {
    /// Verified number in E.164 form, e.g. `+992931234567`; nil when signed out.
    @Published private(set) var phone: String?

    private static let phoneKey = "auth.phone"

    var isSignedIn: Bool { phone != nil }

    init() {
        // An empty value (e.g. launch argument `-auth.phone ""`) means signed out.
        let stored = UserDefaults.standard.string(forKey: Self.phoneKey)
        phone = (stored?.isEmpty ?? true) ? nil : stored
    }

    func signIn(phone: String) {
        self.phone = phone
        UserDefaults.standard.set(phone, forKey: Self.phoneKey)
    }

    func signOut() {
        phone = nil
        UserDefaults.standard.removeObject(forKey: Self.phoneKey)
    }
}

/// Tajik mobile number: `+992` and exactly 9 digits.
enum TajikPhone {
    static let countryCode = "+992"
    static let localLength = 9

    /// Keeps digits only, at most 9.
    static func sanitize(_ text: String) -> String {
        String(text.filter(\.isNumber).prefix(localLength))
    }

    static func isValid(_ local: String) -> Bool {
        local.count == localLength && local.allSatisfy(\.isNumber)
    }

    static func e164(_ local: String) -> String {
        countryCode + local
    }

    /// `931234567` → `93 123 45 67`
    static func format(_ local: String) -> String {
        var result = ""
        for (index, character) in local.enumerated() {
            if [2, 5, 7].contains(index) { result.append(" ") }
            result.append(character)
        }
        return result
    }

    /// `+992931234567` → `+992 93 123 45 67`
    static func display(_ e164: String) -> String {
        let local = e164.hasPrefix(countryCode) ? String(e164.dropFirst(countryCode.count)) : e164
        return "\(countryCode) \(format(local))"
    }
}

enum PhoneAuthError: Error {
    case invalidCode
    case network

    var message: String {
        switch self {
        case .invalidCode: return "Неверный код. Проверьте SMS и попробуйте ещё раз."
        case .network: return "Не удалось отправить запрос. Проверьте интернет."
        }
    }
}

/// Sends and checks SMS codes. The real implementation must call a website `/api` route backed
/// by Lambda and an SMS provider; the app never holds SMS-provider keys.
protocol PhoneAuthService {
    static var codeLength: Int { get }
    func sendCode(to phone: String) async throws
    func verify(code: String, for phone: String) async throws
}

/// TEMPORARY stand-in until the SMS backend exists: no SMS is sent and the code is fixed.
/// Must be replaced before the App Store release.
struct MockPhoneAuthService: PhoneAuthService {
    static let codeLength = 5
    static let testCode = "12345"

    func sendCode(to phone: String) async throws {
        try await Task.sleep(nanoseconds: 700_000_000)
    }

    func verify(code: String, for phone: String) async throws {
        try await Task.sleep(nanoseconds: 500_000_000)
        guard code == Self.testCode else { throw PhoneAuthError.invalidCode }
    }
}
