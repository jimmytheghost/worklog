import Foundation
import Testing
@testable import AgentDashboardMenuBar

private final class RefreshURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let result: (Int, String)
        do {
            result = try Self.handler!(request)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        let (status, body) = result
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite("Refresh monitoring", .serialized)
struct SnapshotStoreTests {
    @Test @MainActor
    func retriesStartupAfterAnEarlierLaunchFailed() async throws {
        try await checkServiceRecovery(refresh: false)
    }

    @Test @MainActor
    func refreshRestartsAStoppedService() async throws {
        try await checkServiceRecovery(refresh: true)
    }

    @MainActor
    private func checkServiceRecovery(refresh: Bool) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RefreshURLProtocol.self]
        let session = URLSession(configuration: config)
        let cache = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer {
            session.invalidateAndCancel()
            RefreshURLProtocol.handler = nil
            try? FileManager.default.removeItem(at: cache)
        }
        var serviceRunning = false
        var launches = 0
        var syncs = 0
        RefreshURLProtocol.handler = { request in
            guard serviceRunning else { throw URLError(.cannotConnectToHost) }
            switch request.url!.path {
            case "/api/sync":
                syncs += 1
                return (202, "{}")
            case "/health":
                return (200, """
                {"githubSync":"succeeded","codexSync":"succeeded","codexAccountSync":"succeeded"}
                """)
            case "/api/snapshot":
                return (200, """
                {"schemaVersion":1,"generatedAt":"2026-11-10T12:00:00Z","timezone":"America/Denver","summary":[],"projects":[],"activityDays":[],"recentActivity":[],"sources":[]}
                """)
            default: return (503, "{}")
            }
        }
        let store = SnapshotStore(session: session, cacheURL: cache, serviceLauncher: {
            launches += 1
            if launches == 1 { throw URLError(.fileDoesNotExist) }
            serviceRunning = true
        })
        await store.load()
        #expect(launches == 1)
        #expect(store.snapshot == nil)
        if refresh {
            await store.refresh()
        } else {
            await store.load()
        }
        #expect(launches == 2)
        #expect(store.state == .ready)
        #expect(store.snapshot != nil)
        #expect(syncs == (refresh ? 1 : 0))

        // A later service exit can also recover within the same app session.
        serviceRunning = false
        if refresh {
            await store.refresh()
        } else {
            await store.load()
        }
        #expect(launches == 3)
        #expect(store.state == .ready)
    }

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
