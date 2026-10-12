import SwiftUI

/// Card design options under review. Once the owner picks one, the others can be removed.
enum MedicineCardStyle: Int, CaseIterable, Identifiable {
    case classic = 1
    case glass
    case minimal
    case row
    case showcase
    case glassShowcase
    case glassShowcaseSolid
    case glassRow

    var id: Int { rawValue }

    var title: String {
        switch self {
        case .classic: return "Классика"
        case .glass: return "Стекло"
        case .minimal: return "Минимал"
        case .row: return "Список"
        case .showcase: return "Витрина"
        case .glassShowcase: return "Витрина · Стекло"
        case .glassShowcaseSolid: return "Витрина · Стекло, красная кнопка"
        case .glassRow: return "Список · Стекло"
        }
    }

    var summary: String {
        switch self {
        case .classic: return "Как карточка на сайте aptekavatan.tj"
        case .glass: return "Стиль Liquid Glass (имитация для iOS 16)"
        case .minimal: return "Без рамки, кнопка «+» прямо на фото"
        case .row: return "Горизонтальная строка для поиска и длинных списков"
        case .showcase: return "Фото на весь верх, цена на фото, контурная кнопка"
        case .glassShowcase: return "Вариант 5 в стиле Liquid Glass, контурная кнопка"
        case .glassShowcaseSolid: return "Вариант 5 в стиле Liquid Glass, красная кнопка как в варианте 1"
        case .glassRow: return "Вариант 4 в стиле Liquid Glass"
        }
    }

    /// Row cards take the full width; all other styles use a two-column grid.
    var columns: Int { (self == .row || self == .glassRow) ? 1 : 2 }

    /// Glass styles need a colourful backdrop to read as glass.
    var isGlass: Bool {
        switch self {
        case .glass, .glassShowcase, .glassShowcaseSolid, .glassRow: return true
        default: return false
        }
    }
}

/// Medicine card for catalogue/search screens. Stateless: cart quantity and favourite flag
/// come from the caller and every action is reported through `actions`.
struct MedicineCardView: View {
    let medicine: Medicine
    let quantityInCart: Int
    let isFavorite: Bool
    var style: MedicineCardStyle = .classic
    var actions = MedicineCardActions()

    var body: some View {
        switch style {
        case .classic:
            ClassicMedicineCard(medicine: medicine, quantityInCart: quantityInCart, isFavorite: isFavorite, actions: actions)
        case .glass:
            GlassMedicineCard(medicine: medicine, quantityInCart: quantityInCart, isFavorite: isFavorite, actions: actions)
        case .minimal:
            MinimalMedicineCard(medicine: medicine, quantityInCart: quantityInCart, isFavorite: isFavorite, actions: actions)
        case .row:
            RowMedicineCard(medicine: medicine, quantityInCart: quantityInCart, isFavorite: isFavorite, actions: actions)
        case .showcase:
            ShowcaseMedicineCard(medicine: medicine, quantityInCart: quantityInCart, isFavorite: isFavorite, actions: actions)
        case .glassShowcase:
            GlassShowcaseMedicineCard(medicine: medicine, quantityInCart: quantityInCart, isFavorite: isFavorite, buttonKind: .outlined, actions: actions)
        case .glassShowcaseSolid:
            GlassShowcaseMedicineCard(medicine: medicine, quantityInCart: quantityInCart, isFavorite: isFavorite, buttonKind: .solid, actions: actions)
        case .glassRow:
            GlassRowMedicineCard(medicine: medicine, quantityInCart: quantityInCart, isFavorite: isFavorite, actions: actions)
        }
    }
}

// MARK: - Previews

#if DEBUG
struct MedicineCardView_Previews: PreviewProvider {
    static var previews: some View {
        ForEach(MedicineCardStyle.allCases) { style in
            CardGalleryView(initialStyle: style)
                .previewDisplayName("\(style.rawValue). \(style.title)")
        }
    }
}
#endif
