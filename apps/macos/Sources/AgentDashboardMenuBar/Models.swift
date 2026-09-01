import Foundation

enum ActivityPeriod: String, CaseIterable, Codable, Identifiable {
    case day, week, month, year, all

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

struct PeriodSummary: Codable, Equatable {
    struct Metrics: Codable, Equatable {
        let tokens: Double?
        let commits: Double
        let pushes: Double
        let activeDays: Double
        let projects: Double
    }

    let schemaVersion: Int
    let period: ActivityPeriod
    let timezone: String
    let metrics: Metrics
    let recentActivity: [DashboardSnapshot.Activity]
}

struct DashboardSnapshot: Codable, Equatable {
    struct CodexAccount: Codable, Equatable {
        struct Window: Codable, Equatable {
            let usedPercent: Double
            let windowDurationMinutes: Double?
            let resetsAt: String?

            var remainingPercent: Double { max(0, min(100, 100 - usedPercent)) }
            var title: String {
                switch windowDurationMinutes {
                case 300: "5-hour"
                case 10_080: "Weekly"
                case 43_200, 43_800, 44_640: "Monthly"
                case let minutes?: minutes < 60 ? "\(Int(minutes))-minute" : "\(Int(minutes / 60))-hour"
                case nil: "Usage"
                }
            }
        }

        struct RateLimit: Codable, Equatable {
            let limitId: String
            let limitName: String?
            let primary: Window?
            let secondary: Window?
        }

        struct Credits: Codable, Equatable {
            let hasCredits: Bool
            let unlimited: Bool
            let balance: String?
        }

        struct TokenUsage: Codable, Equatable {
            let lifetimeTokens: Double?
            let peakDailyTokens: Double?
            let longestRunningTurnSeconds: Double?
            let currentStreakDays: Double?
            let longestStreakDays: Double?
        }

        let observedAt: String
        let planType: String?
        let rateLimits: [RateLimit]
        let bankedResetCount: Double?
        let credits: Credits?
        let tokenUsage: TokenUsage

        struct LabeledWindow: Equatable {
            let name: String?
            let window: Window
        }

        var windows: [LabeledWindow] {
            rateLimits.flatMap { limit in
                [limit.primary, limit.secondary]
                    .compactMap { $0 }
                    .map { LabeledWindow(name: limit.limitName, window: $0) }
            }
        }
        var creditLabel: String {
            if credits?.unlimited == true { return "Unlimited" }
            return credits?.balance ?? "—"
        }
    }

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

    struct DayActivity: Codable, Equatable, Identifiable {
        let date: String
        let commits: Double
        let pushes: Double

        var id: String { date }
    }

    let schemaVersion: Int
    let generatedAt: String
    let timezone: String
    let codexAccount: CodexAccount?
    let summary: [Metric]
    let projects: [Project]
    let recentActivity: [Activity]
    let sources: [Source]
    let activityDays: [DayActivity]?

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

    var heatmapDays: [DayActivity] {
        Array((activityDays ?? []).suffix(90))
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
