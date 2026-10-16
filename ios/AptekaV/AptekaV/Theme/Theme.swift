import SwiftUI

/// Design tokens from UI_DESIGN_SPEC.md §4.2 and the website's globals.css.
enum Theme {
    static let brandPrimary = Color(hex: 0xE31E24)
    static let brandPrimaryPressed = Color(hex: 0xB71C1C)
    static let brandSoft = Color(hex: 0xFFEBEE)
    static let surfacePage = Color(hex: 0xF8F9FA)
    static let surfaceCard = Color.white
    static let surfaceMuted = Color(hex: 0xF5F5F7)
    static let textPrimary = Color(hex: 0x2D2F33)
    static let textSecondary = Color(hex: 0x6C757D)
    static let border = Color(hex: 0xE0E0E0)
    static let mediaBorder = Color(hex: 0xEDF0F2)
    static let success = Color(hex: 0x2E7D32)
    static let danger = Color(hex: 0xC62828)
    static let disabledFill = Color(hex: 0xCCCCCC)
    static let disabledText = Color(hex: 0x666666)
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
