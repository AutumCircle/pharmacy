import SwiftUI

/// Active catalogue category from `/api/categories`.
struct MedicineCategory: Identifiable, Decodable, Hashable {
    let id: Int
    let slug: String
    let name: String
    /// Emoji or short symbol configured in the admin panel.
    let icon: String?
    /// `#RRGGBB` accent configured in the admin panel.
    let color: String?

    var accentColor: Color {
        color.flatMap(Color.init(hexString:)) ?? Theme.brandPrimary
    }
}

/// Homepage banner. Only the fields the app renders are decoded; the website's
/// pixel-level layout settings are ignored on mobile.
struct HomeBanner: Identifiable, Decodable, Hashable {
    let slot: String
    let title: String?
    let subtitle: String?
    let imageUrl: String?
    let linkUrl: String?
    let ctaText: String?
    let altText: String?
    let overlayEnabled: Bool?
    let overlayColor: String?
    /// 0–100, as stored by the admin banner editor.
    let overlayOpacity: Double?
    let textColor: String?
    var imageWidth: Double? = nil
    var imageHeight: Double? = nil
    /// `cover` or `contain`, as set in the admin banner editor.
    var fitMode: String? = nil
    var containBackgroundColor: String? = nil

    var id: String { slot }

    /// Width / height of the uploaded image; nil when the admin did not store dimensions.
    var imageAspectRatio: CGFloat? {
        guard let width = imageWidth, let height = imageHeight, width > 0, height > 0 else { return nil }
        return CGFloat(width / height)
    }

    enum CodingKeys: String, CodingKey {
        case slot, title, subtitle
        case imageUrl = "image_url"
        case linkUrl = "link_url"
        case ctaText = "cta_text"
        case altText = "alt_text"
        case overlayEnabled = "overlay_enabled"
        case overlayColor = "overlay_color"
        case overlayOpacity = "overlay_opacity"
        case textColor = "text_color"
        case imageWidth = "image_width"
        case imageHeight = "image_height"
        case fitMode = "fit_mode"
        case containBackgroundColor = "contain_background_color"
    }

    var secureImageURL: URL? {
        guard let imageUrl = imageUrl, let url = URL(string: imageUrl), url.scheme == "https" else { return nil }
        return url
    }

    var foreground: Color {
        textColor.flatMap(Color.init(hexString:)) ?? .white
    }

    /// Category slug when the banner links to `/category/{slug}`.
    var linkedCategorySlug: String? {
        guard let linkUrl = linkUrl, let range = linkUrl.range(of: "/category/") else { return nil }
        let slug = linkUrl[range.upperBound...].split(separator: "?").first.map(String.init) ?? ""
        return slug.isEmpty ? nil : slug
    }

    /// Website slots in display order; `mobile` is designed for phones, so it goes first.
    static let slotOrder = ["mobile", "center", "left", "right_top", "right_bottom"]
}

/// A titled row of products on the home screen.
struct ProductCarousel: Identifiable, Decodable, Hashable {
    let slug: String
    let title: String
    let products: [Medicine]
    /// Set when the row was built from a category, so «Все» can open it.
    var category: MedicineCategory? = nil

    var id: String { slug }

    enum CodingKeys: String, CodingKey {
        case slug, title, products
    }
}

extension Color {
    /// Parses `#RRGGBB` / `RRGGBB`; returns nil for anything else.
    init?(hexString: String) {
        var text = hexString.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        self.init(hex: value)
    }
}

#if DEBUG
extension HomeBanner {
    /// Shown in debug builds while `/api/homepage-banners` does not exist on the website yet.
    /// Copy uses only approved service facts (UI_DESIGN_SPEC §8.1), no promotions.
    static let demo: [HomeBanner] = [
        HomeBanner(
            slot: "demo-1", title: "Лекарства рядом — быстро и удобно",
            subtitle: "Заказ без регистрации, оплата при получении",
            imageUrl: nil, linkUrl: nil, ctaText: "В каталог", altText: nil,
            overlayEnabled: nil, overlayColor: "#E31E24", overlayOpacity: nil, textColor: "#FFFFFF"
        ),
        HomeBanner(
            slot: "demo-2", title: "Актуальное наличие",
            subtitle: "Каталог обновляется из аптеки каждый день",
            imageUrl: nil, linkUrl: nil, ctaText: nil, altText: nil,
            overlayEnabled: nil, overlayColor: "#1565C0", overlayOpacity: nil, textColor: "#FFFFFF"
        ),
        HomeBanner(
            slot: "demo-3", title: "Витамины и БАДы",
            subtitle: "Тестовый баннер со ссылкой на категорию",
            imageUrl: nil, linkUrl: "/category/vitamins-bads", ctaText: "Смотреть", altText: nil,
            overlayEnabled: nil, overlayColor: "#2E7D32", overlayOpacity: nil, textColor: "#FFFFFF"
        ),
    ]
}
#endif
