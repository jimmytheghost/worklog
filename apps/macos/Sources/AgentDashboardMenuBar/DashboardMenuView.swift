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
            if store.state == .refreshing {
                ProgressView().controlSize(.small)
            }
        }
        .padding(14)
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
                LazyVGrid(columns: columns, spacing: 8) {
                    metric("Observed tokens", snapshot.metric("codex_observed_tokens"), "sparkles")
                    metric("Commits", snapshot.metric("commits"), "point.topleft.down.to.point.bottomright.curvepath")
                    metric("Pushes", snapshot.metric("pushes"), "arrow.up.circle")
                    metric("Active days", snapshot.metric("active_days"), "calendar")
                    metric("Projects", snapshot.activeProjects, "folder")
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("RECENT WORK").font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                    if snapshot.meaningfulActivity.isEmpty {
                        Text("No recent commits or pushes yet.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 10)
                    } else {
                        ForEach(snapshot.meaningfulActivity) { activity in
                            activityRow(activity)
                        }
                    }
                }
            }
            .padding(14)
        }
        .frame(maxHeight: 500)
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
