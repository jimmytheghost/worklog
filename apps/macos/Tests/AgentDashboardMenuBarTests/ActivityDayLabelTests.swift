import Foundation
import Testing
@testable import AgentDashboardMenuBar

@Suite("Heatmap calendar day labels")
struct ActivityDayLabelTests {
    @Test(arguments: [
        ("2026-09-01", "Sep 1"),
        ("2026-09-02", "Sep 2"),
        ("2026-01-01", "Jan 1"),
        ("2026-03-08", "Mar 8"),
        ("2026-11-01", "Nov 1"),
    ])
    func preservesLedgerDate(date: String, expected: String) {
        #expect(ActivityDayLabel.formatted(date, locale: Locale(identifier: "en_US")) == expected)
    }

    @Test func leavesUnrecognizedDatesReadable() {
        #expect(ActivityDayLabel.formatted("unavailable") == "unavailable")
    }
}
