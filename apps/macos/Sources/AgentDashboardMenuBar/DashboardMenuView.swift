import AppKit
import SwiftUI

struct DashboardMenuView: View {
    @ObservedObject var store: SnapshotStore

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            Group {
                if let snapshot = store.snapshot {
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
            periodMenu
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
                ActivityHeatmapView(days: snapshot.heatmapDays)

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
        // MenuBarExtra can lose the ScrollView's intrinsic height after the
        // window is destroyed and recreated. Keep a compact, stable viewport
        // so reopening the popover cannot collapse the dashboard to zero.
        .frame(minHeight: 320, maxHeight: 500, alignment: .top)
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
