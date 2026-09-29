import Combine
import JavaScriptCore
import XCTest
@testable import FlipperWidget

private let origin = "https://flipper.family"
private let account = "0xAbC0000000000000000000000000000000000001"
private let main = FlipperMessageSource(origin: origin, isMainFrame: true)

/// One JavaScriptCore VM for the whole test process (several VMs torn down at exit crash the xctest runner).
let sharedJSVirtualMachine = JSVirtualMachine()!

/// Runs the JavaScript the bridge emits in JavaScriptCore against a capturing `window.FlipperBridge.receive`.
private final class PageSink {
    let context = JSContext(virtualMachine: sharedJSVirtualMachine)!
    private(set) var messages: [JSONValue] = []

    init() {
        let receive: @convention(block) (String) -> Void = { [weak self] json in
            self?.messages.append(try! JSONValue.parse(json))
        }
        context.setObject(receive, forKeyedSubscript: "__receive" as NSString)
        context.evaluateScript("var window = this; window.location = { origin: 'https://flipper.family' }; window.FlipperBridge = { receive: __receive };")
    }

    func run(_ js: String) {
        context.evaluateScript(js)
        if let exception = context.exception { XCTFail("JS exception: \(exception)") }
    }

    func last(_ type: String) -> JSONValue? { messages.last { $0["type"]?.stringValue == type } }
    func reply(_ id: JSONValue) -> JSONValue? {
        messages.first { ($0["type"]?.stringValue == "rpc-result" || $0["type"]?.stringValue == "rpc-error") && $0["id"] == id }
    }
}

private final class MockWallet: FlipperWalletAdapter {
    var calls: [(String, JSONValue)] = []
    var failures: [String: Error] = [:]
    var results: [String: JSONValue] = [:]
    var gate: CheckedContinuation<Void, Never>?
    var holds: Set<String> = []

    init() { super.init(accounts: [account], chainId: 4663) }

    override func request(method: String, params: JSONValue) async throws -> JSONValue {
        calls.append((method, params))
        if holds.contains(method) { await withCheckedContinuation { gate = $0 } }
        if let error = failures[method] { throw error }
        if let result = results[method] { return result }
        switch method {
        case "eth_accounts", "eth_requestAccounts": return .array(accounts.map(JSONValue.string))
        case "eth_chainId": return .string("0x1237")
        case "eth_sendTransaction": return .string("0x" + String(repeating: "ab", count: 32))
        default: return .null
        }
    }

    func release() { gate?.resume(); gate = nil }
}

@MainActor
final class BridgeCoreTests: XCTestCase {
    private var sink: PageSink!
    private var core: FlipperBridgeCore!
    private var events: [FlipperEvent] = []
    private var connects = 0
    private var heights: [Double] = []
    private var logs: [String] = []

    override func setUp() async throws {
        sink = PageSink()
        events = []
        connects = 0
        heights = []
        logs = []
        core = FlipperBridgeCore(embedOrigin: origin, chainId: 4663, evaluate: { [sink] js in sink!.run(js) })
        var h = FlipperBridgeHandlers()
        h.onEvent = { [weak self] in self?.events.append($0) }
        h.onConnectRequest = { [weak self] _ in self?.connects += 1 }
        h.onResize = { [weak self] in self?.heights.append($0) }
        h.log = { [weak self] in self?.logs.append($0) }
        core.handlers = h
    }

    private func post(_ message: JSONValue, source: FlipperMessageSource = main) {
        core.handleMessage(message.jsonString, source: source)
    }

    private func rpc(_ id: JSONValue, _ method: String, _ params: JSONValue = []) {
        post(["v": 1, "source": "flipper", "type": "rpc", "id": id, "method": .string(method), "params": params])
    }

    private func event(_ name: String, _ data: JSONValue = [:]) {
        post(["v": 1, "source": "flipper", "type": "event", "name": .string(name), "data": data])
    }

    /// Lets queued RPC tasks finish.
    private func settle() async {
        for _ in 0..<20 { await Task.yield() }
        try? await Task.sleep(nanoseconds: 5_000_000)
        for _ in 0..<20 { await Task.yield() }
    }

    // MARK: filtering

    func testDropsWrongSourceVersionAndGarbage() async {
        post(["v": 1, "source": "flipper-host", "type": "event", "name": "ready"])
        post(["v": 2, "source": "flipper", "type": "event", "name": "ready"])
        post(["v": "1", "source": "flipper", "type": "event", "name": "ready"])
        post(["v": true, "source": "flipper", "type": "event", "name": "ready"])
        core.handleMessage("not json", source: main)
        core.handleMessage("[1,2]", source: main)
        core.handleMessage(String(repeating: "x", count: FlipperConstants.maxMessageLength + 1), source: main)
        await settle()
        XCTAssertTrue(events.isEmpty)
        XCTAssertTrue(sink.messages.isEmpty)
    }

    func testDropsOtherOriginsAndSubFrames() async {
        let ready: JSONValue = ["v": 1, "source": "flipper", "type": "event", "name": "ready", "data": [:]]
        post(ready, source: FlipperMessageSource(origin: "https://evil.example", isMainFrame: true))
        post(ready, source: FlipperMessageSource(origin: "http://flipper.family", isMainFrame: true))
        post(ready, source: FlipperMessageSource(origin: nil, isMainFrame: true))
        post(ready, source: FlipperMessageSource(origin: origin, isMainFrame: false))
        await settle()
        XCTAssertTrue(events.isEmpty)
        XCTAssertTrue(logs.contains { $0.contains("sub-frame") })
        XCTAssertTrue(logs.contains { $0.contains("another origin") })
    }

    // MARK: RPC

    func testRoutesAllowlistedMethodsAndKeepsIds() async {
        let wallet = MockWallet()
        core.wallet = wallet
        let tx: JSONValue = ["from": .string(account), "to": "0x0000000000000000000000000000000000000002", "data": "0x"]
        rpc("f7", "eth_sendTransaction", [tx])
        rpc(42, "eth_chainId")
        await settle()
        XCTAssertEqual(wallet.calls.first?.0, "eth_sendTransaction")
        XCTAssertEqual(wallet.calls.first?.1, [tx])
        XCTAssertEqual(sink.reply("f7"), ["v": 1, "source": "flipper-host", "type": "rpc-result", "id": "f7", "result": .string("0x" + String(repeating: "ab", count: 32))])
        XCTAssertEqual(sink.reply(42)?["result"], "0x1237")
        XCTAssertNil(sink.reply("42"), "number ids stay numbers")
    }

    func testAllowlistAndNarrowing() async {
        let wallet = MockWallet()
        core.wallet = wallet
        for (i, m) in FlipperConstants.walletMethods.enumerated() { rpc(.string("ok\(i)"), m) }
        let denied = ["eth_sign", "eth_signTransaction", "eth_call", "wallet_sendCalls", "ETH_ACCOUNTS", "personal_sign", "eth_signTypedData_v4"]
        for (i, m) in denied.enumerated() { rpc(.string("no\(i)"), m) }
        await settle()
        for i in FlipperConstants.walletMethods.indices { XCTAssertEqual(sink.reply(.string("ok\(i)"))?["type"], "rpc-result") }
        for (i, m) in denied.enumerated() {
            XCTAssertEqual(sink.reply(.string("no\(i)"))?["error"], ["code": 4200, "message": .string("Unsupported method: \(m)")])
        }
        XCTAssertEqual(wallet.calls.count, FlipperConstants.walletMethods.count)
        XCTAssertEqual(FlipperConstants.walletMethods.count, 7)

        core.allowedMethods = ["eth_accounts", "eth_sign"]
        rpc("n1", "eth_accounts")
        rpc("n2", "wallet_watchAsset", ["type": "ERC20", "options": ["address": "0x0000000000000000000000000000000000000009", "symbol": "FLIPPER", "decimals": 18]])
        rpc("n3", "eth_sign")
        await settle()
        XCTAssertEqual(sink.reply("n1")?["type"], "rpc-result")
        XCTAssertEqual(sink.reply("n2")?["error"]?["code"], 4200)
        XCTAssertEqual(sink.reply("n3")?["error"]?["code"], 4200)
    }

    func testRefusesMessageSigningLikeEthSignEvenWhenListed() async {
        let signing = ["eth_sign", "personal_sign", "eth_signTypedData_v4"]
        XCTAssertTrue(Set(FlipperConstants.bridgeMethods).isDisjoint(with: signing))
        XCTAssertEqual(FlipperConstants.effectiveMethods(enableBatchCalls: true, allowedMethods: Set(signing)), [])
        let wallet = MockWallet()
        core.wallet = wallet
        core.enableBatchCalls = true
        core.allowedMethods = Set(signing)
        rpc("s1", "eth_sign", [.string(account), "0x00"])
        rpc("s2", "personal_sign", ["0x00", .string(account)])
        rpc("s3", "eth_signTypedData_v4", [.string(account), "{}"])
        await settle()
        for (i, m) in signing.enumerated() {
            XCTAssertEqual(sink.reply(.string("s\(i + 1)"))?["error"], ["code": 4200, "message": .string("Unsupported method: \(m)")])
        }
        XCTAssertTrue(wallet.calls.isEmpty)
    }

    func testBatchMethodsOptIn() async {
        let wallet = MockWallet()
        wallet.results["wallet_sendCalls"] = ["id": "0xbatch"]
        core.wallet = wallet
        // default: 4200, the wallet never sees them
        for (i, m) in FlipperConstants.batchCallMethods.enumerated() { rpc(.string("off\(i)"), m, [[:]]) }
        await settle()
        for (i, m) in FlipperConstants.batchCallMethods.enumerated() {
            XCTAssertEqual(sink.reply(.string("off\(i)"))?["error"], ["code": 4200, "message": .string("Unsupported method: \(m)")])
        }
        XCTAssertTrue(wallet.calls.isEmpty)

        // enabled: all 10 embed methods forwarded, nothing beyond them
        core.enableBatchCalls = true
        for (i, m) in FlipperConstants.bridgeMethods.enumerated() { rpc(.string("on\(i)"), m, [[:]]) }
        rpc("sign", "eth_sign", [.string(account), "0x00"])
        await settle()
        for i in FlipperConstants.bridgeMethods.indices { XCTAssertEqual(sink.reply(.string("on\(i)"))?["type"], "rpc-result") }
        XCTAssertEqual(sink.reply(.string("on\(FlipperConstants.bridgeMethods.firstIndex(of: "wallet_sendCalls")!)"))?["result"], ["id": "0xbatch"])
        XCTAssertEqual(sink.reply("sign")?["error"]?["code"], 4200)
        XCTAssertEqual(wallet.calls.count, 10)

        // allowedMethods narrows the batch set, and can't add batch methods without the flag
        core.allowedMethods = ["eth_sendTransaction", "wallet_getCapabilities"]
        rpc("n1", "wallet_getCapabilities", [.string(account)])
        rpc("n2", "wallet_sendCalls", [[:]])
        core.enableBatchCalls = false
        rpc("n3", "wallet_getCapabilities", [.string(account)])
        await settle()
        XCTAssertEqual(sink.reply("n1")?["type"], "rpc-result")
        XCTAssertEqual(sink.reply("n2")?["error"]?["code"], 4200)
        XCTAssertEqual(sink.reply("n3")?["error"]?["code"], 4200)
        XCTAssertEqual(FlipperConstants.effectiveMethods(enableBatchCalls: true, allowedMethods: ["eth_sign", "wallet_sendCalls"]), ["wallet_sendCalls"])
    }

    func testValidatesIdMethodParams() async {
        core.wallet = MockWallet()
        post(["v": 1, "source": "flipper", "type": "rpc", "method": "eth_accounts"])
        post(["v": 1, "source": "flipper", "type": "rpc", "id": ["x": 1], "method": "eth_accounts"])
        post(["v": 1, "source": "flipper", "type": "rpc", "id": "m"])
        post(["v": 1, "source": "flipper", "type": "rpc", "id": "p", "method": "eth_accounts", "params": "0x1"])
        post(["v": 1, "source": "flipper", "type": "rpc", "id": "n", "method": "eth_accounts", "params": nil])
        await settle()
        XCTAssertEqual(sink.messages.count, 3)
        XCTAssertEqual(sink.reply("m")?["error"]?["code"], -32600)
        XCTAssertEqual(sink.reply("p")?["error"]?["code"], -32602)
        XCTAssertEqual(sink.reply("n")?["type"], "rpc-result")
    }

    func testDuplicateInFlightId() async {
        let wallet = MockWallet()
        wallet.holds = ["eth_sendTransaction"]
        core.wallet = wallet
        rpc("dup", "eth_sendTransaction", [[:]])
        await settle()
        rpc("dup", "eth_sendTransaction", [[:]])
        await settle()
        XCTAssertEqual(sink.messages.count, 1)
        XCTAssertEqual(sink.messages.first?["error"], ["code": -32600, "message": "Duplicate request id"])
        XCTAssertEqual(core.pendingRequestCount, 1)
        wallet.release()
        await settle()
        XCTAssertEqual(sink.messages.count, 2)
        XCTAssertEqual(sink.messages.last?["type"], "rpc-result")
        XCTAssertEqual(core.pendingRequestCount, 0)
    }

    func testMapsWalletErrors() async {
        let wallet = MockWallet()
        core.wallet = wallet
        wallet.failures["eth_sendTransaction"] = FlipperRPCError(code: 4001, message: "User rejected the request.")
        wallet.failures["eth_requestAccounts"] = FlipperRPCError(code: 4100, message: "Locked", data: ["reason": "locked"])
        wallet.failures["wallet_switchEthereumChain"] = FlipperRPCError(code: 4902, message: "Unrecognized chain")
        wallet.failures["eth_chainId"] = NSError(domain: "Test", code: 7, userInfo: [NSLocalizedDescriptionKey: "boom"])
        wallet.failures["wallet_watchAsset"] = NSError(domain: "WalletConnect", code: 4001, userInfo: [NSLocalizedDescriptionKey: "Rejected"])
        rpc(1, "eth_sendTransaction", [[:]])
        rpc(2, "eth_requestAccounts")
        rpc(3, "wallet_switchEthereumChain", [["chainId": "0x1237"]])
        rpc(4, "eth_chainId")
        rpc(5, "wallet_watchAsset", [[:]])
        await settle()
        XCTAssertEqual(sink.reply(1)?["error"], ["code": 4001, "message": "User rejected the request."])
        XCTAssertEqual(sink.reply(2)?["error"], ["code": 4100, "message": "Locked", "data": ["reason": "locked"]])
        XCTAssertEqual(sink.reply(3)?["error"]?["code"], 4902)
        XCTAssertEqual(sink.reply(4)?["error"], ["code": -32603, "message": "boom"])
        XCTAssertEqual(sink.reply(5)?["error"]?["code"], 4001)
    }

    func testNoWallet() async {
        rpc(1, "eth_accounts")
        rpc(2, "eth_chainId")
        rpc(3, "eth_requestAccounts")
        rpc(4, "eth_sendTransaction", [[:]])
        await settle()
        XCTAssertEqual(sink.reply(1)?["result"], [])
        XCTAssertEqual(sink.reply(2)?["result"], "0x1237")
        XCTAssertEqual(sink.reply(3)?["error"]?["code"], 4100)
        XCTAssertEqual(sink.reply(4)?["error"], ["code": 4100, "message": "No wallet connected."])
        XCTAssertEqual(connects, 1)
    }

    func testDiscardsAnswersFromAPreviousPage() async {
        let wallet = MockWallet()
        wallet.holds = ["eth_sendTransaction"]
        core.wallet = wallet
        rpc("old", "eth_sendTransaction", [[:]])
        await settle()
        core.pageStarted()
        wallet.release()
        await settle()
        XCTAssertNil(sink.reply("old"))
    }

    // MARK: wallet + config

    func testWalletStateQueuedUntilReadyAndDeduplicated() async {
        core.setWalletState(accounts: ["0x1"], chainId: 1)
        core.setWalletState(accounts: [account], chainId: nil)
        XCTAssertTrue(sink.messages.isEmpty)
        event("ready")
        XCTAssertEqual(sink.messages.filter { $0["type"] == "wallet" }.count, 1)
        XCTAssertEqual(sink.last("wallet"), ["v": 1, "source": "flipper-host", "type": "wallet", "accounts": [.string(account)], "chainId": "0x1237"])
        core.setWalletState(accounts: [account], chainId: nil)
        XCTAssertEqual(sink.messages.count, 1)
        core.setWalletState(accounts: [], chainId: 31337)
        XCTAssertEqual(sink.last("wallet")?["chainId"], "0x7a69")
        XCTAssertEqual(sink.last("wallet")?["accounts"], [])
    }

    func testConfigMergedAndReappliedAfterReload() async {
        core.sendConfig(["theme": "light"])
        core.sendConfig(["accent": "#ff5a1f", "theme": "dark"])
        event("ready")
        XCTAssertEqual(sink.last("config"), ["v": 1, "source": "flipper-host", "type": "config", "theme": "dark", "accent": "#ff5a1f"])
        core.pageStarted()
        let before = sink.messages.count
        event("ready")
        XCTAssertEqual(sink.messages[before...].map { $0["type"]?.stringValue ?? "" }, ["wallet", "config"])
        core.pageStarted(keepConfig: false)
        event("ready")
        XCTAssertEqual(sink.messages.last?["type"], "wallet")
    }

    func testHostConfigSentAfterEveryReadyUnderLiveChanges() async {
        core.hostConfig = ["rpcUrl": "https://rpc.example", "addresses": ["house": "0x01", "lens": "0x02"]]
        event("ready")
        XCTAssertEqual(sink.last("config"), [
            "v": 1, "source": "flipper-host", "type": "config",
            "rpcUrl": "https://rpc.example", "addresses": ["house": "0x01", "lens": "0x02"],
        ])
        core.sendConfig(["rpcUrl": "https://rpc2.example", "theme": "dark"])
        core.pageStarted()
        event("ready")
        XCTAssertEqual(sink.last("config"), [
            "v": 1, "source": "flipper-host", "type": "config",
            "rpcUrl": "https://rpc2.example", "addresses": ["house": "0x01", "lens": "0x02"], "theme": "dark",
        ])
        core.pageStarted(keepConfig: false)
        event("ready")
        XCTAssertEqual(sink.last("config"), [
            "v": 1, "source": "flipper-host", "type": "config",
            "rpcUrl": "https://rpc.example", "addresses": ["house": "0x01", "lens": "0x02"],
        ], "no URL carries it")
    }

    // MARK: events

    func testTypedEventsAndResize() async {
        core.minHeight = 200
        core.maxHeight = 700
        event("ready", ["version": "0.1.0", "chainId": 4663, "account": nil, "partner": "acme"])
        event("flip-settled", ["flipId": "12", "outcome": "won", "status": "Won", "won": true, "pending": false, "payout": "200", "decimals": 18, "native": false])
        event("payout-resolved", ["flipId": "12", "decimals": 18, "tokenPaid": "100", "flipperPaid": "0", "by": "self", "native": true, "txHash": nil])
        event("resize", ["width": 360, "height": 512.2])
        event("resize", ["height": 50])
        event("resize", ["height": 5000])
        event("resize", ["height": "600"])
        event("connect-request", ["reason": "flip"])
        event("brand-new", ["x": 1])
        guard case .ready(let ready)? = events.first else { return XCTFail("no ready") }
        XCTAssertEqual(ready.version, "0.1.0")
        XCTAssertEqual(ready.chainId, 4663)
        XCTAssertNil(ready.account)
        XCTAssertEqual(ready.partner, "acme")
        guard case .flipSettled(let settled) = events[1] else { return XCTFail("no flip-settled") }
        XCTAssertEqual(settled.flipId, "12")
        XCTAssertEqual(settled.outcome, "won")
        XCTAssertEqual(settled.status, "Won")
        XCTAssertEqual(settled.won, true)
        XCTAssertEqual(settled.decimals, 18)
        XCTAssertEqual(settled.native, false)
        guard case .payoutResolved(let resolved) = events[2] else { return XCTFail("no payout-resolved") }
        XCTAssertEqual(events[2].name, "payout-resolved")
        XCTAssertEqual(resolved.flipId, "12")
        XCTAssertEqual(resolved.decimals, 18)
        XCTAssertEqual(resolved.tokenPaid, "100")
        XCTAssertEqual(resolved.flipperPaid, "0")
        XCTAssertEqual(resolved.by, "self")
        XCTAssertEqual(resolved.native, true)
        XCTAssertNil(resolved.txHash)
        XCTAssertEqual(heights, [513, 200, 700])
        XCTAssertEqual(connects, 1)
        XCTAssertEqual(events.last, .unknown(name: "brand-new", data: ["x": 1]))
        XCTAssertEqual(events.last?.name, "brand-new")
    }

    func testDisposeStopsEverything() async {
        core.dispose()
        event("ready")
        rpc(1, "eth_accounts")
        await settle()
        XCTAssertTrue(events.isEmpty)
        XCTAssertTrue(sink.messages.isEmpty)
    }
}
