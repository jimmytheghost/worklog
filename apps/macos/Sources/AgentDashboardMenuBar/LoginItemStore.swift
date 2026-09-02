import Foundation
import ServiceManagement

protocol LoginItemService {
    var status: SMAppService.Status { get }
    func register() throws
    func unregister() throws
}

extension SMAppService: LoginItemService {}

@MainActor
final class LoginItemStore: ObservableObject {
    @Published private(set) var status: SMAppService.Status
    @Published private(set) var errorMessage: String?
    let isPackagedApp: Bool

    private let service: any LoginItemService

    init(
        service: any LoginItemService = SMAppService.mainApp,
        isPackagedApp: Bool = Bundle.main.bundleURL.pathExtension == "app"
    ) {
        self.service = service
        self.isPackagedApp = isPackagedApp
        status = service.status
    }

    var isEnabled: Bool { status == .enabled }
    var needsApproval: Bool { status == .requiresApproval }

    func refresh() {
        status = service.status
    }

    func setEnabled(_ enabled: Bool) {
        guard isPackagedApp else { return }
        errorMessage = nil
        refresh()
        do {
            if enabled {
                if needsApproval {
                    SMAppService.openSystemSettingsLoginItems()
                } else if !isEnabled {
                    try service.register()
                }
            } else if status == .enabled || status == .requiresApproval {
                try service.unregister()
            }
        } catch {
            errorMessage = "Couldn’t change startup setting. \(error.localizedDescription)"
        }
        // macOS is the source of truth, including failed changes and revocations.
        refresh()
    }
}
