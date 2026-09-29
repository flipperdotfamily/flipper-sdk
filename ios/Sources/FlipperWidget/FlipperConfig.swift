import Foundation

public enum FlipperConstants {
    public static let sdkVersion = "0.1.0"
    public static let bridgeVersion = 1
    /// The hosted embed page.
    public static let defaultEmbedURL = URL(string: "https://flipper.family/embed")!
    /// Robinhood Chain, the launch chain.
    public static let defaultChainId = 4663
    /// Local Anvil fork used in development.
    public static let localChainId = 31337
    public static let defaultInitialHeight: Double = 560
    public static let defaultMinHeight: Double = 120
    public static let maxMessageLength = 524_288
    /// Hosts that may be loaded over plain http, only with `allowInsecureLocalhost`.
    public static let debugHosts: Set<String> = ["localhost", "127.0.0.1", "10.0.2.2", "::1", "[::1]"]
    /// The only wallet methods the embed may call. `FlipperWidgetOptions.allowedMethods` can narrow this, never widen it.
    /// No message signing (`personal_sign`, `eth_signTypedData_*`): the embed never signs messages, so a compromised
    /// embed can't ask for a Permit signature.
    public static let walletMethods: [String] = [
        "eth_accounts",
        "eth_requestAccounts",
        "eth_chainId",
        "eth_sendTransaction",
        "wallet_switchEthereumChain",
        "wallet_addEthereumChain",
        "wallet_watchAsset",
    ]
    /// Optional EIP-5792 methods the embed uses for one-confirmation native-ETH flips (wrap + approve + flip as one
    /// atomic batch). Forwarded only with `FlipperWidgetOptions.enableBatchCalls`; otherwise answered with 4200, and
    /// the embed falls back to sequential transactions.
    public static let batchCallMethods: [String] = ["wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus"]
    /// Every method the embed can send. Nothing outside this list is ever forwarded.
    public static let bridgeMethods: [String] = walletMethods + batchCallMethods

    /// The forwarded set: the wallet methods, plus the batch methods when enabled, narrowed by `allowedMethods`.
    public static func effectiveMethods(enableBatchCalls: Bool, allowedMethods: Set<String>?) -> Set<String> {
        let base = Set(enableBatchCalls ? bridgeMethods : walletMethods)
        return allowedMethods.map { base.intersection($0) } ?? base
    }
}

/// Colour mode of the widget.
public enum FlipperThemeMode: String, Sendable, CaseIterable {
    case light, dark, auto
}

/// Look and feel. `accent` and `radius` cover most white-label needs; `custom` passes theme tokens through to the
/// embed as `config.theme` (see the widget README for the keys).
public struct FlipperTheme: Equatable, Sendable {
    /// default `.auto` (follows the system appearance)
    public var mode: FlipperThemeMode?
    /// CSS hex colour, e.g. "#ff5a1f" (CTA, focus, links)
    public var accent: String?
    /// card corner radius in points / CSS px, 0–40 (default 24)
    public var radius: Int?
    /// custom theme tokens (sent as `config.theme`)
    public var custom: [String: JSONValue]?

    public init(mode: FlipperThemeMode? = nil, accent: String? = nil, radius: Int? = nil, custom: [String: JSONValue]? = nil) {
        self.mode = mode
        self.accent = accent
        self.radius = radius
        self.custom = custom
    }
}

/// What the widget shows. Every field maps to an embed URL parameter / `FlipperEmbedConfig` field
/// (packages/widget/BRIDGE.md). `extra` carries everything else and newer embed options.
/// `.picker` (default): the user chooses the token. `.single`: one fixed token (set `token`), and no picker is rendered.
public enum FlipperTokenMode: String, Equatable, Sendable {
    case picker, single
}

/// `.auto` (default): the view takes the widget's content height. `.fill`: the widget fills the frame you give the view.
public enum FlipperFit: String, Equatable, Sendable {
    case auto, fill
}

/// The idle headline under the coin (`FlipperConfig.tagline`; default none).
public enum FlipperTagline: Equatable, Sendable {
    /// the built-in one: "Double or nothing" and its payout line
    case builtIn
    /// your own line
    case text(String)
}

public struct FlipperConfig: Equatable, Sendable {
    /// chain to flip on (default 4663, Robinhood Chain; 31337 for a local fork). Changing it reloads the embed.
    public var chainId: Int
    /// token selected at start (default $FLIPPER)
    public var token: String?
    /// allowlist for the token picker
    public var tokens: [String]?
    /// `.picker` (default) or `.single` (one fixed token: set `token`; the embed shows a configuration error without it)
    public var mode: FlipperTokenMode?
    /// attribution id `[A-Za-z0-9._:-]{1,64}`, echoed in every event. Changing it reloads the embed.
    public var partner: String?
    /// BCP 47 tag, e.g. "en", "es"
    public var locale: String?
    /// compact layout (small inline coin, denser spacing)
    public var compact: Bool?
    /// `.fill`: the widget fills the view's frame (any size from about 240×360); autoHeight is then off
    public var fit: FlipperFit?
    /// Deprecated: use `mode: .single`.
    public var hidePicker: Bool?
    /// false removes flipper.family marks (white-label)
    public var branding: Bool?
    /// other `FlipperEmbedConfig` fields: brandName, brandLogo, coinImage, coinImageTails, strings, minAmount,
    /// maxAmount, approval, listing, rpcUrl, apiUrl, addresses, …
    public var extra: [String: JSONValue]

    public init(
        chainId: Int = FlipperConstants.defaultChainId,
        token: String? = nil,
        tokens: [String]? = nil,
        mode: FlipperTokenMode? = nil,
        partner: String? = nil,
        locale: String? = nil,
        compact: Bool? = nil,
        fit: FlipperFit? = nil,
        hidePicker: Bool? = nil,
        branding: Bool? = nil,
        extra: [String: JSONValue] = [:]
    ) {
        self.chainId = chainId
        self.token = token
        self.tokens = tokens
        self.mode = mode
        self.partner = partner
        self.locale = locale
        self.compact = compact
        self.fit = fit
        self.hidePicker = hidePicker
        self.branding = branding
        self.extra = extra
    }

    /// Header brand name (replaces "flipper").
    public var brandName: String? {
        get { extra["brandName"]?.stringValue }
        set { extra["brandName"] = newValue.map(JSONValue.string) }
    }
    /// https URL of a square logo, at least 64 px.
    public var brandLogo: String? {
        get { extra["brandLogo"]?.stringValue }
        set { extra["brandLogo"] = newValue.map(JSONValue.string) }
    }
    /// https URL of the heads face of the coin.
    public var coinImage: String? {
        get { extra["coinImage"]?.stringValue }
        set { extra["coinImage"] = newValue.map(JSONValue.string) }
    }
    /// String-table overrides (keys in the widget README).
    public var strings: [String: String]? {
        get { extra["strings"]?.objectValue?.compactMapValues(\.stringValue) }
        set { extra["strings"] = newValue.map { .object($0.mapValues(JSONValue.string)) } }
    }
    /// Show the win chance / payout / fee line under the button. Default off: the widget only flags odds that fees
    /// trim below the usual ("↓ Odds 0.9 pts below usual").
    public var details: Bool? {
        get { extra["details"]?.boolValue }
        set { extra["details"] = newValue.map(JSONValue.bool) }
    }
    /// A headline under the coin while idle (default none). Setting nil turns it off.
    public var tagline: FlipperTagline? {
        get {
            switch extra["tagline"] {
            case .bool(true)?: return .builtIn
            case .string(let s)?: return .text(s)
            default: return nil
            }
        }
        set {
            switch newValue {
            case .builtIn?: extra["tagline"] = .bool(true)
            case .text(let s)?: extra["tagline"] = .string(s)
            case nil: extra["tagline"] = extra["tagline"] == nil ? nil : .bool(false)
            }
        }
    }
}

/// How the widget behaves (not what it shows).
public struct FlipperWidgetOptions: Equatable, Sendable {
    /// default https://flipper.family/embed; `http://localhost:3000/embed` in development
    public var baseURL: URL
    /// allow http://localhost / 127.0.0.1 embed URLs (default: DEBUG builds only)
    public var allowInsecureLocalhost: Bool
    /// Also forward the optional EIP-5792 methods (wallet_getCapabilities, wallet_sendCalls, wallet_getCallsStatus),
    /// so wallets with atomic batches confirm a native-ETH flip once. Default false (answered with 4200).
    public var enableBatchCalls: Bool
    /// narrow the wallet methods the embed may call (default: the seven wallet methods, plus the batch ones if enabled)
    public var allowedMethods: Set<String>?
    /// size the view to the embed's content (default true)
    public var autoHeight: Bool
    public var initialHeight: Double
    public var minHeight: Double
    public var maxHeight: Double?
    /// Safari Web Inspector access (default: DEBUG builds only; iOS 16.4+)
    public var isInspectable: Bool

    public init(
        baseURL: URL = FlipperConstants.defaultEmbedURL,
        allowInsecureLocalhost: Bool = FlipperWidgetOptions.isDebugBuild,
        enableBatchCalls: Bool = false,
        allowedMethods: Set<String>? = nil,
        autoHeight: Bool = true,
        initialHeight: Double = FlipperConstants.defaultInitialHeight,
        minHeight: Double = FlipperConstants.defaultMinHeight,
        maxHeight: Double? = nil,
        isInspectable: Bool = FlipperWidgetOptions.isDebugBuild
    ) {
        self.baseURL = baseURL
        self.allowInsecureLocalhost = allowInsecureLocalhost
        self.enableBatchCalls = enableBatchCalls
        self.allowedMethods = allowedMethods
        self.autoHeight = autoHeight
        self.initialHeight = initialHeight
        self.minHeight = minHeight
        self.maxHeight = maxHeight
        self.isInspectable = isInspectable
    }

    public static var isDebugBuild: Bool {
        #if DEBUG
        return true
        #else
        return false
        #endif
    }
}

/// An invalid embed configuration (e.g. a non-https base URL). The widget reports it through `onError`.
public struct FlipperConfigError: Error, Equatable, LocalizedError {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

/// Builds and validates embed URLs.
public enum FlipperEmbedURL {
    /// `FlipperEmbedConfig` fields the embed never takes from its URL, since anyone can craft a URL: they decide where
    /// funds, approvals and reads go. They're left out of the URL's `config` param, and the bridge sends them in a
    /// `config` message after every `ready` (`FlipperBridgeCore.hostConfig`).
    public static let hostOnlyConfigKeys: Set<String> = ["rpcUrl", "apiUrl", "addresses"]

    /// The host-only fields of `config.extra` (see `hostOnlyConfigKeys`); empty when none are set.
    public static func hostOnlyConfig(_ config: FlipperConfig) -> [String: JSONValue] {
        config.extra.filter { hostOnlyConfigKeys.contains($0.key) && $0.value != .null }
    }

    /// scheme://host[:port] (lower-cased, default port dropped), or nil when the URL has no host.
    public static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), var host = url.host?.lowercased(), !host.isEmpty else { return nil }
        if host.contains(":"), !host.hasPrefix("[") { host = "[\(host)]" }
        return origin(scheme: scheme, host: host, port: url.port)
    }

    static func origin(scheme: String, host: String, port: Int?) -> String {
        let defaultPort = scheme == "https" ? 443 : scheme == "http" ? 80 : nil
        if let port, port != 0, port != defaultPort { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }

    /// Checks the base URL (https, or http on a loopback host when allowed; no credentials) and returns its origin.
    public static func validate(_ baseURL: URL, allowInsecureLocalhost: Bool) throws -> String {
        guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let origin = origin(of: baseURL)
        else { throw FlipperConfigError("Invalid embed URL: \(baseURL.absoluteString)") }
        if components.user != nil || components.password != nil {
            throw FlipperConfigError("The embed URL must not contain credentials.")
        }
        switch baseURL.scheme?.lowercased() {
        case "https":
            return origin
        case "http":
            let host = (baseURL.host ?? "").lowercased()
            let loopback = FlipperConstants.debugHosts.contains(host)
            if loopback && allowInsecureLocalhost { return origin }
            throw FlipperConfigError(
                loopback
                    ? "http:// embed URLs are only allowed in development (allowInsecureLocalhost)."
                    : "The embed URL must use https:// (http:// is only allowed for localhost in development)."
            )
        default:
            throw FlipperConfigError("Unsupported embed URL scheme: \(baseURL.scheme ?? "none")")
        }
    }

    /// Query parameters for a config + theme (only the ones that are set).
    public static func queryItems(config: FlipperConfig, theme: FlipperTheme) -> [(String, String)] {
        var items: [(String, String)] = [("chain", String(config.chainId))]
        if let token = config.token, !token.isEmpty { items.append(("token", token)) }
        if let tokens = config.tokens, !tokens.isEmpty { items.append(("tokens", tokens.joined(separator: ","))) }
        if let mode = theme.mode { items.append(("theme", mode.rawValue)) }
        if let accent = theme.accent, !accent.isEmpty { items.append(("accent", accent)) }
        if let radius = theme.radius { items.append(("radius", String(radius))) }
        if let branding = config.branding { items.append(("branding", branding ? "1" : "0")) }
        if let partner = config.partner, !partner.isEmpty { items.append(("partner", partner)) }
        if let locale = config.locale, !locale.isEmpty { items.append(("locale", locale)) }
        if let compact = config.compact { items.append(("compact", compact ? "1" : "0")) }
        if let mode = config.mode { items.append(("mode", mode.rawValue)) }
        if let hidePicker = config.hidePicker { items.append(("hidePicker", hidePicker ? "1" : "0")) }
        if let fit = config.fit { items.append(("fit", fit.rawValue)) }
        // rpcUrl / apiUrl / addresses: the embed ignores them in its URL; the bridge sends them after `ready`
        var extra = config.extra.filter { !hostOnlyConfigKeys.contains($0.key) }
        if let custom = theme.custom { extra["theme"] = .object(custom) }
        if !extra.isEmpty {
            items.append(("config", Data(JSONValue.object(extra).jsonString.utf8).base64EncodedString()))
        }
        return items
    }

    /// The full embed URL and its origin. Throws `FlipperConfigError` for an unsafe base URL.
    public static func build(options: FlipperWidgetOptions, config: FlipperConfig, theme: FlipperTheme) throws -> (url: URL, origin: String) {
        let origin = try validate(options.baseURL, allowInsecureLocalhost: options.allowInsecureLocalhost)
        guard var components = URLComponents(url: options.baseURL, resolvingAgainstBaseURL: false) else {
            throw FlipperConfigError("Invalid embed URL: \(options.baseURL.absoluteString)")
        }
        let ours = queryItems(config: config, theme: theme)
        let names = Set(ours.map(\.0))
        let kept = (components.percentEncodedQuery ?? "")
            .split(separator: "&", omittingEmptySubsequences: true)
            .filter { pair in
                let name = pair.split(separator: "=", maxSplits: 1).first.map(String.init) ?? ""
                return !names.contains(name.removingPercentEncoding ?? name)
            }
            .map(String.init)
        let added = ours.map { "\(percentEncode($0.0))=\(percentEncode($0.1))" }
        let query = (kept + added).joined(separator: "&")
        components.percentEncodedQuery = query.isEmpty ? nil : query
        guard let url = components.url else { throw FlipperConfigError("Invalid embed URL: \(options.baseURL.absoluteString)") }
        return (url, origin)
    }

    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    /// encodeURIComponent-style encoding (`+`, `#`, `&`, `=`, `,` … are escaped), so `URLSearchParams` in the embed
    /// reads the exact value back (a raw `+` would become a space and corrupt base64).
    static func percentEncode(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: unreserved) ?? s
    }

    /// The live-config form (`FlipperEmbedConfig` field names) used to diff property changes into `config` messages.
    /// `chainId` and `partner` are left out: changing them reloads the page instead.
    public static func liveConfig(config: FlipperConfig, theme: FlipperTheme) -> [String: JSONValue] {
        var out = config.extra
        out.removeValue(forKey: "chainId")
        out.removeValue(forKey: "partner")
        if let custom = theme.custom { out["theme"] = .object(custom) } else if let mode = theme.mode { out["theme"] = .string(mode.rawValue) }
        if let accent = theme.accent { out["accent"] = .string(accent) }
        if let radius = theme.radius { out["radius"] = .number(Double(radius)) }
        if let branding = config.branding { out["branding"] = .bool(branding) }
        if let locale = config.locale { out["locale"] = .string(locale) }
        if let compact = config.compact { out["variant"] = .string(compact ? "compact" : "card") }
        if let mode = config.mode { out["mode"] = .string(mode.rawValue) }
        if let hidePicker = config.hidePicker { out["hidePicker"] = .bool(hidePicker) }
        if let fit = config.fit { out["fit"] = .string(fit.rawValue) }
        if let token = config.token { out["token"] = .string(token) }
        if let tokens = config.tokens { out["tokens"] = .array(tokens.map(JSONValue.string)) }
        return out
    }

    /// Keys whose values changed (removed keys aren't reported).
    public static func diff(_ old: [String: JSONValue], _ new: [String: JSONValue]) -> [String: JSONValue] {
        new.filter { old[$0.key] != $0.value }
    }
}

/// Where a navigation inside the widget may go.
public enum FlipperNavigationDecision: Equatable, Sendable {
    case allow
    /// open in the system browser / app, never inside the widget
    case openExternally
    case block

    private static let externalSchemes: Set<String> = ["https", "http", "mailto", "tel"]

    /// The embed origin stays inside; top-frame web / mail / phone links open externally; other schemes are blocked;
    /// sub-frames may only load the embed origin, about:blank and about:srcdoc.
    public static func decide(url: URL?, embedOrigin: String, isMainFrame: Bool) -> FlipperNavigationDecision {
        guard let url else { return .block }
        let absolute = url.absoluteString
        if !isMainFrame && (absolute == "about:blank" || absolute == "about:srcdoc") { return .allow }
        let hasCredentials = url.user != nil || url.password != nil
        if let origin = FlipperEmbedURL.origin(of: url), origin == embedOrigin, !hasCredentials { return .allow }
        guard isMainFrame else { return .block }
        return externalSchemes.contains(url.scheme?.lowercased() ?? "") ? .openExternally : .block
    }
}
