import AppKit
import ServiceManagement
import SwiftUI

struct SettingsView: View {
    @ObservedObject var loginItem: LoginItemStore
    var close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("Settings").font(.headline)
                Spacer()
                Button("Done", action: close)
                    .buttonStyle(.borderless)
            }

            VStack(alignment: .leading, spacing: 8) {
                Toggle("Start on computer startup", isOn: Binding(
                    get: { loginItem.isEnabled },
                    set: { loginItem.setEnabled($0) }
                ))
                .toggleStyle(.switch)
                .controlSize(.small)
                .disabled(!loginItem.isPackagedApp)

                Text("Open Worklog in the menu bar when you sign in to your Mac.")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !loginItem.isPackagedApp {
                    Text("Open the packaged Worklog app to change this setting.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else if loginItem.needsApproval {
                    Text("Allow Worklog in macOS Login Items to enable startup.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Open Login Items…") {
                        SMAppService.openSystemSettingsLoginItems()
                    }
                    .controlSize(.small)
                }

                if let message = loginItem.errorMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .textSelection(.enabled)
                }
            }
            .padding(12)
            .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 9))
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(minHeight: 190)
        .onAppear { loginItem.refresh() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            loginItem.refresh()
        }
    }
}
