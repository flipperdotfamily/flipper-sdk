// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "FlipperWidget",
    platforms: [
        .iOS(.v15),
        // macOS only so the Foundation-only bridge core and its tests build with `swift test` on a Mac; the widget
        // views are UIKit / SwiftUI-on-iOS.
        .macOS(.v12),
    ],
    products: [
        .library(name: "FlipperWidget", targets: ["FlipperWidget"]),
    ],
    targets: [
        .target(
            name: "FlipperWidget",
            path: "Sources/FlipperWidget"
        ),
        .testTarget(
            name: "FlipperWidgetTests",
            dependencies: ["FlipperWidget"],
            path: "Tests/FlipperWidgetTests"
        ),
    ]
)
