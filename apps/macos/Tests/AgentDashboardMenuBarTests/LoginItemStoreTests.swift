import ServiceManagement
import Foundation
import Testing
@testable import AgentDashboardMenuBar

private final class FakeLoginItemService: LoginItemService {
    var status: SMAppService.Status = .notRegistered
    var registrationStatus: SMAppService.Status = .enabled
    var shouldFail = false
    var registrations = 0
    var unregistrations = 0

    func register() throws {
        registrations += 1
        if shouldFail { throw NSError(domain: "LoginItemTest", code: 1) }
        status = registrationStatus
    }

    func unregister() throws {
        unregistrations += 1
        if shouldFail { throw NSError(domain: "LoginItemTest", code: 1) }
        status = .notRegistered
    }
}

@Suite("Login item settings")
struct LoginItemStoreTests {
    @Test @MainActor
    func testToggleRegistersAndUnregistersWithoutDuplicateRequests() {
        let service = FakeLoginItemService()
        let store = LoginItemStore(service: service, isPackagedApp: true)
        store.setEnabled(true)
        store.setEnabled(true)
        #expect(store.isEnabled)
        #expect(service.registrations == 1)
        store.setEnabled(false)
        store.setEnabled(false)
        #expect(!store.isEnabled)
        #expect(service.unregistrations == 1)
    }

    @Test @MainActor
    func testFailedChangesKeepActualSystemStateAndCanBeRetried() {
        let service = FakeLoginItemService()
        let store = LoginItemStore(service: service, isPackagedApp: true)
        service.shouldFail = true
        store.setEnabled(true)
        #expect(!store.isEnabled)
        #expect(store.errorMessage != nil)
        service.shouldFail = false
        store.setEnabled(true)
        #expect(store.isEnabled)
        #expect(store.errorMessage == nil)
        service.shouldFail = true
        store.setEnabled(false)
        #expect(store.isEnabled)
        #expect(store.errorMessage != nil)
    }

    @Test @MainActor
    func testApprovalAndExternalChangesReflectSystemState() {
        let service = FakeLoginItemService()
        service.registrationStatus = .requiresApproval
        let store = LoginItemStore(service: service, isPackagedApp: true)
        store.setEnabled(true)
        #expect(!store.isEnabled)
        #expect(store.needsApproval)
        service.status = .enabled
        store.refresh()
        #expect(store.isEnabled)
        #expect(!store.needsApproval)
        service.status = .notRegistered
        store.refresh()
        #expect(!store.isEnabled)
    }

    @Test @MainActor
    func testUnpackagedBuildDoesNotRegister() {
        let service = FakeLoginItemService()
        let store = LoginItemStore(service: service, isPackagedApp: false)
        store.setEnabled(true)
        #expect(service.registrations == 0)
        #expect(!store.isEnabled)
    }
}
