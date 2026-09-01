import Foundation

@MainActor
final class SnapshotStore: ObservableObject {
    enum State: Equatable {
        case loading
        case startingService
        case ready
        case refreshing
        case error(String)
    }

    @Published private(set) var snapshot: DashboardSnapshot?
    @Published private(set) var state: State

    private let baseURL: URL
    private let session: URLSession
    private let cacheURL: URL
    private var requestInFlight = false
    private var serviceLaunchAttempted = false

    init(
        baseURL: URL = URL(string: "http://127.0.0.1:4317")!,
        session: URLSession = .shared,
        cacheURL: URL? = nil
    ) {
        self.baseURL = baseURL
        self.session = session
        self.cacheURL = cacheURL ?? Self.defaultCacheURL
        let cachedSnapshot = Self.readCache(from: self.cacheURL)
        snapshot = cachedSnapshot
        state = cachedSnapshot == nil ? .loading : .ready
    }

    var workHistoryURL: URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        components.path = "/"
        components.queryItems = [URLQueryItem(name: "view", value: "history")]
        return components.url!
    }

    func load() async {
        guard !requestInFlight else { return }
        await fetchSnapshot(showLoading: snapshot == nil)
    }

    func refresh() async {
        guard !requestInFlight else { return }
        requestInFlight = true
        state = .refreshing
        defer { requestInFlight = false }

        do {
            var request = URLRequest(url: baseURL.appending(path: "api/sync"))
            request.httpMethod = "POST"
            request.timeoutInterval = 120
            let (_, response) = try await session.data(for: request)
            try Self.requireSuccess(response)
            try await fetchSnapshotWhileLocked()
        } catch {
            state = .error(Self.calmMessage(for: error, cached: snapshot != nil))
        }
    }

    private func fetchSnapshot(showLoading: Bool) async {
        requestInFlight = true
        if showLoading { state = .loading }
        defer { requestInFlight = false }

        do {
            try await fetchSnapshotWhileLocked()
        } catch {
            if Self.isConnectionFailure(error), !serviceLaunchAttempted {
                serviceLaunchAttempted = true
                do {
                    try startLocalService()
                    state = .startingService
                    try await waitForLocalService()
                    return
                } catch {
                    state = .error(Self.calmMessage(for: error, cached: snapshot != nil))
                    return
                }
            }
            state = .error(Self.calmMessage(for: error, cached: snapshot != nil))
        }
    }

    private func startLocalService() throws {
        let environment = ProcessInfo.processInfo.environment
        let configuredRoot = Bundle.main.object(forInfoDictionaryKey: "AgentDashboardProjectRoot") as? String
        guard let projectRoot = configuredRoot ?? environment["AGENT_DASHBOARD_PROJECT_ROOT"],
              !projectRoot.isEmpty else {
            throw URLError(.fileDoesNotExist)
        }
        let launcher = URL(fileURLWithPath: projectRoot).appending(path: "launch.command")
        guard FileManager.default.isExecutableFile(atPath: launcher.path) else {
            throw URLError(.fileDoesNotExist)
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-l", launcher.path]
        process.currentDirectoryURL = URL(fileURLWithPath: projectRoot)
        process.environment = environment.merging(["DASHBOARD_OPEN_BROWSER": "0"]) { _, new in new }
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }

    private func waitForLocalService() async throws {
        for _ in 0..<120 {
            try await Task.sleep(for: .milliseconds(500))
            do {
                try await fetchSnapshotWhileLocked()
                return
            } catch {
                if !Self.isConnectionFailure(error) { throw error }
            }
        }
        throw URLError(.timedOut)
    }

    private func fetchSnapshotWhileLocked() async throws {
        var request = URLRequest(url: baseURL.appending(path: "api/snapshot"))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        let (data, response) = try await session.data(for: request)
        try Self.requireSuccess(response)
        let decoded = try JSONDecoder().decode(DashboardSnapshot.self, from: data)
        snapshot = decoded
        state = .ready
        try? Self.writeCache(data, to: cacheURL)
    }

    private static func requireSuccess(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }

    private static func isConnectionFailure(_ error: Error) -> Bool {
        guard let code = (error as? URLError)?.code else { return false }
        return code == .cannotConnectToHost || code == .cannotFindHost || code == .networkConnectionLost
    }

    private static var defaultCacheURL: URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support
            .appending(path: "AgentDashboard", directoryHint: .isDirectory)
            .appending(path: "snapshot.json")
    }

    private static func readCache(from url: URL) -> DashboardSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(DashboardSnapshot.self, from: data)
    }

    private static func writeCache(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: url, options: .atomic)
    }

    private static func calmMessage(for error: Error, cached: Bool) -> String {
        if cached { return "Showing cached data · service unavailable" }
        if (error as? URLError)?.code == .cannotConnectToHost {
            return "Local service isn’t running"
        }
        return "Dashboard data is temporarily unavailable"
    }
}
