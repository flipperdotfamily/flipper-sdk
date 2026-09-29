import Combine
import Foundation

/// The host app's wallet. The widget never holds keys: every request below is shown to the user by *your* wallet
/// (WalletConnect / Reown AppKit, an embedded wallet SDK, …) with its own confirmation UI. Never auto-approve them.
///
/// `request` receives only the seven bridge methods (`FlipperConstants.walletMethods`): eth_accounts,
/// eth_requestAccounts, eth_chainId, eth_sendTransaction, wallet_switchEthereumChain, wallet_addEthereumChain,
/// wallet_watchAsset. Message signing (personal_sign, eth_signTypedData_v4) never reaches it: the widget doesn't sign
/// messages. `params` is the JSON-RPC params array.
/// Throw `FlipperRPCError` to answer with a specific EIP-1193 code (4001 when the user closes the prompt, 4902 for
/// an unknown chain); any other error becomes -32603.
///
/// Publishers should replay their current value on subscription (`CurrentValueSubject`, `@Published`).
///
/// The protocol is main-actor isolated: `request` is called on the main actor (hop off it inside if your wallet SDK
/// needs to), and requests can overlap (the user may have several prompts queued).
@MainActor
public protocol FlipperWallet: AnyObject {
    func request(method: String, params: JSONValue) async throws -> JSONValue
    /// connected accounts, active first; `[]` when disconnected
    var accountsPublisher: AnyPublisher<[String], Never> { get }
    /// the wallet's current chain id; nil when unknown / disconnected
    var chainIdPublisher: AnyPublisher<Int?, Never> { get }
}

/// An EIP-1193 error to answer the embed with.
public struct FlipperRPCError: Error, Equatable, LocalizedError, Sendable {
    public let code: Int
    public let message: String
    public let data: JSONValue?

    public init(code: Int, message: String, data: JSONValue? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }

    public var errorDescription: String? { message }

    public static let userRejected = 4001
    public static let unauthorized = 4100
    public static let unsupportedMethod = 4200
    public static let disconnected = 4900
    public static let chainDisconnected = 4901
    public static let unrecognizedChain = 4902
    public static let invalidRequest = -32600
    public static let invalidParams = -32602
    public static let internalError = -32603

    /// Maps anything a wallet throws: `FlipperRPCError` as-is; an `NSError` in a JSON-RPC-looking domain keeps its
    /// code; everything else is -32603 with the error's description.
    public static func from(_ error: Error) -> FlipperRPCError {
        if let e = error as? FlipperRPCError { return e }
        let ns = error as NSError
        let looksLikeRPC = ns.code == 4001 || (4100...4902).contains(ns.code) || (-32700 ... -32000).contains(ns.code)
        if looksLikeRPC && ns.domain != NSCocoaErrorDomain && ns.domain != NSURLErrorDomain {
            return FlipperRPCError(code: ns.code, message: ns.localizedDescription)
        }
        let message = (error as? LocalizedError)?.errorDescription ?? ns.localizedDescription
        return FlipperRPCError(code: internalError, message: message.isEmpty ? "Internal error" : message)
    }
}

/// A ready-made `FlipperWallet` for adapters: pass a request closure (or subclass and override `request`) and call
/// `update(accounts:chainId:)` whenever your wallet library reports a change.
@MainActor
open class FlipperWalletAdapter: FlipperWallet {
    public let accountsSubject: CurrentValueSubject<[String], Never>
    public let chainIdSubject: CurrentValueSubject<Int?, Never>
    private let handler: ((String, JSONValue) async throws -> JSONValue)?

    public init(accounts: [String] = [], chainId: Int? = nil, request: ((String, JSONValue) async throws -> JSONValue)? = nil) {
        accountsSubject = CurrentValueSubject(accounts)
        chainIdSubject = CurrentValueSubject(chainId)
        handler = request
    }

    open func request(method: String, params: JSONValue) async throws -> JSONValue {
        guard let handler else { throw FlipperRPCError(code: FlipperRPCError.unsupportedMethod, message: "Not implemented: \(method)") }
        return try await handler(method, params)
    }

    public var accountsPublisher: AnyPublisher<[String], Never> { accountsSubject.eraseToAnyPublisher() }
    public var chainIdPublisher: AnyPublisher<Int?, Never> { chainIdSubject.eraseToAnyPublisher() }

    /// Report a state change; pass only what changed.
    public func update(accounts: [String]? = nil, chainId: Int?? = nil) {
        if let accounts { accountsSubject.send(accounts) }
        if let chainId { chainIdSubject.send(chainId) }
    }

    public var accounts: [String] { accountsSubject.value }
    public var chainId: Int? { chainIdSubject.value }
}

/// Parses chain ids from Int, "4663", "0x1237" or CAIP-2 "eip155:4663".
public func flipperNormalizeChainId(_ value: JSONValue?) -> Int? {
    guard let value else { return nil }
    if let i = value.intValue { return i > 0 ? i : nil }
    guard var s = value.stringValue?.trimmingCharacters(in: .whitespaces) else { return nil }
    if s.lowercased().hasPrefix("eip155:") { s = String(s.dropFirst(7)) }
    let n: Int?
    if s.lowercased().hasPrefix("0x") { n = Int(s.dropFirst(2), radix: 16) } else { n = Int(s, radix: 10) }
    guard let n, n > 0 else { return nil }
    return n
}

/// "0x" + lower-case hex.
public func flipperHexChainId(_ chainId: Int) -> String { "0x" + String(chainId, radix: 16) }
