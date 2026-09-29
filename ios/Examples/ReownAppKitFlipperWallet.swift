// Sample adapter: FlipperWallet over Reown AppKit (WalletConnect) for iOS.
//
// NOT part of the FlipperWidget package and not compiled in this repo: copy it into your app, which already
// depends on Reown AppKit (SPM product `ReownAppKit` from https://github.com/reown-com/reown-swift, or the
// `reown-swift/ReownAppKit` pod). Checked against reown-swift's AppKitClient (request(params:) returns Void; the
// answer arrives on sessionResponsePublisher with the request's id). Re-check against the version you ship.

import Combine
import FlipperWidget
import ReownAppKit
import UIKit

/// Robinhood Chain (4663) as an AppKit chain preset (public RPC; swap in your provider's endpoint for production
/// traffic).
let robinhoodChain = Chain(
    chainName: "Robinhood Chain",
    chainNamespace: "eip155",
    chainReference: "4663",
    requiredMethods: [],
    optionalMethods: [],
    events: [],
    token: .init(name: "Ether", symbol: "ETH", decimal: 18),
    rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
    blockExplorerUrl: "https://robinhoodchain.blockscout.com",
    imageId: ""
)

@MainActor
final class ReownAppKitFlipperWallet: FlipperWallet {
    private let accounts = CurrentValueSubject<[String], Never>([])
    private let chainId = CurrentValueSubject<Int?, Never>(nil)
    private var bag = Set<AnyCancellable>()

    var accountsPublisher: AnyPublisher<[String], Never> { accounts.eraseToAnyPublisher() }
    var chainIdPublisher: AnyPublisher<Int?, Never> { chainId.eraseToAnyPublisher() }

    init() {
        AppKit.instance.addChainPreset(robinhoodChain)
        refresh()
        AppKit.instance.sessionsPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.refresh() }
            .store(in: &bag)
        AppKit.instance.sessionEventPublisher // chainChanged / accountsChanged from the wallet
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.refresh() }
            .store(in: &bag)
        AppKit.instance.sessionDeletePublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.accounts.send([])
                self?.chainId.send(nil)
            }
            .store(in: &bag)
    }

    func refresh() {
        accounts.send(AppKit.instance.getAddress().map { [$0] } ?? [])
        chainId.send(AppKit.instance.getSelectedChain().flatMap { Int($0.chainReference) })
    }

    func request(method: String, params: JSONValue) async throws -> JSONValue {
        switch method {
        case "eth_accounts":
            return .array(accounts.value.map(JSONValue.string))
        case "eth_chainId":
            return chainId.value.map { .string(flipperHexChainId($0)) } ?? .null
        case "eth_requestAccounts":
            if accounts.value.isEmpty {
                AppKit.present()
                throw FlipperRPCError(code: FlipperRPCError.userRejected, message: "Connect a wallet to continue.")
            }
            return .array(accounts.value.map(JSONValue.string))
        case "wallet_switchEthereumChain":
            // AppKit sends requests on its *selected* chain: select the preset, then let the wallet switch too.
            if let id = flipperNormalizeChainId(params[0]?["chainId"]),
               let chain = ([robinhoodChain] + ChainPresets.ethChains).first(where: { $0.chainReference == String(id) }) {
                AppKit.instance.selectChain(chain)
            }
        default:
            break
        }

        guard let session = AppKit.instance.getSessions().first,
              let chain = AppKit.instance.getSelectedChain(),
              let blockchain = Blockchain(namespace: chain.chainNamespace, reference: chain.chainReference)
        else { throw FlipperRPCError(code: FlipperRPCError.unauthorized, message: "No wallet connected.") }

        let request = Request(topic: session.topic, method: method, params: AnyCodable(any: params.anyValue), chainId: blockchain)
        let response: W3MResponse = try await withCheckedThrowingContinuation { continuation in
            var subscription: AnyCancellable?
            // subscribe before sending so the answer can't be missed
            subscription = AppKit.instance.sessionResponsePublisher
                .filter { $0.id == request.id }
                .first()
                .sink { response in
                    continuation.resume(returning: response)
                    subscription?.cancel()
                }
            Task { @MainActor in
                do {
                    try await AppKit.instance.request(params: request)
                    AppKit.instance.launchCurrentWallet() // take the user to their wallet app to confirm
                } catch {
                    subscription?.cancel()
                    continuation.resume(throwing: FlipperRPCError.from(error))
                }
            }
        }
        refresh()
        switch response.result {
        case .response(let value):
            return (try? value.get(JSONValue.self)) ?? .null
        case .error(let error):
            // WalletConnect uses 5000 for "user rejected"; the embed expects EIP-1193's 4001
            let code = (5000...5003).contains(error.code) ? FlipperRPCError.userRejected : error.code
            throw FlipperRPCError(code: code, message: error.message)
        }
    }
}
