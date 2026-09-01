import SwiftUI

@main
struct AgentDashboardMenuBarApp: App {
    @StateObject private var store = SnapshotStore()

    var body: some Scene {
        MenuBarExtra {
            DashboardMenuView(store: store)
        } label: {
            Label("Worklog", systemImage: menuBarSymbol)
        }
        .menuBarExtraStyle(.window)
    }

    private var menuBarSymbol: String {
        switch store.state {
        case .refreshing, .startingService: return "arrow.triangle.2.circlepath"
        case .error: return "exclamationmark.circle"
        default: return "waveform.path.ecg"
        }
    }
}
