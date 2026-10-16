import Foundation

/// Site configuration. The app talks only to the public `/api/*` routes of the website.
enum AppConfig {
    /// HTTPS only; no secrets or AWS URLs may live in the app.
    static let productionSiteURL = URL(string: "https://www.aptekavatan.tj")!

    #if DEBUG
    /// Debug builds can point at a Vercel preview deployment (set in the «Дизайн» panel).
    static let siteOverrideKey = "debug.siteBaseURL"
    /// Vercel «Protection Bypass for Automation» secret for protected preview deployments.
    /// Typed into the debug panel on the device; never committed or used in Release.
    static let vercelBypassKey = "debug.vercelBypass"

    static var vercelBypassToken: String? {
        guard UserDefaults.standard.string(forKey: siteOverrideKey) != nil,
              let token = UserDefaults.standard.string(forKey: vercelBypassKey), !token.isEmpty else { return nil }
        return token
    }
    #endif

    static var siteBaseURL: URL {
        #if DEBUG
        if let text = UserDefaults.standard.string(forKey: siteOverrideKey),
           let url = URL(string: text), url.scheme == "https", url.host != nil {
            return url
        }
        #endif
        return productionSiteURL
    }
}

/// Page metadata returned by `/api/search`.
struct PageInfo: Decodable {
    let nextCursor: String?
    let hasMore: Bool
    let totalItems: Int?

    enum CodingKeys: String, CodingKey {
        case nextCursor = "next_cursor"
        case hasMore = "has_more"
        case totalItems = "total_items"
    }
}

struct SearchResponse: Decodable {
    let data: [Medicine]
    let page: PageInfo
    let didYouMean: String?

    enum CodingKeys: String, CodingKey {
        case data
        case page
        case didYouMean = "did_you_mean"
    }
}

/// `{ "data": T, "request_id": ... }`
struct DataEnvelope<T: Decodable>: Decodable {
    let data: T
}

struct CategoriesResponse: Decodable {
    let data: [MedicineCategory]
}

struct NumberedPage: Decodable {
    let number: Int
    let totalPages: Int
    let totalItems: Int

    enum CodingKeys: String, CodingKey {
        case number
        case totalPages = "total_pages"
        case totalItems = "total_items"
    }
}

struct CategoryMedicinesResponse: Decodable {
    struct Payload: Decodable {
        let medicines: [Medicine]
    }

    let data: Payload
    let page: NumberedPage
}

/// Public pharmacy contacts from `/api/site-settings`.
struct SiteSettings: Decodable {
    let deliveryContactPhone: String?

    enum CodingKeys: String, CodingKey {
        case deliveryContactPhone = "delivery_contact_phone"
    }
}

struct BannersPayload: Decodable {
    let banners: [HomeBanner]
}

struct CarouselsPayload: Decodable {
    let carousels: [ProductCarousel]
}

private struct APIErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
        let message: String?
    }

    let error: Body
}

enum APIError: Error {
    case offline
    /// 429; `message` is the server's Russian text (e.g. the tracking guard's block notice).
    case rateLimited(message: String?)
    case notFound
    case server(code: String?)
    case invalidResponse

    /// Human-readable Russian message without technical details.
    var message: String {
        switch self {
        case .offline:
            return "Нет подключения к интернету. Проверьте сеть и попробуйте снова."
        case .rateLimited(let message?):
            return message
        case .rateLimited:
            return "Слишком много запросов. Подождите немного и попробуйте снова."
        case .notFound:
            return "Не найдено."
        case .server, .invalidResponse:
            return "Не удалось загрузить данные. Попробуйте ещё раз."
        }
    }
}

/// Thin client for the public website API (`GET` routes retry with a short backoff).
final class APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let fixedBaseURL: URL?
    private let decoder = JSONDecoder()

    /// Read per request so the debug site override applies without reinstalling.
    private var baseURL: URL { fixedBaseURL ?? AppConfig.siteBaseURL }

    init(baseURL: URL? = nil, session: URLSession? = nil) {
        self.fixedBaseURL = baseURL
        if let session = session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 15
            configuration.waitsForConnectivity = false
            self.session = URLSession(configuration: configuration)
        }
    }

    /// `GET /api/search?q=&limit=&cursor=`
    func searchMedicines(query: String, limit: Int = 24, cursor: String? = nil) async throws -> SearchResponse {
        var items = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        if let cursor = cursor {
            items.append(URLQueryItem(name: "cursor", value: cursor))
        }
        return try await get("api/search", queryItems: items)
    }

    /// `GET /api/medicines/{medicine_id}` — fresh price and availability for the product page.
    func medicine(id: Int) async throws -> Medicine {
        let response: DataEnvelope<Medicine> = try await get("api/medicines/\(id)", queryItems: [])
        return response.data
    }

    /// `GET /api/categories?limit=` — active categories in configured order.
    func categories(limit: Int = 50) async throws -> [MedicineCategory] {
        let response: CategoriesResponse = try await get(
            "api/categories",
            queryItems: [URLQueryItem(name: "limit", value: String(limit))]
        )
        return response.data
    }

    /// `GET /api/categories/{slug}/medicines?page=&limit=` — available medicines, numbered pages.
    func categoryMedicines(slug: String, page: Int = 1, limit: Int = 24) async throws -> CategoryMedicinesResponse {
        try await get(
            "api/categories/\(slug)/medicines",
            queryItems: [
                URLQueryItem(name: "page", value: String(page)),
                URLQueryItem(name: "limit", value: String(limit)),
            ]
        )
    }

    /// `GET /api/homepage-banners` — active homepage banners, no key or login.
    /// Live format: `{"banners": [...]}` at the JSON root (src/lib/public-banners.ts on main).
    func homepageBanners() async throws -> [HomeBanner] {
        let response: BannersPayload = try await get("api/homepage-banners", queryItems: [])
        return response.banners
    }

    /// `GET /api/product-carousels` — the website's homepage carousels, no key or login.
    /// Live format: `{"carousels": [...]}` at the JSON root (src/lib/public-carousels.ts on main).
    func productCarousels() async throws -> [ProductCarousel] {
        let response: CarouselsPayload = try await get("api/product-carousels", queryItems: [])
        return response.carousels
    }

    /// `POST /api/tracking` — orders for an exact phone number, newest first (max 20).
    /// Safe to retry: it only reads.
    func trackOrders(phone: String) async throws -> [PublicOrder] {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/tracking"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        #if DEBUG
        if let bypass = AppConfig.vercelBypassToken {
            request.setValue(bypass, forHTTPHeaderField: "x-vercel-protection-bypass")
        }
        #endif
        let local = phone.hasPrefix(TajikPhone.countryCode) ? String(phone.dropFirst(TajikPhone.countryCode.count)) : phone
        request.httpBody = try JSONEncoder().encode(["phone": local])
        let response: DataEnvelope<[PublicOrder]> = try await perform(request)
        return response.data
    }

    /// `GET /api/site-settings` — public pharmacy contacts (delivery phone).
    func siteSettings() async throws -> SiteSettings {
        try await get("api/site-settings", queryItems: [])
    }

    /// `POST /api/checkout`. Never retried automatically: a retry must reuse the same
    /// `idempotencyKey`, which the caller owns (API_CONTRACT §6).
    func createOrder(_ order: CreateOrderRequest, idempotencyKey: UUID) async throws -> PublicOrder {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/checkout"))
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(idempotencyKey.uuidString.lowercased(), forHTTPHeaderField: "Idempotency-Key")
        #if DEBUG
        if let bypass = AppConfig.vercelBypassToken {
            request.setValue(bypass, forHTTPHeaderField: "x-vercel-protection-bypass")
        }
        #endif
        request.httpBody = try JSONEncoder().encode(order)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as URLError where error.code == .notConnectedToInternet || error.code == .networkConnectionLost {
            throw OrderError.offline
        } catch {
            // Timeout etc.: the server may have created the order; retry with the same key.
            throw OrderError.server
        }

        guard let http = response as? HTTPURLResponse else { throw OrderError.server }
        if (200..<300).contains(http.statusCode) {
            guard let envelope = try? decoder.decode(DataEnvelope<PublicOrder>.self, from: data) else {
                throw OrderError.server
            }
            return envelope.data
        }

        let body = try? decoder.decode(APIErrorEnvelope.self, from: data)
        switch (http.statusCode, body?.error.code) {
        case (429, _): throw OrderError.rateLimited(message: body?.error.message)
        case (_, "ORDER_ITEMS_UNAVAILABLE"), (_, "CATALOG_PRICE_INVALID"): throw OrderError.itemsUnavailable(medicineIds: [])
        case (_, "MEDICINE_NOT_FOUND"): throw OrderError.medicineNotFound(medicineIds: [])
        case (_, "MINIMUM_ORDER_NOT_REACHED"): throw OrderError.minimumNotReached
        case (_, "IDEMPOTENCY_CONFLICT"): throw OrderError.idempotencyConflict
        case (400, _): throw OrderError.validation(message: nil)
        default: throw OrderError.server
        }
    }

    private func get<T: Decodable>(_ path: String, queryItems: [URLQueryItem]) async throws -> T {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidResponse
        }
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else { throw APIError.invalidResponse }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        #if DEBUG
        if let bypass = AppConfig.vercelBypassToken {
            request.setValue(bypass, forHTTPHeaderField: "x-vercel-protection-bypass")
        }
        #endif

        let maxAttempts = 3
        var attempt = 0
        while true {
            attempt += 1
            do {
                return try await perform(request)
            } catch let error as APIError {
                guard attempt < maxAttempts, error.isRetryable else { throw error }
            }
            // 0.5 s, 1 s backoff; throws CancellationError if the search was replaced.
            try await Task.sleep(nanoseconds: UInt64(attempt) * 500_000_000)
        }
    }

    private func perform<T: Decodable>(_ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch let error as URLError where error.code == .notConnectedToInternet || error.code == .networkConnectionLost {
            throw APIError.offline
        } catch is URLError {
            throw APIError.server(code: nil)
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 429 {
                throw APIError.rateLimited(message: (try? decoder.decode(APIErrorEnvelope.self, from: data))?.error.message)
            }
            if http.statusCode == 404 { throw APIError.notFound }
            let code = (try? decoder.decode(APIErrorEnvelope.self, from: data))?.error.code
            throw APIError.server(code: code)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }
}

private extension APIError {
    var isRetryable: Bool {
        switch self {
        case .server(let code): return code == nil || code == "INTERNAL_ERROR"
        case .offline, .rateLimited, .notFound, .invalidResponse: return false
        }
    }
}
