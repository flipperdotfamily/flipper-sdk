#if os(iOS)
import WebKit
import XCTest
@testable import FlipperWidget

private let account = "0xAbC0000000000000000000000000000000000001"

/// Real WKWebView: the injected FlipperHost user script, the script message handler (origin / main-frame checks),
/// evaluateJavaScript delivery and the navigation policy, against the embed stub served "from" flipper.family.
@MainActor
final class WebViewIntegrationTests: XCTestCase {
    private var widget: FlipperWidgetUIView!
    /// WebKit only commits and runs pages for web views in a window hierarchy.
    private var window: UIWindow!
    private var wallet: FlipperWalletAdapter!
    private var calls: [(String, JSONValue)] = []
    private var events: [FlipperEvent] = []
    private var external: [URL] = []

    override func setUp() async throws {
        calls = []
        events = []
        external = []
        wallet = FlipperWalletAdapter(accounts: [account], chainId: 4663) { [weak self] method, params in
            await MainActor.run { self?.calls.append((method, params)) }
            switch method {
            case "eth_sendTransaction": return .string("0x" + String(repeating: "cd", count: 32))
            case "wallet_switchEthereumChain": throw FlipperRPCError(code: 4902, message: "Unrecognized chain")
            default: return .null
            }
        }
        widget = FlipperWidgetUIView(
            config: FlipperConfig(),
            theme: FlipperTheme(mode: .dark),
            options: FlipperWidgetOptions(),
            wallet: wallet,
            loadImmediately: false
        )
        widget.frame = CGRect(x: 0, y: 0, width: 390, height: 600)
        window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.addSubview(widget)
        window.isHidden = false
        widget.onEvent = { [weak self] in self?.events.append($0) }
        widget.onOpenExternalURL = { [weak self] in self?.external.append($0) }
        widget.loadHTMLForTesting(EmbedStub.html)
        try await waitFor("ready event", timeout: 30) { self.events.contains { $0.name == "ready" } }
    }

    override func tearDown() async throws {
        widget?.removeFromSuperview()
        widget = nil
        window = nil
    }

    private func waitFor(_ what: String, timeout: TimeInterval = 10, _ condition: @escaping () async -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await condition() { return }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTFail("timed out waiting for \(what)")
        throw CancellationError()
    }

    private func js(_ script: String) async throws -> String? {
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<String?, Error>) in
            widget.webView.evaluateJavaScript(script) { result, error in
                if let error { c.resume(throwing: error) } else { c.resume(returning: result as? String) }
            }
        }
    }

    private func stubJSON(_ expression: String) async throws -> JSONValue? {
        guard let text = try await js("JSON.stringify(\(expression)) || null") else { return nil }
        return try JSONValue.parse(text)
    }

    func testReadyWalletResizeAndFrozenHost() async throws {
        try await waitFor("wallet message") { (try? await self.stubJSON("__flipperStub.lastOf('wallet')")) != nil }
        let walletMessage = try await stubJSON("__flipperStub.lastOf('wallet')")
        XCTAssertEqual(walletMessage?["accounts"], [.string(account)])
        XCTAssertEqual(walletMessage?["chainId"], "0x1237")
        try await waitFor("resize") { self.widget.contentHeight == 489 }
        XCTAssertEqual(widget.intrinsicContentSize.height, 489)

        let frozen = try await js("(function(){ try { window.FlipperHost = null; } catch (e) {} return String(Object.isFrozen(window.FlipperHost) && typeof window.FlipperHost.postMessage === 'function'); })()")
        XCTAssertEqual(frozen, "true")
    }

    func testTransactionRoundTripAndErrors() async throws {
        _ = try await js("""
        __flipperStub.rpc('eth_sendTransaction', [{ from: '\(account)', to: '0x0000000000000000000000000000000000000002', data: '0x' }])
          .then(function (r) { window.__tx = r; }, function (e) { window.__tx = e; }); 'ok'
        """)
        _ = try await js("__flipperStub.rpc('eth_sign', ['0x1', '0x2']).then(null, function (e) { window.__denied = e; }); 'ok'")
        _ = try await js("__flipperStub.rpc('wallet_switchEthereumChain', [{ chainId: '0x1237' }]).then(null, function (e) { window.__switch = e; }); 'ok'")
        try await waitFor("rpc answers") {
            (try? await self.js("String(!!(window.__tx && window.__denied && window.__switch))")) == "true"
        }
        let tx = try await stubJSON("window.__tx")
        XCTAssertEqual(tx, .string("0x" + String(repeating: "cd", count: 32)))
        let denied = try await stubJSON("window.__denied")
        let switched = try await stubJSON("window.__switch")
        XCTAssertEqual(denied?["code"], 4200)
        XCTAssertEqual(switched?["code"], 4902)
        XCTAssertEqual(calls.first?.0, "eth_sendTransaction")
        XCTAssertEqual(calls.first?.1[0]?["from"], .string(account))
        XCTAssertFalse(calls.contains { $0.0 == "eth_sign" })
    }

    func testWalletChangesArePushed() async throws {
        try await waitFor("first wallet message") { (try? await self.stubJSON("__flipperStub.lastOf('wallet')")) != nil }
        wallet.update(chainId: .some(1))
        try await waitFor("chain change") { (try? await self.stubJSON("__flipperStub.lastOf('wallet').chainId")) == "0x1" }
        wallet.update(accounts: [])
        try await waitFor("disconnect") { (try? await self.stubJSON("__flipperStub.lastOf('wallet').accounts")) == [] }
        widget.theme = FlipperTheme(mode: .light, accent: "#ff5a1f")
        try await waitFor("live config") { (try? await self.stubJSON("__flipperStub.lastOf('config')")) != nil }
        let config = try await stubJSON("__flipperStub.lastOf('config')")
        XCTAssertEqual(config?["theme"], "light")
        XCTAssertEqual(config?["accent"], "#ff5a1f")
    }

    func testExternalLinksLeaveTheWidget() async throws {
        _ = try await js("document.getElementById('ext').click(); 'ok'")
        try await waitFor("external link") { !self.external.isEmpty }
        XCTAssertEqual(external.first?.host, "robinhoodchain.blockscout.com")
        _ = try await js("window.open('https://example.com/new'); 'ok'")
        try await waitFor("window.open") { self.external.count >= 2 }
        XCTAssertEqual(external.last?.host, "example.com")
        _ = try await js("location.href = 'javascript:void(0)'; 'ok'")
        XCTAssertEqual(widget.webView.url?.host, "flipper.family", "the widget stays on the embed")
        XCTAssertEqual(external.count, 2)
    }
}
#endif
