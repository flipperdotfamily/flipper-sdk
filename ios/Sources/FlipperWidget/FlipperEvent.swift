import Foundation

// Typed views of the embed's event payloads (packages/widget/BRIDGE.md section 5). Every field is optional and
// parsed leniently; `raw` always has the full payload. Amounts are decimal strings in the token's smallest unit.

private extension JSONValue {
    /// strings as-is, numbers printed without a fraction when integral
    var looseString: String? {
        switch self {
        case .string(let s): return s
        case .number(let n): return JSONValue.format(n)
        default: return nil
        }
    }
    /// numbers, or numeric strings
    var looseInt: Int? {
        if let i = intValue { return i }
        if let s = stringValue { return Int(s) }
        return nil
    }
}

public struct FlipperReadyEvent: Equatable, Sendable {
    public let version: String?
    public let chainId: Int?
    public let account: String?
    public let token: String?
    public let variant: String?
    public let partner: String?
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
        version = raw["version"]?.looseString
        chainId = raw["chainId"]?.looseInt
        account = raw["account"]?.stringValue
        token = raw["token"]?.stringValue
        variant = raw["variant"]?.stringValue
        partner = raw["partner"]?.stringValue
    }
}

public struct FlipperConnectRequestEvent: Equatable, Sendable {
    /// "connect", "flip" or "list"
    public let reason: String?
    public let partner: String?
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
        reason = raw["reason"]?.stringValue
        partner = raw["partner"]?.stringValue
    }
}

public struct FlipperFlipRequestedEvent: Equatable, Sendable {
    public let flipId: String?
    public let account: String?
    public let token: String?
    public let symbol: String?
    public let decimals: Int?
    public let amount: String?
    public let winChanceBps: Int?
    public let randomnessFee: String?
    public let txHash: String?
    public let approveTxHash: String?
    /// the stake was native ETH, wrapped to WETH: `token` is WETH and `symbol` is "ETH"
    public let native: Bool?
    public let partner: String?
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
        flipId = raw["flipId"]?.looseString
        account = raw["account"]?.stringValue
        token = raw["token"]?.stringValue
        symbol = raw["symbol"]?.stringValue
        decimals = raw["decimals"]?.looseInt
        amount = raw["amount"]?.looseString
        winChanceBps = raw["winChanceBps"]?.looseInt
        randomnessFee = raw["randomnessFee"]?.looseString
        txHash = raw["txHash"]?.stringValue
        approveTxHash = raw["approveTxHash"]?.stringValue
        native = raw["native"]?.boolValue
        partner = raw["partner"]?.stringValue
    }
}

public struct FlipperFlipSettledEvent: Equatable, Sendable {
    public let flipId: String?
    public let account: String?
    public let token: String?
    public let symbol: String?
    public let decimals: Int?
    public let amount: String?
    /// "won", "lost" or "refunded"
    public let outcome: String?
    /// "Won", "WonFallback", "WinPending", "Lost", "LostInventory" or "Refunded"
    public let status: String?
    public let won: Bool?
    /// WinPending: stake back, winnings owed (the widget offers Retry payout); a second event with the same flipId
    /// follows once they're paid, alongside `payout-resolved`
    public let pending: Bool?
    /// what the player received in `payoutToken`, stake included ("0" on a loss)
    public let payout: String?
    public let payoutToken: String?
    public let flipperPaid: String?
    public let txHash: String?
    public let requestTxHash: String?
    /// the stake was native ETH, wrapped to WETH: `token` is WETH and `symbol` is "ETH"
    public let native: Bool?
    public let partner: String?
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
        flipId = raw["flipId"]?.looseString
        account = raw["account"]?.stringValue
        token = raw["token"]?.stringValue
        symbol = raw["symbol"]?.stringValue
        decimals = raw["decimals"]?.looseInt
        amount = raw["amount"]?.looseString
        outcome = raw["outcome"]?.stringValue
        status = raw["status"]?.looseString
        won = raw["won"]?.boolValue
        pending = raw["pending"]?.boolValue
        payout = raw["payout"]?.looseString
        payoutToken = raw["payoutToken"]?.stringValue
        flipperPaid = raw["flipperPaid"]?.looseString
        txHash = raw["txHash"]?.stringValue
        requestTxHash = raw["requestTxHash"]?.stringValue
        native = raw["native"]?.boolValue
        partner = raw["partner"]?.stringValue
    }
}

/// A pending win's winnings were paid. Sent once per flip, alongside the final `flip-settled`.
public struct FlipperPayoutResolvedEvent: Equatable, Sendable {
    public let flipId: String?
    public let account: String?
    public let token: String?
    public let symbol: String?
    public let decimals: Int?
    /// winnings paid in `token` (the stake already came back at settlement)
    public let tokenPaid: String?
    /// $FLIPPER paid instead ("0" unless the token still couldn't be bought after the pending timeout)
    public let flipperPaid: String?
    /// "self": this widget's Retry payout paid it; "other": someone else did (usually flipper's payout worker)
    public let by: String?
    /// the stake was native ETH: `token` is WETH (the winnings are paid in WETH) and `symbol` is "ETH". False, with
    /// "WETH", for a pending win the widget only learned about from an earlier session
    public let native: Bool?
    /// the PendingWinResolved transaction (nil if it couldn't be looked up)
    public let txHash: String?
    public let partner: String?
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
        flipId = raw["flipId"]?.looseString
        account = raw["account"]?.stringValue
        token = raw["token"]?.stringValue
        symbol = raw["symbol"]?.stringValue
        decimals = raw["decimals"]?.looseInt
        tokenPaid = raw["tokenPaid"]?.looseString
        flipperPaid = raw["flipperPaid"]?.looseString
        by = raw["by"]?.stringValue
        native = raw["native"]?.boolValue
        txHash = raw["txHash"]?.stringValue
        partner = raw["partner"]?.stringValue
    }
}

public struct FlipperListingEvent: Equatable, Sendable {
    /// "started", "submitted", "listed" or "failed"
    public let stage: String?
    public let token: String?
    public let symbol: String?
    public let txHash: String?
    public let error: String?
    public let partner: String?
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
        stage = raw["stage"]?.stringValue
        token = raw["token"]?.stringValue
        symbol = raw["symbol"]?.stringValue
        txHash = raw["txHash"]?.stringValue
        error = raw["error"]?.stringValue
        partner = raw["partner"]?.stringValue
    }
}

/// Errors from the embed, plus the SDK's own (`context == "config"`: invalid base URL; `code == "network"`: the page
/// failed to load). `message` is plain English and safe to show.
public struct FlipperErrorEvent: Equatable, Sendable {
    /// user-rejected, rejected, insufficient-funds, revert, timeout, config, network, wallet or unknown
    public let code: String?
    public let message: String?
    /// config, wallet, preview, flip or listing
    public let context: String?
    public let partner: String?
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
        code = raw["code"]?.looseString
        message = raw["message"]?.stringValue
        context = raw["context"]?.stringValue
        partner = raw["partner"]?.stringValue
    }

    public init(code: String, message: String, context: String) {
        self.init(raw: ["code": .string(code), "message": .string(message), "context": .string(context)])
    }
}

public struct FlipperResizeEvent: Equatable, Sendable {
    public let width: Double?
    /// CSS px (= points)
    public let height: Double?
    public let raw: JSONValue

    public init(raw: JSONValue) {
        self.raw = raw
        width = raw["width"]?.doubleValue
        height = raw["height"]?.doubleValue
    }
}

/// Everything the embed reports. Unknown names (newer embeds) arrive as `.unknown`.
public enum FlipperEvent: Equatable, Sendable {
    case ready(FlipperReadyEvent)
    case connectRequest(FlipperConnectRequestEvent)
    case flipRequested(FlipperFlipRequestedEvent)
    case flipSettled(FlipperFlipSettledEvent)
    case payoutResolved(FlipperPayoutResolvedEvent)
    case listing(FlipperListingEvent)
    case error(FlipperErrorEvent)
    case resize(FlipperResizeEvent)
    case unknown(name: String, data: JSONValue)

    public init(name: String, data: JSONValue) {
        switch name {
        case "ready": self = .ready(.init(raw: data))
        case "connect-request": self = .connectRequest(.init(raw: data))
        case "flip-requested": self = .flipRequested(.init(raw: data))
        case "flip-settled": self = .flipSettled(.init(raw: data))
        case "payout-resolved": self = .payoutResolved(.init(raw: data))
        case "listing": self = .listing(.init(raw: data))
        case "error": self = .error(.init(raw: data))
        case "resize": self = .resize(.init(raw: data))
        default: self = .unknown(name: name, data: data)
        }
    }

    /// The protocol name ("ready", "flip-settled", …).
    public var name: String {
        switch self {
        case .ready: return "ready"
        case .connectRequest: return "connect-request"
        case .flipRequested: return "flip-requested"
        case .flipSettled: return "flip-settled"
        case .payoutResolved: return "payout-resolved"
        case .listing: return "listing"
        case .error: return "error"
        case .resize: return "resize"
        case .unknown(let name, _): return name
        }
    }

    public var data: JSONValue {
        switch self {
        case .ready(let e): return e.raw
        case .connectRequest(let e): return e.raw
        case .flipRequested(let e): return e.raw
        case .flipSettled(let e): return e.raw
        case .payoutResolved(let e): return e.raw
        case .listing(let e): return e.raw
        case .error(let e): return e.raw
        case .resize(let e): return e.raw
        case .unknown(_, let data): return data
        }
    }
}
