import AppKit
import SwiftUI

private struct OverviewHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

struct DashboardMenuView: View {
    @ObservedObject var store: SnapshotStore
    @StateObject private var loginItem = LoginItemStore()
    @State private var showingSettings = false
    @State private var overviewHeight: CGFloat = 480

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if showingSettings {
                    SettingsView(loginItem: loginItem) { showingSettings = false }
                } else if let snapshot = store.snapshot {
                    content(snapshot)
                } else if case let .error(message) = store.state {
                    emptyState(title: "Worklog is offline", detail: message, icon: "wifi.slash")
                } else {
                    emptyState(title: "Loading your worklog", detail: "Reading the local ledger…", icon: "clock")
                }
            }
            Divider()
            actions
        }
        .frame(width: 360)
        .background(Color(nsColor: .windowBackgroundColor))
        .task { await store.load() }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.mint)
                .frame(width: 30, height: 30)
                .background(.mint.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 2) {
                Text("Worklog").font(.headline)
                statusLine
            }
            Spacer()
            if store.state == .refreshing || store.periodIsLoading {
                ProgressView().controlSize(.small)
            }
            Button {
                showingSettings.toggle()
            } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(showingSettings ? Color.mint : Color.secondary)
                    .frame(width: 26, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(showingSettings ? "Back to overview" : "Settings")
            .accessibilityLabel(showingSettings ? "Back to overview" : "Settings")
        }
        .padding(14)
    }

    private var periodMenu: some View {
        Menu {
            ForEach(ActivityPeriod.allCases) { period in
                Button {
                    store.selectPeriod(period)
                } label: {
                    if store.selectedPeriod == period {
                        Label(period.title, systemImage: "checkmark")
                    } else {
                        Text(period.title)
                    }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Text(store.selectedPeriod.title)
                    .font(.caption.weight(.semibold))
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .bold))
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 7))
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel("Activity range")
    }

    @ViewBuilder
    private var statusLine: some View {
        switch store.state {
        case .loading:
            Text("Loading local activity…").foregroundStyle(.secondary)
        case .startingService:
            Text("Starting the local ledger…").foregroundStyle(.secondary)
        case .refreshing:
            Text("Refreshing collectors…").foregroundStyle(.secondary)
        case let .error(message):
            Text(message).foregroundStyle(.orange)
        case .ready:
            Text(store.snapshot?.syncSummary ?? "Ready").foregroundStyle(.secondary)
        }
    }

    private func content(_ snapshot: DashboardSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 14) {
                    ActivityHeatmapView(days: snapshot.heatmapDays)
                    codexAccountUsage(snapshot.codexAccount)
                }
                .background {
                    GeometryReader { geometry in
                        Color.clear.preference(key: OverviewHeightKey.self, value: geometry.size.height)
                    }
                }

                LazyVGrid(columns: columns, spacing: 8) {
                    metric("Observed tokens", store.metric("codex_observed_tokens"), "sparkles")
                    metric("Commits", store.metric("commits"), "point.topleft.down.to.point.bottomright.curvepath")
                    metric("Pushes", store.metric("pushes"), "arrow.up.circle")
                    metric("Active days", store.metric("active_days"), "calendar")
                    metric("Projects", store.metric("active_projects"), "folder")
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("RECENT WORK").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    if store.meaningfulActivity.isEmpty {
                        Text("No recent commits or pushes yet.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 10)
                    } else {
                        ForEach(store.meaningfulActivity) { activity in
                            activityRow(activity)
                        }
                    }
                }
            }
            .padding(14)
        }
        // Fit the overview without extra viewport allowance, keeping the next
        // row of metrics below the action bar until the user scrolls.
        .frame(height: overviewHeight, alignment: .top)
        .onPreferenceChange(OverviewHeightKey.self) { height in
            if height > 0 { overviewHeight = height }
        }
    }

    @ViewBuilder
    private func codexAccountUsage(_ account: DashboardSnapshot.CodexAccount?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("CODEX ACCOUNT")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(account?.planType?.replacingOccurrences(of: "_", with: " ").capitalized ?? "Usage unavailable")
                        .font(.callout.weight(.semibold))
                }
                Spacer()
                if let resetCount = account?.bankedResetCount {
                    Label("\(Int(resetCount)) banked", systemImage: "arrow.counterclockwise.circle")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                periodMenu
            }

            if let account, !account.windows.isEmpty {
                ForEach(Array(account.gaugeWindows.enumerated()), id: \.offset) { _, item in
                    VStack(spacing: 5) {
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(Int(item.window.remainingPercent.rounded()))%")
                                .font(.title3.monospacedDigit().weight(.semibold))
                            TimelineView(.periodic(from: .now, by: 60)) { context in
                                Text("\(item.name.map { "\($0) · " } ?? "")\(item.window.remainingLabel(at: context.date))")
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .help("\(item.window.title) usage remaining" + (item.window.resetDate.map {
                                        " · Resets " + $0.formatted(.dateTime.weekday(.abbreviated).hour().minute())
                                    } ?? " · Reset time unavailable"))
                            }
                            Spacer()
                        }
                        ProgressView(value: item.window.remainingPercent, total: 100)
                            .tint(.mint)
                    }
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: 7) {
                    accountFact("Lifetime tokens", CompactNumber.format(account.tokenUsage.lifetimeTokens))
                    accountFact("Peak day", CompactNumber.format(account.tokenUsage.peakDailyTokens))
                    accountFact("Current streak", dayCount(account.tokenUsage.currentStreakDays))
                    accountFact("Best streak", dayCount(account.tokenUsage.longestStreakDays))
                    accountFact("Longest turn", minuteCount(account.tokenUsage.longestRunningTurnSeconds))
                    accountFact("Banked resets", CompactNumber.format(account.bankedResetCount))
                    accountFact("Credits", account.creditLabel)
                    ForEach(Array(account.sparkWindows.enumerated()), id: \.offset) { _, item in
                        accountFact("Spark · \(item.window.title)", "\(Int(item.window.remainingPercent.rounded()))%")
                            .accessibilityLabel("Codex Spark \(item.window.title): \(Int(item.window.remainingPercent.rounded())) percent remaining")
                            .help("Codex Spark \(item.window.title) usage remaining")
                    }
                }
            } else {
                Text("Sign in with Codex, then refresh Worklog.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(11)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 9))
    }

    private func accountFact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.caption.monospacedDigit().weight(.semibold))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func dayCount(_ value: Double?) -> String {
        value.map { "\(Int($0))d" } ?? "—"
    }

    private func minuteCount(_ seconds: Double?) -> String {
        seconds.map { "\(Int(($0 / 60).rounded()))m" } ?? "—"
    }

    private func metric(_ label: String, _ value: Double?, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Image(systemName: icon).font(.caption).foregroundStyle(.secondary)
            Text(CompactNumber.format(value)).font(.title3.monospacedDigit().weight(.semibold))
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 9))
    }

    private func activityRow(_ activity: DashboardSnapshot.Activity) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: activity.eventType == "github.push.observed" ? "arrow.up.circle.fill" : "checkmark.circle.fill")
                .foregroundStyle(activity.eventType == "github.push.observed" ? .blue : .mint)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(activity.summary).font(.callout).lineLimit(2)
                if let date = ISO8601DateFormatter().date(from: activity.occurredAt) {
                    Text(date, style: .relative).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
    }

    private func emptyState(title: String, detail: String, icon: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.title2).foregroundStyle(.secondary)
            Text(title).font(.headline)
            Text(detail).font(.callout).foregroundStyle(.secondary)
            if store.snapshot == nil {
                Button("Try Again") { Task { await store.load() } }
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
            }
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, minHeight: 190)
        .padding(20)
    }

    private var actions: some View {
        HStack(spacing: 8) {
            Button {
                Task { await store.refresh() }
            } label: {
                Label("Refresh now", systemImage: "arrow.clockwise")
            }
            .disabled(store.state == .refreshing)

            Button("Open Work History") {
                NSWorkspace.shared.open(store.workHistoryURL)
            }

            Spacer()

            Button {
                NSApplication.shared.terminate(nil)
            } label: {
                Image(systemName: "power")
            }
            .help("Quit Worklog")
        }
        .buttonStyle(.borderless)
        .padding(12)
    }
}
