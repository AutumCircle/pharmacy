import Foundation

/// Site configuration. The app talks only to the public `/api/*` routes of the website.
enum AppConfig {
    /// HTTPS only; no secrets or AWS URLs may live in the app.
    static let productionSiteURL = URL(string: "https://www.aptekavatan.tj")!

    #if DEBUG
    /// Debug builds can point at a Vercel preview deployment (set in the «Дизайн» panel).
    static let siteOverrideKey = "debug.siteBaseURL"
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

struct BannersPayload: Decodable {
    let banners: [HomeBanner]
}

struct CarouselsPayload: Decodable {
    let carousels: [ProductCarousel]
}

private struct APIErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
    }

    let error: Body
}

enum APIError: Error {
    case offline
    case rateLimited
    case notFound
    case server(code: String?)
    case invalidResponse

    /// Human-readable Russian message without technical details.
    var message: String {
        switch self {
        case .offline:
            return "Нет подключения к интернету. Проверьте сеть и попробуйте снова."
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

    /// `GET /api/homepage-banners` — throws `.notFound` until the website exposes this route.
    func homepageBanners() async throws -> [HomeBanner] {
        let response: DataEnvelope<BannersPayload> = try await get("api/homepage-banners", queryItems: [])
        return response.data.banners
    }

    /// `GET /api/product-carousels` — throws `.notFound` until the website exposes this route.
    func productCarousels() async throws -> [ProductCarousel] {
        let response: DataEnvelope<CarouselsPayload> = try await get("api/product-carousels", queryItems: [])
        return response.data.carousels
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
            if http.statusCode == 429 { throw APIError.rateLimited }
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
