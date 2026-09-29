import Foundation

/// JavaScript the widget injects or evaluates.
public enum FlipperScripts {
    /// Name of the `WKScriptMessageHandler` (`window.webkit.messageHandlers.FlipperHost`).
    public static let messageHandlerName = "FlipperHost"

    /// Document-start user script (main frame only): defines a frozen `window.FlipperHost` that forwards JSON strings
    /// to the script message handler. Idempotent.
    public static let hostScript = """
    (function () {
      try {
        if (window.FlipperHost) return;
        var handlers = window.webkit && window.webkit.messageHandlers;
        var handler = handlers && handlers.FlipperHost;
        if (!handler) return;
        var send = function (message) {
          handler.postMessage(typeof message === "string" ? message : JSON.stringify(message));
        };
        Object.defineProperty(window, "FlipperHost", {
          value: Object.freeze({ postMessage: send }),
          writable: false,
          configurable: false,
          enumerable: false
        });
      } catch (e) {}
    })();
    """

    /// A JavaScript string literal for `s` (JSON escaping plus U+2028 / U+2029).
    public static func jsStringLiteral(_ s: String) -> String { JSONValue.string(s).jsonString }

    /// Delivers one message to the embed: `window.FlipperBridge.receive(json)`, else a same-window `postMessage`.
    public static func receiveScript(json: String) -> String {
        "(function(m){try{if(window.FlipperBridge&&typeof window.FlipperBridge.receive===\"function\")"
            + "{window.FlipperBridge.receive(m);}else{window.postMessage(JSON.parse(m),window.location.origin);}}catch(e){}})("
            + jsStringLiteral(json) + ");true;"
    }
}

/// Where a bridge message came from.
public struct FlipperMessageSource: Equatable, Sendable {
    /// scheme://host[:port] of the sending frame (`WKFrameInfo.securityOrigin`)
    public var origin: String?
    public var isMainFrame: Bool

    public init(origin: String?, isMainFrame: Bool) {
        self.origin = origin
        self.isMainFrame = isMainFrame
    }
}

/// What the core reports to its owner.
public struct FlipperBridgeHandlers {
    /// every embed event (typed; unknown names as `.unknown`)
    public var onEvent: ((FlipperEvent) -> Void)?
    /// the embed's Connect button, or `eth_requestAccounts` with no wallet: open your wallet UI
    public var onConnectRequest: ((FlipperConnectRequestEvent) -> Void)?
    /// new content height (clamped to min / max)
    public var onResize: ((Double) -> Void)?
    /// an RPC finished (method, succeeded)
    public var onRPCSettled: ((String, Bool) -> Void)?
    /// dropped / rejected messages (debug)
    public var log: ((String) -> Void)?

    public init() {}
}

/// Host side of the embed bridge (protocol v1), independent of WebKit: feed it the page's messages, and it answers
/// through `evaluate` (JavaScript to run in the page). `FlipperWidgetUIView` wraps one of these.
@MainActor
public final class FlipperBridgeCore {
    public let embedOrigin: String
    /// the configured chain: answers `eth_chainId` and fills `wallet.chainId` without a wallet
    public var chainId: Int { didSet { if oldValue != chainId { pushWallet() } } }
    /// also forward the optional EIP-5792 batch methods
    public var enableBatchCalls = false
    /// narrows the RPC allowlist (never widens it beyond the bridge's methods)
    public var allowedMethods: Set<String>?
    public var minHeight: Double
    public var maxHeight: Double?
    /// Config the embed only accepts from its host, never from its URL (`rpcUrl`, `apiUrl`, `addresses`; see
    /// `FlipperEmbedURL.hostOnlyConfig`). Sent in a `config` message after every `ready`, under any live config
    /// changes, and kept across `pageStarted(keepConfig: false)`.
    public var hostConfig: [String: JSONValue] = [:]
    /// the host wallet used for each request (read at request time)
    public var wallet: FlipperWallet?
    public var handlers = FlipperBridgeHandlers()

    public private(set) var isReady = false

    private let evaluate: (String) -> Void
    private var generation = 0
    private var inflight = Set<String>()
    private var walletAccounts: [String] = []
    private var walletChainId: Int?
    private var lastWalletJSON: String?
    private var liveConfig: [String: JSONValue] = [:]
    private var disposed = false

    public init(
        embedOrigin: String,
        chainId: Int = FlipperConstants.defaultChainId,
        minHeight: Double = FlipperConstants.defaultMinHeight,
        maxHeight: Double? = nil,
        evaluate: @escaping (String) -> Void
    ) {
        self.embedOrigin = embedOrigin
        self.chainId = chainId
        self.minHeight = minHeight
        self.maxHeight = maxHeight
        self.evaluate = evaluate
    }

    /// Number of RPCs waiting on the wallet.
    public var pendingRequestCount: Int { inflight.count }

    /// A new top-level page committed (first load, reload, navigation): stop talking to the old page and wait for the
    /// next `ready`. `keepConfig: false` also forgets live config changes (a freshly built URL already has them);
    /// `hostConfig` is always re-sent, since no URL carries it.
    public func pageStarted(keepConfig: Bool = true) {
        isReady = false
        generation += 1
        inflight.removeAll()
        lastWalletJSON = nil
        if !keepConfig { liveConfig = [:] }
    }

    /// Current wallet state. Sent now when the embed is ready, else on `ready`; identical states aren't re-sent.
    public func setWalletState(accounts: [String], chainId: Int?) {
        walletAccounts = accounts
        walletChainId = chainId
        pushWallet()
    }

    /// Live config update (`FlipperEmbedConfig` fields). Queued until `ready`; merged with earlier updates and
    /// re-applied after reloads.
    public func sendConfig(_ partial: [String: JSONValue]) {
        guard !partial.isEmpty else { return }
        liveConfig.merge(partial) { _, new in new }
        if isReady { post(type: "config", fields: partial) }
    }

    public func dispose() {
        disposed = true
        isReady = false
        inflight.removeAll()
    }

    // MARK: inbound

    /// Handles one `FlipperHost.postMessage` body.
    public func handleMessage(_ body: Any, source: FlipperMessageSource) {
        guard !disposed else { return }
        guard source.isMainFrame else { return drop("message from a sub-frame") }
        guard source.origin == embedOrigin else { return drop("message from another origin: \(source.origin ?? "nil")") }

        let message: JSONValue
        if let text = body as? String {
            guard text.utf16.count <= FlipperConstants.maxMessageLength else { return drop("message too large") }
            guard let parsed = try? JSONValue.parse(text) else { return drop("message is not JSON") }
            message = parsed
        } else if let value = JSONValue(any: body) {
            message = value
        } else {
            return drop("unsupported message body")
        }
        guard case .object(let m) = message,
              m["v"]?.intValue == FlipperConstants.bridgeVersion, m["v"]?.doubleValue == 1,
              m["source"]?.stringValue == "flipper"
        else { return drop("not a flipper v1 message") }

        switch m["type"]?.stringValue {
        case "rpc": handleRPC(m)
        case "event": handleEvent(m)
        default: drop("unknown message type")
        }
    }

    // MARK: RPC

    private func isAllowed(_ method: String) -> Bool {
        FlipperConstants.effectiveMethods(enableBatchCalls: enableBatchCalls, allowedMethods: allowedMethods).contains(method)
    }

    private func handleRPC(_ m: [String: JSONValue]) {
        let id: JSONValue
        switch m["id"] {
        case .string(let s)?: id = .string(s)
        case .number(let n)? where n.isFinite: id = .number(n)
        default: return drop("rpc without a valid id")
        }
        let key: String
        if case .string(let s) = id { key = "s:" + s } else { key = "n:" + id.jsonString }
        if inflight.contains(key) {
            return replyError(id, FlipperRPCError(code: FlipperRPCError.invalidRequest, message: "Duplicate request id"))
        }
        guard let method = m["method"]?.stringValue, !method.isEmpty else {
            return replyError(id, FlipperRPCError(code: FlipperRPCError.invalidRequest, message: "Invalid request"))
        }
        var params = m["params"] ?? .null
        if params == .null { params = .array([]) }
        switch params {
        case .array, .object: break
        default: return replyError(id, FlipperRPCError(code: FlipperRPCError.invalidParams, message: "Invalid params"))
        }
        guard isAllowed(method) else {
            return replyError(id, FlipperRPCError(code: FlipperRPCError.unsupportedMethod, message: "Unsupported method: \(method)"))
        }

        let gen = generation
        inflight.insert(key)
        let wallet = self.wallet
        Task { @MainActor [weak self] in
            var ok = false
            var reply: (JSONValue?, FlipperRPCError?) = (nil, nil)
            do {
                guard let self else { return }
                reply.0 = try await self.execute(method: method, params: params, wallet: wallet)
                ok = true
            } catch {
                reply.1 = FlipperRPCError.from(error)
            }
            guard let self, gen == self.generation, !self.disposed else { return }
            self.inflight.remove(key)
            if let error = reply.1 { self.replyError(id, error) } else { self.post(type: "rpc-result", fields: ["id": id, "result": reply.0 ?? .null]) }
            self.handlers.onRPCSettled?(method, ok)
        }
    }

    private func execute(method: String, params: JSONValue, wallet: FlipperWallet?) async throws -> JSONValue {
        guard let wallet else {
            switch method {
            case "eth_accounts":
                return .array([])
            case "eth_chainId":
                return .string(flipperHexChainId(chainId))
            case "eth_requestAccounts":
                handlers.onConnectRequest?(FlipperConnectRequestEvent(raw: ["reason": "connect", "partner": .null]))
                throw FlipperRPCError(code: FlipperRPCError.unauthorized, message: "No wallet connected. The host app was asked to connect one.")
            default:
                throw FlipperRPCError(code: FlipperRPCError.unauthorized, message: "No wallet connected.")
            }
        }
        return try await wallet.request(method: method, params: params)
    }

    private func replyError(_ id: JSONValue, _ error: FlipperRPCError) {
        var payload: [String: JSONValue] = ["code": .number(Double(error.code)), "message": .string(error.message)]
        if let data = error.data { payload["data"] = data }
        post(type: "rpc-error", fields: ["id": id, "error": .object(payload)])
    }

    // MARK: events

    private func handleEvent(_ m: [String: JSONValue]) {
        guard let name = m["name"]?.stringValue, !name.isEmpty else { return drop("event without a name") }
        let data = m["data"] ?? .object([:])
        let event = FlipperEvent(name: name, data: data)

        if name == "ready" {
            isReady = true
            lastWalletJSON = nil
            pushWallet()
            let config = hostConfig.merging(liveConfig) { _, live in live }
            if !config.isEmpty { post(type: "config", fields: config) }
        }
        handlers.onEvent?(event)
        switch event {
        case .connectRequest(let e):
            handlers.onConnectRequest?(e)
        case .resize(let e):
            guard let h = e.height, h.isFinite, h > 0 else { return }
            let clamped = min(maxHeight ?? .infinity, max(minHeight, h.rounded(.up)))
            handlers.onResize?(clamped)
        default:
            break
        }
    }

    // MARK: outbound

    private func pushWallet() {
        guard isReady else { return }
        let fields: [String: JSONValue] = [
            "accounts": .array(walletAccounts.map(JSONValue.string)),
            "chainId": .string(flipperHexChainId(walletChainId ?? chainId)),
        ]
        let json = JSONValue.object(fields).jsonString
        guard json != lastWalletJSON else { return }
        lastWalletJSON = json
        post(type: "wallet", fields: fields)
    }

    private func post(type: String, fields: [String: JSONValue]) {
        guard !disposed else { return }
        var message = fields
        message["v"] = .number(Double(FlipperConstants.bridgeVersion))
        message["source"] = "flipper-host"
        message["type"] = .string(type)
        evaluate(FlipperScripts.receiveScript(json: JSONValue.object(message).jsonString))
    }

    private func drop(_ reason: String) {
        handlers.log?("flipper: dropped \(reason)")
    }
}
