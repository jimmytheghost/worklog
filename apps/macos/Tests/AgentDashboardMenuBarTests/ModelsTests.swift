import Foundation
import Testing
@testable import AgentDashboardMenuBar

@Suite("Snapshot models")
struct ModelsTests {
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
}
