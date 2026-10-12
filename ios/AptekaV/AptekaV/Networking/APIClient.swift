import Foundation

/// Site configuration. The app talks only to the public `/api/*` routes of the website.
enum AppConfig {
    /// HTTPS only; no secrets or AWS URLs may live in the app.
    static let siteBaseURL = URL(string: "https://www.aptekavatan.tj")!
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

private struct APIErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String
    }

    let error: Body
}

enum APIError: Error {
    case offline
    case rateLimited
    case server(code: String?)
    case invalidResponse

    /// Human-readable Russian message without technical details.
    var message: String {
        switch self {
        case .offline:
            return "Нет подключения к интернету. Проверьте сеть и попробуйте снова."
        case .rateLimited:
            return "Слишком много запросов. Подождите немного и попробуйте снова."
        case .server, .invalidResponse:
            return "Не удалось выполнить поиск. Попробуйте ещё раз."
        }
    }
}

/// Thin client for the public website API (`GET` routes retry with a short backoff).
final class APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let baseURL: URL
    private let decoder = JSONDecoder()

    init(baseURL: URL = AppConfig.siteBaseURL, session: URLSession? = nil) {
        self.baseURL = baseURL
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

    private func get<T: Decodable>(_ path: String, queryItems: [URLQueryItem]) async throws -> T {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError.invalidResponse
        }
        components.queryItems = queryItems
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
        case .offline, .rateLimited, .invalidResponse: return false
        }
    }
}
