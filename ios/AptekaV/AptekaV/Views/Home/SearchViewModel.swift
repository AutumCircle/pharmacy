import Foundation

/// Live medicine search against `/api/search`: debounced as the user types,
/// stale requests are cancelled, further pages load on scroll.
@MainActor
final class SearchViewModel: ObservableObject {
    enum State: Equatable {
        case idle
        case loading
        case loaded
        case empty
        case failed(String)
    }

    /// The API ignores queries shorter than this.
    static let minQueryLength = 2
    private static let pageSize = 24
    private static let debounceNanoseconds: UInt64 = 350_000_000

    @Published var query = ""
    @Published private(set) var results: [Medicine] = []
    @Published private(set) var state: State = .idle
    @Published private(set) var didYouMean: String?
    @Published private(set) var totalItems: Int?
    @Published private(set) var isLoadingMore = false

    private var nextCursor: String?
    private var hasMore = false
    private var loadMoreTask: Task<Void, Never>?
    private let client: APIClient

    init(client: APIClient = .shared) {
        self.client = client
    }

    /// Debug only: launch argument `-searchQuery TEXT` pre-fills the search (used for simulator
    /// screenshots). Applied after appearance because `.searchable` clears the text on setup.
    func applyLaunchQuery() async {
        #if DEBUG
        guard query.isEmpty, let launchQuery = UserDefaults.standard.string(forKey: "searchQuery"), !launchQuery.isEmpty else { return }
        try? await Task.sleep(nanoseconds: 300_000_000)
        query = launchQuery
        #endif
    }

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Called from `.task(id: query)`, so SwiftUI cancels the previous run on every keystroke.
    func queryChanged() async {
        loadMoreTask?.cancel()
        let term = trimmedQuery
        guard term.count >= Self.minQueryLength else {
            reset()
            return
        }

        do {
            try await Task.sleep(nanoseconds: Self.debounceNanoseconds)
        } catch {
            return
        }
        await runSearch(term)
    }

    func retry() async {
        let term = trimmedQuery
        guard term.count >= Self.minQueryLength else { return }
        await runSearch(term)
    }

    func applySuggestion() {
        guard let suggestion = didYouMean else { return }
        query = suggestion
    }

    /// Loads the next page when the last visible result appears.
    func loadMoreIfNeeded(current medicine: Medicine) {
        guard medicine.id == results.last?.id, hasMore, !isLoadingMore, let cursor = nextCursor else { return }
        let term = trimmedQuery
        isLoadingMore = true
        loadMoreTask = Task { [weak self] in
            guard let self = self else { return }
            defer { self.isLoadingMore = false }
            do {
                let response = try await self.client.searchMedicines(query: term, limit: Self.pageSize, cursor: cursor)
                guard !Task.isCancelled, term == self.trimmedQuery else { return }
                let known = Set(self.results.map(\.id))
                self.results.append(contentsOf: response.data.filter { !known.contains($0.id) })
                self.nextCursor = response.page.nextCursor
                self.hasMore = response.page.hasMore
            } catch {
                // Keep already loaded results; the next scroll to the bottom retries.
            }
        }
    }

    private func runSearch(_ term: String) async {
        if results.isEmpty { state = .loading }
        do {
            let response = try await client.searchMedicines(query: term, limit: Self.pageSize)
            guard !Task.isCancelled else { return }
            results = response.data
            nextCursor = response.page.nextCursor
            hasMore = response.page.hasMore
            totalItems = response.page.totalItems
            didYouMean = response.didYouMean
            state = response.data.isEmpty ? .empty : .loaded
        } catch is CancellationError {
            return
        } catch let error as APIError {
            guard !Task.isCancelled else { return }
            state = .failed(error.message)
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed(APIError.server(code: nil).message)
        }
    }

    private func reset() {
        results = []
        nextCursor = nil
        hasMore = false
        totalItems = nil
        didYouMean = nil
        isLoadingMore = false
        state = .idle
    }
}
