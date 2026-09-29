// Sample SwiftUI screen (not compiled in this repo; see README "Quick start").
import FlipperWidget
import ReownAppKit
import SwiftUI

struct FlipScreen: View {
    @StateObject private var model = WalletModel()
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView {
            FlipperWidgetView(
                config: FlipperConfig(partner: "acme", branding: false, extra: ["brandName": "Acme Flip"]),
                theme: FlipperTheme(mode: colorScheme == .dark ? .dark : .light, accent: "#ff5a1f", radius: 20),
                wallet: model.wallet
            )
            .onFlipperConnectRequest { _ in AppKit.present() }
            .onFlipperFlipSettled { event in
                if event.pending != true { print("flip \(event.flipId ?? "?") \(event.outcome ?? "")") }
            }
            .onFlipperError { print("flipper error:", $0.message ?? "") }
            .padding()
        }
    }
}

@MainActor
final class WalletModel: ObservableObject {
    let wallet = ReownAppKitFlipperWallet()
}
