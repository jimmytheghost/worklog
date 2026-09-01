import Foundation

struct DashboardSnapshot: Codable, Equatable {
    struct Metric: Codable, Equatable {
        let metric: String
        let value: Double?
        let unit: String
        let freshness: String
    }

    struct Project: Codable, Equatable {
        let projectId: String
        let name: String
        let status: String
    }

    struct Activity: Codable, Equatable, Identifiable {
        let eventId: String
        let eventType: String
        let occurredAt: String
        let summary: String

        var id: String { eventId }
        var isMeaningful: Bool {
            eventType == "git.commit.discovered" || eventType == "github.push.observed"
        }
    }

    struct Source: Codable, Equatable {
        let sourceSystem: String
        let status: String
        let freshness: String
        let lastSucceededAt: String?
    }

    let schemaVersion: Int
    let generatedAt: String
    let timezone: String
    let summary: [Metric]
    let projects: [Project]
    let recentActivity: [Activity]
    let sources: [Source]

    func metric(_ name: String) -> Double? {
        summary.first(where: { $0.metric == name })?.value
    }

    var activeProjects: Double? {
        if let measured = metric("active_projects") { return measured }
        return Double(projects.filter { $0.status == "active" }.count)
    }

    var meaningfulActivity: [Activity] {
        Array(recentActivity.filter(\.isMeaningful).prefix(5))
    }

    var syncSummary: String {
        let configured = sources.filter { $0.status != "not_configured" }
        if configured.isEmpty { return "Collectors not configured" }
        if configured.contains(where: { $0.status != "connected" }) { return "Collector needs attention" }
        if configured.contains(where: { $0.freshness == "stale" }) { return "Cached data · refresh recommended" }
        return "Up to date"
    }
}

enum CompactNumber {
    static func format(_ value: Double?) -> String {
        guard let value else { return "—" }
        let magnitude = abs(value)
        let divisor: Double
        let suffix: String
        switch magnitude {
        case 1_000_000_000...: (divisor, suffix) = (1_000_000_000, "B")
        case 1_000_000...: (divisor, suffix) = (1_000_000, "M")
        case 1_000...: (divisor, suffix) = (1_000, "K")
        default:
            return String(Int(value.rounded()))
        }
        let scaled = value / divisor
        return scaled.rounded() == scaled
            ? "\(Int(scaled))\(suffix)"
            : String(format: "%.1f%@", locale: Locale(identifier: "en_US_POSIX"), scaled, suffix)
    }
}
