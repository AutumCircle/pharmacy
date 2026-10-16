import Foundation

/// Public medicine item returned by `/api/search`, `/api/medicines/{id}` and category listings.
/// Mirrors `PublicMedicine` in src/lib/api-v1/types.ts. `base_unit_price` is never public.
struct Medicine: Identifiable, Codable, Hashable {
    let medicineId: Int
    let medicineName: String
    let sellingUnitPrice: Decimal
    let currency: String
    let country: String?
    let vendor: String?
    let inStock: Bool
    let catalogUpdatedAt: String?
    let imageUrl: String?

    var id: Int { medicineId }

    enum CodingKeys: String, CodingKey {
        case medicineId = "medicine_id"
        case medicineName = "medicine_name"
        case sellingUnitPrice = "selling_unit_price"
        case currency
        case country
        case vendor
        case inStock = "in_stock"
        case catalogUpdatedAt = "catalog_updated_at"
        case imageUrl = "image_url"
    }

    /// Only HTTPS images are accepted, matching the admin API rule for image URLs.
    var secureImageURL: URL? {
        guard let imageUrl = imageUrl, let url = URL(string: imageUrl), url.scheme == "https" else {
            return nil
        }
        return url
    }
}

enum PriceFormatter {
    private static let formatter: NumberFormatter = {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2
        return formatter
    }()

    /// The website shows customer prices as "25 с." (somoni).
    static func string(_ value: Decimal) -> String {
        let number = formatter.string(from: value as NSDecimalNumber) ?? "\(value)"
        return "\(number) с."
    }

    /// Order quantities from the server (`2`, or `1,5` if a fractional quantity was set by staff).
    static func quantity(_ value: Double) -> String {
        formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

#if DEBUG
extension Medicine {
    /// Test photo supplied by the owner for checking image rendering.
    static let sampleWithPhoto = Medicine(
        medicineId: 5120,
        medicineName: "La Roche-Posay тестовый товар с фото 40мл",
        sellingUnitPrice: 189,
        currency: "TJS",
        country: "Франция",
        vendor: "La Roche-Posay",
        inStock: true,
        catalogUpdatedAt: nil,
        imageUrl: "https://www.laroche-posay.ru/media/catalog/product/cache/f6afb9b841bd1095cb160e619a7c31fd/3/3/3337875934633_1200x1200_1_8_.png"
    )

    static let sampleInStock = Medicine(
        medicineId: 1042,
        medicineName: "Аспирин Кардио тб 100мг №28",
        sellingUnitPrice: 25,
        currency: "TJS",
        country: "Германия",
        vendor: "Bayer",
        inStock: true,
        catalogUpdatedAt: "2026-08-06T10:15:30Z",
        imageUrl: nil
    )

    static let sampleLongName = Medicine(
        medicineId: 2051,
        medicineName: "Нурофен для детей суспензия апельсиновая 100мг/5мл 200мл",
        sellingUnitPrice: 48.5,
        currency: "TJS",
        country: "Великобритания",
        vendor: "Reckitt",
        inStock: true,
        catalogUpdatedAt: nil,
        imageUrl: nil
    )

    static let sampleOutOfStock = Medicine(
        medicineId: 3307,
        medicineName: "Но-шпа тб 40мг №24",
        sellingUnitPrice: 32,
        currency: "TJS",
        country: "Венгрия",
        vendor: "Sanofi",
        inStock: false,
        catalogUpdatedAt: nil,
        imageUrl: nil
    )
}
#endif
