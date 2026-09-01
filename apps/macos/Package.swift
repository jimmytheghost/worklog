// swift-tools-version: 5.9

import PackageDescription
import Foundation

let commandLineToolsFrameworks = "/Library/Developer/CommandLineTools/Library/Developer/Frameworks"
let commandLineToolsLibraries = "/Library/Developer/CommandLineTools/Library/Developer/usr/lib"
let usesCommandLineToolsTesting = FileManager.default.fileExists(atPath: commandLineToolsFrameworks)

let package = Package(
    name: "AgentDashboardMenuBar",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "AgentDashboardMenuBar", targets: ["AgentDashboardMenuBar"]),
    ],
    targets: [
        .executableTarget(name: "AgentDashboardMenuBar"),
        .testTarget(
            name: "AgentDashboardMenuBarTests",
            dependencies: ["AgentDashboardMenuBar"],
            swiftSettings: usesCommandLineToolsTesting
                ? [.unsafeFlags(["-F", commandLineToolsFrameworks])]
                : [],
            linkerSettings: usesCommandLineToolsTesting
                ? [.unsafeFlags([
                    "-F", commandLineToolsFrameworks,
                    "-Xlinker", "-rpath", "-Xlinker", commandLineToolsFrameworks,
                    "-Xlinker", "-rpath", "-Xlinker", commandLineToolsLibraries,
                ])]
                : []
        ),
    ]
)
