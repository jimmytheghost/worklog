import AppKit

// Deterministic vector artwork, rasterized at each macOS icon resolution.
// Run from any directory: swift apps/macos/scripts/generate-icon.swift
let packageDirectory = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent()
let resources = packageDirectory.appendingPathComponent("Resources")
let iconset = packageDirectory.appendingPathComponent(".build/Worklog.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

func render(pixels: Int) -> Data {
    let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
    )!
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.current = context
    context.cgContext.scaleBy(x: CGFloat(pixels) / 1024, y: CGFloat(pixels) / 1024)

    let tile = NSBezierPath(roundedRect: NSRect(x: 80, y: 80, width: 864, height: 864), xRadius: 194, yRadius: 194)
    NSGraphicsContext.saveGraphicsState()
    let shadow = NSShadow()
    shadow.shadowColor = NSColor.black.withAlphaComponent(0.24)
    shadow.shadowBlurRadius = 24
    shadow.shadowOffset = NSSize(width: 0, height: -10)
    shadow.set()
    NSColor(calibratedWhite: 0.12, alpha: 1).setFill()
    tile.fill()
    NSGraphicsContext.restoreGraphicsState()

    NSGradient(colors: [
        NSColor(calibratedRed: 0.09, green: 0.12, blue: 0.14, alpha: 1),
        NSColor(calibratedRed: 0.19, green: 0.23, blue: 0.25, alpha: 1),
    ])!.draw(in: tile, angle: 90)
    NSColor.white.withAlphaComponent(0.12).setStroke()
    tile.lineWidth = 2
    tile.stroke()

    // A continuous activity trace, matching the header's mint pulse symbol.
    let trace = NSBezierPath()
    trace.move(to: NSPoint(x: 242, y: 518))
    for point in [
        NSPoint(x: 336, y: 518), NSPoint(x: 397, y: 652),
        NSPoint(x: 473, y: 354), NSPoint(x: 560, y: 680),
        NSPoint(x: 631, y: 518), NSPoint(x: 782, y: 518),
    ] {
        trace.line(to: point)
    }
    trace.lineWidth = 48
    trace.lineCapStyle = .round
    trace.lineJoinStyle = .round
    NSColor(calibratedRed: 0.40, green: 0.91, blue: 0.77, alpha: 1).setStroke()
    trace.stroke()

    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])!
}

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let suffix = scale == 2 ? "@2x" : ""
        let data = render(pixels: size * scale)
        try data.write(to: iconset.appendingPathComponent("icon_\(size)x\(size)\(suffix).png"))
        if size == 512 && scale == 2 {
            try data.write(to: resources.appendingPathComponent("Worklog.png"))
        }
    }
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o", resources.appendingPathComponent("Worklog.icns").path]
try process.run()
process.waitUntilExit()
guard process.terminationStatus == 0 else { exit(process.terminationStatus) }
print("Generated Resources/Worklog.icns and Worklog.png")
