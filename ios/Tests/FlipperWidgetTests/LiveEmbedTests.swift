#if os(iOS)
import WebKit
import XCTest
@testable import FlipperWidget

/// Against the real embed served by the web app in development (`pnpm dev:web` → http://localhost:3000/embed).
/// Skipped when nothing is listening. Checks what only the real page can: its transport detection, event payloads,
/// and that it takes the host's `wallet` message (it then never falls back to asking `eth_accounts`).
@MainActor
final class LiveEmbedTests: XCTestCase {
    private let base = URL(string: "http://localhost:3000/embed")!
    private let account = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" // anvil #0

    private func embedIsUp() async -> Bool {
        var request = URLRequest(url: base)
        request.timeoutInterval = 15 // a cold Next.js dev route can take a few seconds
        guard let (_, response) = try? await URLSession.shared.data(for: request) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    func testRealEmbedHandshake() async throws {
        guard await embedIsUp() else { throw XCTSkip("no dev server at \(base)") }

        var calls: [String] = []
        var events: [FlipperEvent] = []
        var logs: [String] = []
        // Over RPC this wallet claims no accounts: the address can only reach the widget through the `wallet` message.
        let wallet = FlipperWalletAdapter(accounts: [account], chainId: 31337) { method, _ in
            await MainActor.run { calls.append(method) }
            switch method {
            case "eth_accounts": return []
            case "eth_chainId": return "0x7a69"
            default: return .null
            }
        }
        let widget = FlipperWidgetUIView(
            config: FlipperConfig(chainId: 31337, partner: "ios-sdk-test"),
            theme: FlipperTheme(mode: .dark, accent: "#ff5a1f"),
            options: FlipperWidgetOptions(baseURL: base, allowInsecureLocalhost: true),
            wallet: wallet
        )
        widget.onEvent = { events.append($0) }
        widget.onLog = { logs.append($0) }
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        widget.frame = CGRect(x: 0, y: 0, width: 390, height: 700)
        window.addSubview(widget)
        window.isHidden = false
        defer { widget.removeFromSuperview() }

        let deadline = Date().addingTimeInterval(60)
        while Date() < deadline, !events.contains(where: { $0.name == "ready" }) {
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        guard case .ready(let ready)? = events.first(where: { $0.name == "ready" }) else {
            return XCTFail("no ready event from the real embed; log: \(logs.suffix(10))")
        }
        XCTAssertNotNil(ready.version, "ready carries the widget version")
        XCTAssertEqual(ready.partner, "ios-sdk-test")

        func accountChip() async throws -> String {
            try await withCheckedThrowingContinuation { c in
                widget.webView.evaluateJavaScript(
                    "(function(){var el=document.querySelector('flipper-widget');var b=el&&el.shadowRoot&&el.shadowRoot.querySelector('[part=account]');return b?b.textContent.replace(/\\s+/g,' ').trim():'none';})()"
                ) { v, e in
                    if let e { c.resume(throwing: e) } else { c.resume(returning: (v as? String) ?? "nil") }
                }
            }
        }
        // the element reads eth_accounts at attach time (before ready); the wallet message after ready connects it
        var chip = ""
        let connectBy = Date().addingTimeInterval(10)
        while Date() < connectBy {
            chip = try await accountChip()
            if chip.contains("0xf39F") { break }
            try await Task.sleep(nanoseconds: 200_000_000)
        }
        XCTAssertTrue(chip.contains("0xf39F") && chip.contains("2266"), "account chip: \(chip); wallet calls: \(calls)")

        // chain change pushed as a wallet message: the widget flags the wrong network, then recovers
        wallet.update(chainId: 4663)
        try await Task.sleep(nanoseconds: 800_000_000)
        let wrong = try await accountChip()
        XCTAssertFalse(wrong.contains("0xf39F"), "wrong-network state expected, got: \(wrong)")
        wallet.update(chainId: 31337)
        try await Task.sleep(nanoseconds: 800_000_000)
        let back = try await accountChip()
        XCTAssertTrue(back.contains("0xf39F"), "back on the right chain: \(back)")
        XCTAssertTrue(events.contains { $0.name == "resize" }, "the embed reports its height")
        XCTAssertGreaterThan(widget.contentHeight, 120)

        let host: String? = try await withCheckedThrowingContinuation { c in
            widget.webView.evaluateJavaScript("String(typeof window.FlipperHost === 'object' && Object.isFrozen(window.FlipperHost) && window.FlipperBridge.version)") { v, e in
                if let e { c.resume(throwing: e) } else { c.resume(returning: v as? String) }
            }
        }
        XCTAssertEqual(host, "1", "FlipperHost injected despite the page CSP, and the embed's bridge is v1")

        // live config round trip: no reload, no errors
        widget.theme = FlipperTheme(mode: .light, accent: "#4cc2ff")
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertFalse(events.contains { if case .error = $0 { return true } else { return false } }, "\(events)")
        print("LIVE EMBED ready=\(ready.raw.jsonString) height=\(widget.contentHeight) walletCalls=\(calls) chip=\(chip) wrongChain=\(wrong)")
    }
}
#endif
