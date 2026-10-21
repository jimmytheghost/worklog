import Foundation
import Testing
@testable import AgentDashboardMenuBar

private final class RefreshURLProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, body) = Self.handler!(request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite("Refresh monitoring", .serialized)
struct SnapshotStoreTests {
    @Test @MainActor
    func showsCompletedUpdatesWhileLocalSessionsAreStillRunning() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RefreshURLProtocol.self]
        let session = URLSession(configuration: config)
        let cache = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer {
            session.invalidateAndCancel()
            RefreshURLProtocol.handler = nil
            try? FileManager.default.removeItem(at: cache)
        }
        var healthReads = 0
        var snapshotReads = 0
        var usedAsyncPreference = false
        RefreshURLProtocol.handler = { request in
            switch request.url!.path {
            case "/api/sync":
                usedAsyncPreference = request.value(forHTTPHeaderField: "Prefer") == "respond-async" && request.timeoutInterval == 15
                return (202, "{\"status\":\"running\"}")
            case "/health":
                healthReads += 1
                return (200, """
                {"githubSync":"succeeded","codexSync":"\(healthReads == 1 ? "running" : "failed")","codexAccountSync":"succeeded"}
                """)
            case "/api/snapshot":
                snapshotReads += 1
                return (200, """
                {"schemaVersion":1,"generatedAt":"2026-10-20T12:00:00Z","timezone":"America/Denver","summary":[{"metric":"commits","value":\(snapshotReads),"unit":"count","freshness":"fresh"}],"projects":[],"activityDays":[],"recentActivity":[],"sources":[]}
                """)
            default: return (503, "{}")
            }
        }
        let store = SnapshotStore(session: session, cacheURL: cache)
        let task = Task { await store.refresh() }
        for _ in 0..<200 {
            if store.refreshDetail == "Refreshing Codex sessions…" { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        #expect(store.state == .refreshing)
        #expect(store.refreshDetail == "Refreshing Codex sessions…")
        #expect(store.snapshot?.metric("commits") == 2)
        #expect(usedAsyncPreference)
        await task.value
        #expect(healthReads == 2)
        #expect(store.snapshot?.metric("commits") == 3)
        #expect(store.state == .error("Some sources failed to refresh · showing available data"))
    }
}
