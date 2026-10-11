import Foundation
import Testing
@testable import AgentDashboardMenuBar

@Suite("Snapshot models")
struct ModelsTests {
    @Test func resetCountdownUsesActualTimeAndHandlesTimestampFormats() throws {
        typealias Window = DashboardSnapshot.CodexAccount.Window
        let now = try #require(ISO8601DateFormatter().date(from: "2026-10-11T21:00:00Z"))
        for timestamp in ["2026-10-11T23:14:00Z", "2026-10-11T23:14:00.000Z", "2026-10-11T17:14:00-06:00"] {
            let window = Window(usedPercent: 29, windowDurationMinutes: 300, resetsAt: timestamp)
            #expect(window.remainingLabel(at: now) == "2h 14m until reset")
            #expect(window.remainingLabel(at: now.addingTimeInterval(60)) == "2h 13m until reset")
            #expect(window.remainingLabel(at: now.addingTimeInterval(8_040)) == "Reset due · refresh")
            #expect(window.remainingLabel(at: now.addingTimeInterval(9_000)) == "Reset due · refresh")
            #expect(window.remainingPercent == 71)
        }
    }

    @Test func resetCountdownFormatsDaysAndRoundsUpPartialMinutes() throws {
        typealias Window = DashboardSnapshot.CodexAccount.Window
        let now = try #require(ISO8601DateFormatter().date(from: "2026-10-11T21:00:00Z"))
        let weekly = Window(usedPercent: 5, windowDurationMinutes: 10_080, resetsAt: "2026-10-13T23:14:00Z")
        #expect(weekly.remainingLabel(at: now) == "2d 2h 14m until reset")
        let short = Window(usedPercent: 29, windowDurationMinutes: 300, resetsAt: "2026-10-11T22:00:00Z")
        #expect(short.remainingLabel(at: now) == "1h until reset")
        #expect(short.remainingLabel(at: now.addingTimeInterval(3_599)) == "1m until reset")
        for timestamp: String? in [nil, "invalid"] {
            let missing = Window(usedPercent: 29, windowDurationMinutes: 300, resetsAt: timestamp)
            #expect(missing.remainingLabel(at: now) == "5-hour remaining")
        }
    }

    @Test func decodesSnapshotAndKeepsFiveMeaningfulEvents() throws {
        let activity = (0..<7).map { index in
            """
            {"eventId":"event-\(index)","eventType":"\(index == 1 ? "repository.discovered" : "git.commit.discovered")","occurredAt":"2026-08-31T0\(index):00:00Z","summary":"Event \(index)"}
            """
        }.joined(separator: ",")
        let json = """
        {
          "schemaVersion":1,
          "generatedAt":"2026-08-31T12:00:00Z",
          "timezone":"America/Denver",
          "summary":[
            {"metric":"commits","value":12,"unit":"count","freshness":"fresh"},
            {"metric":"codex_observed_tokens","value":4280300000,"unit":"tokens","freshness":"fresh"}
          ],
          "projects":[{"projectId":"github:1","name":"dashboard","status":"active"}],
          "activityDays":[{"date":"2026-08-30","commits":3,"pushes":2},{"date":"2026-08-31","commits":1,"pushes":4}],
          "recentActivity":[\(activity)],
          "sources":[{"sourceSystem":"github","status":"connected","freshness":"fresh","lastSucceededAt":"2026-08-31T11:59:00Z"}]
        }
        """

        let snapshot = try JSONDecoder().decode(DashboardSnapshot.self, from: Data(json.utf8))
        #expect(snapshot.metric("commits") == 12)
        #expect(snapshot.activeProjects == 1)
        #expect(snapshot.meaningfulActivity.count == 5)
        #expect(snapshot.heatmapDays.count == 2)
        #expect(snapshot.heatmapDays.last?.pushes == 4)
        #expect(!snapshot.meaningfulActivity.contains { $0.eventType == "repository.discovered" })
        #expect(snapshot.syncSummary == "Up to date")
    }

    @Test func compactNumberFormatting() {
        #expect(CompactNumber.format(nil) == "—")
        #expect(CompactNumber.format(999) == "999")
        #expect(CompactNumber.format(1_200) == "1.2K")
        #expect(CompactNumber.format(4_280_300_000) == "4.3B")
    }

    @Test func decodesPeriodSummary() throws {
        let json = """
        {"schemaVersion":1,"period":"month","timezone":"America/Denver","metrics":{"tokens":1200,"commits":8,"pushes":5,"activeDays":3,"projects":2},"recentActivity":[]}
        """
        let summary = try JSONDecoder().decode(PeriodSummary.self, from: Data(json.utf8))
        #expect(summary.period == .month)
        #expect(summary.metrics.projects == 2)
        #expect(ActivityPeriod.allCases.map(\.title) == ["Day", "Week", "Month", "Year", "All"])
    }

    @Test func staleSourceProducesCalmStatus() throws {
        let json = """
        {"schemaVersion":1,"generatedAt":"2026-08-31T12:00:00Z","timezone":"UTC","summary":[],"projects":[],"recentActivity":[],"sources":[{"sourceSystem":"github","status":"connected","freshness":"stale","lastSucceededAt":null}]}
        """
        let snapshot = try JSONDecoder().decode(DashboardSnapshot.self, from: Data(json.utf8))
        #expect(snapshot.syncSummary == "Cached data · refresh recommended")
    }

    @Test func separatesSparkFactsFromMainGauges() {
        typealias Account = DashboardSnapshot.CodexAccount
        let weekly = Account.Window(usedPercent: 51, windowDurationMinutes: 10_080, resetsAt: nil)
        let short = Account.Window(usedPercent: 12, windowDurationMinutes: 300, resetsAt: nil)
        let account = Account(
            observedAt: "2026-09-01T12:00:00Z", planType: "pro",
            rateLimits: [
                .init(limitId: "codex", limitName: nil, primary: weekly, secondary: nil),
                .init(limitId: "codex_spark", limitName: nil, primary: weekly, secondary: short),
            ],
            bankedResetCount: 1, credits: nil,
            tokenUsage: .init(lifetimeTokens: nil, peakDailyTokens: nil,
                             longestRunningTurnSeconds: nil, currentStreakDays: nil, longestStreakDays: nil)
        )

        #expect(account.gaugeWindows.count == 1)
        #expect(account.gaugeWindows.first?.limitId == "codex")
        #expect(account.sparkWindows.map { $0.window.title } == ["5-hour", "Weekly"])
        #expect(account.sparkWindows.map { $0.window.remainingPercent } == [88, 49])
        #expect(Account.LabeledWindow(limitId: "other", name: "GPT-5.3-Codex-Spark", window: weekly).isSpark)
        #expect(!Account.LabeledWindow(limitId: "codex", name: nil, window: weekly).isSpark)
    }

    @Test func decodesCodexAccountUsageAndBankedResets() throws {
        let json = """
        {"schemaVersion":1,"generatedAt":"2026-09-01T12:00:00Z","timezone":"America/Denver","codexAccount":{"observedAt":"2026-09-01T12:00:00Z","planType":"pro","rateLimits":[{"limitId":"codex","limitName":null,"primary":{"usedPercent":44,"windowDurationMinutes":10080,"resetsAt":"2026-09-07T02:28:17Z"},"secondary":null}],"bankedResetCount":1,"credits":{"hasCredits":false,"unlimited":false,"balance":"0"},"tokenUsage":{"lifetimeTokens":1234567,"peakDailyTokens":45678,"longestRunningTurnSeconds":540,"currentStreakDays":8,"longestStreakDays":14}},"summary":[],"projects":[],"recentActivity":[],"sources":[]}
        """

        let snapshot = try JSONDecoder().decode(DashboardSnapshot.self, from: Data(json.utf8))
        #expect(snapshot.codexAccount?.bankedResetCount == 1)
        #expect(snapshot.codexAccount?.windows.first?.window.remainingPercent == 56)
        #expect(snapshot.codexAccount?.windows.first?.window.title == "Weekly")
        #expect(snapshot.codexAccount?.tokenUsage.lifetimeTokens == 1_234_567)
    }
}
