# FlipperWidget for iOS

The [flipper.family](https://flipper.family) coin-flip widget for iOS apps, in UIKit and SwiftUI. It shows the
hosted embed (`https://flipper.family/embed`) in a `WKWebView` and routes the embed's wallet requests to a wallet
**your app** supplies, such as Reown AppKit / WalletConnect, an embedded-wallet SDK or your own signer. You can
theme and white-label it, and it reports typed events. The page never touches keys.

- iOS 15+, Swift 5.9+ (Xcode 15+), no dependencies.
- Swift Package `FlipperWidget` and CocoaPod `FlipperWidget`.
- `FlipperWidgetView` (SwiftUI), `FlipperWidgetUIView` (UIKit `UIView`), `FlipperWidgetViewController`.
- Implements embed bridge protocol v1 (`packages/widget/BRIDGE.md`).

## Install

**Swift Package Manager.** In Xcode, use File › Add Package Dependencies… with
`https://github.com/flipperdotfamily/FlipperWidget-iOS`, or in `Package.swift`:

```swift
.package(url: "https://github.com/flipperdotfamily/FlipperWidget-iOS", from: "0.1.0"),
// target: .product(name: "FlipperWidget", package: "FlipperWidget-iOS")
```

**CocoaPods.**

```ruby
pod 'FlipperWidget', '~> 0.1'
```

No Info.plist changes are needed. The embed is served over https, and external links open through
`UIApplication.open`.

## Quick start (SwiftUI)

```swift
import FlipperWidget

struct FlipScreen: View {
    let wallet: FlipperWallet?          // your adapter, see "Wallet wiring"
    @State private var showConnect = false

    var body: some View {
        ScrollView {
            FlipperWidgetView(
                config: FlipperConfig(partner: "acme"),
                theme: FlipperTheme(mode: .auto, accent: "#ff5a1f"),
                wallet: wallet
            )
            .onFlipperConnectRequest { _ in showConnect = true }     // open your wallet UI
            .onFlipperFlipSettled { print($0.outcome ?? "") }
        }
    }
}
```

The view sizes itself to the embed's content (auto-height), so put it in a `ScrollView` or `VStack`.

## Quick start (UIKit)

```swift
let widget = FlipperWidgetUIView(
    config: FlipperConfig(partner: "acme"),
    theme: FlipperTheme(mode: .dark, accent: "#ff5a1f"),
    wallet: wallet
)
widget.onConnectRequest = { [weak self] _ in self?.presentWalletModal() }
widget.onFlipSettled = { event in print(event.outcome ?? "") }
stackView.addArrangedSubview(widget)      // intrinsicContentSize follows the content height
```

`FlipperWidgetViewController` wraps the view, and its `preferredContentSize` follows the content height, which suits
sheets and popovers.

## Wallet wiring

By default the widget asks your wallet for seven JSON-RPC methods (three more with `enableBatchCalls`; see "Batched calls"), and only after the user acts in the widget:

| Method | When |
|---|---|
| `eth_sendTransaction` | approvals, flips, listings (fully specified by the embed: `gas`, EIP-1559 fees) |
| `wallet_switchEthereumChain` / `wallet_addEthereumChain` | the wallet is on another chain (`4902` from switch → the embed sends add) |
| `wallet_watchAsset` | "Add to wallet" after a win |
| `eth_accounts`, `eth_chainId`, `eth_requestAccounts` | state checks (usually answered from your publishers) |

Message signing (`personal_sign`, `eth_signTypedData_v4`) is never forwarded: the embed doesn't sign messages, so
those get `4200` like any other method outside the list.

Reads (prices, balances, previews) never reach your wallet: the embed has its own RPC.

Implement `FlipperWallet`, which is `@MainActor`:

```swift
@MainActor
public protocol FlipperWallet: AnyObject {
    func request(method: String, params: JSONValue) async throws -> JSONValue
    var accountsPublisher: AnyPublisher<[String], Never> { get }   // [] when disconnected
    var chainIdPublisher: AnyPublisher<Int?, Never> { get }
}
```

The quickest route is `FlipperWalletAdapter`, which gives you the publishers plus a request closure:

```swift
let wallet = FlipperWalletAdapter { method, params in
    // forward to your wallet SDK; params is the JSON-RPC params array
    let result = try await mySigner.send(method: method, params: params.anyValue)
    return JSONValue(any: result) ?? .null
}
wallet.update(accounts: ["0xabc…"], chainId: 4663)    // call on every connect / account / chain change
```

- **Errors.** Throw `FlipperRPCError(code:message:data:)` to control the answer. Use `4001` when the user rejects or
  closes the prompt (the widget shows "You rejected the request"), `4902` when the wallet doesn't know the chain, and
  `4100` when nothing is connected. Any other thrown error becomes `-32603` with its description.
- **State.** The publishers must replay their current value (`CurrentValueSubject` / `@Published`). The widget pushes
  a `wallet` message to the embed on every change, and after every page load.
- **No wallet.** Pass `wallet: nil`. The widget is then read-only; `eth_accounts` is `[]` and "Connect" fires
  `onConnectRequest`.

### Batched calls (optional)

The embed can also send three EIP-5792 methods: `wallet_getCapabilities`, `wallet_sendCalls` and
`wallet_getCallsStatus`. With a wallet that supports atomic batches, a native-ETH flip is then one confirmation
(wrap, approve and flip together) instead of up to three. By default the SDK answers them with `4200`, and the embed
falls back to separate transactions.

Opt in only if your wallet implements EIP-5792:

```swift
FlipperWidgetOptions(enableBatchCalls: true)
```

`allowedMethods` still narrows the result, and it can include the batch methods only when `enableBatchCalls` is on.
Nothing outside the embed's 10 methods (`FlipperConstants.bridgeMethods`) is ever forwarded. If your wallet can't
handle a batch request, throw `FlipperRPCError(code: 4200, …)` and the embed falls back.

### Reown AppKit (WalletConnect)

[`Examples/ReownAppKitFlipperWallet.swift`](Examples/ReownAppKitFlipperWallet.swift) is a complete adapter. It
isn't compiled in this repo, so copy it into your app. It:

- adds Robinhood Chain (4663) as an AppKit chain preset (public RPC; use your provider's for production traffic);
- mirrors `AppKit.instance.getAddress()` / `getSelectedChain()` into the publishers, refreshing on
  `sessionsPublisher`, `sessionEventPublisher` and `sessionDeletePublisher`;
- sends each request with `AppKit.instance.request(params: Request(topic:method:params:chainId:))`, waits for the
  matching `sessionResponsePublisher` entry (by request id), and calls `launchCurrentWallet()` so the user lands in
  their wallet app to confirm;
- selects the matching AppKit chain on `wallet_switchEthereumChain`, because AppKit targets its *selected* chain;
- maps WalletConnect's rejection codes (5000–5003) to EIP-1193 `4001`.

Open the connect modal from `onFlipperConnectRequest` with `AppKit.present()`.

## Configuration

```swift
var config = FlipperConfig(
    chainId: 4663,                 // Robinhood Chain, the default (31337 = local fork); changing it reloads the embed
    token: "0x…",                  // token selected at start (default $FLIPPER)
    tokens: ["0x…", "0x…"],        // picker allowlist
    mode: .single,                 // .picker (default) or .single: one fixed token (needs `token`), no picker at all
    partner: "acme",               // attribution id, echoed in every event; changing it reloads
    locale: "es",
    compact: true,                 // small inline coin, denser layout
    fit: .fill,                    // .fill: fill the view's frame (autoHeight off); .auto (default): content height
    branding: false                // white-label: removes flipper.family marks
)
// `hidePicker` still works, but is deprecated: use `mode: .single`
config.brandName = "Acme Flip"     // header name
config.brandLogo = "data:image/png;base64,iVBORw0…"  // images as data: URIs: the embed's CSP loads no other hosts
config.coinImage = "data:image/png;base64,iVBORw0…"
config.strings = ["flip": "Lanzar"]
config.details = true              // opt-in: win chance / payout / fee line (default off: only an odds deviation note)
config.tagline = .builtIn          // opt-in idle headline: .builtIn or .text("Double or nothing on Acme") (default none)
config.extra["minAmount"] = "10"   // any other FlipperEmbedConfig field (see BRIDGE.md): maxAmount, approval, listing, rpcUrl, apiUrl, addresses, …

let options = FlipperWidgetOptions(
    baseURL: URL(string: "https://flipper.family/embed")!,
    allowInsecureLocalhost: false,       // default: DEBUG builds only
    enableBatchCalls: false,             // forward the EIP-5792 batch methods (see "Batched calls")
    allowedMethods: nil,                 // narrow the RPC allowlist, e.g. ["eth_accounts", "eth_chainId", "eth_sendTransaction", "wallet_switchEthereumChain"]
    autoHeight: true, initialHeight: 560, minHeight: 120, maxHeight: nil,
    isInspectable: false                 // Safari Web Inspector (default: DEBUG only; iOS 16.4+)
)
```

Changing `config` or `theme` on a live widget sends one `config` message (no reload), except for `chainId` and
`partner`, which reload the embed. `setConfig(_:)` sends any raw `FlipperEmbedConfig` fields.

`rpcUrl`, `apiUrl` and `addresses` decide where funds, approvals and reads go, so the embed never takes them from its
URL (anyone can craft one). The widget leaves them out of the URL and sends them in a `config` message after every
`ready` instead (`FlipperBridgeCore.hostConfig`, `FlipperEmbedURL.hostOnlyConfig`). The embed's CSP still only
connects to flipper's own RPC and API.

## Theme and white-label

```swift
FlipperTheme(
    mode: .auto,                 // .light / .dark / .auto (follows the system)
    accent: "#ff5a1f",           // CTA, focus and links; text on the accent is picked for contrast
    radius: 20,                  // card corner radius, 0–40
    custom: ["colors": ["surface": "#0b0d12"]]   // theme tokens passed through as config.theme (see the widget README)
)
```

For a full white-label, combine `branding: false` with `brandName`, `brandLogo`, `coinImage` / `coinImageTails`, your
accent and `strings`. Follow the app's appearance by passing
`theme: FlipperTheme(mode: colorScheme == .dark ? .dark : .light)`; the widget updates live.

## Events

| Callback (UIKit property / SwiftUI modifier) | Payload | When |
|---|---|---|
| `onReady` / `.onFlipperReady` | `FlipperReadyEvent` (version, chainId, account, token, variant, partner) | the embed loaded |
| `onConnectRequest` / `.onFlipperConnectRequest` | `FlipperConnectRequestEvent` (reason: connect / flip / list) | open your wallet UI |
| `onFlipRequested` / `.onFlipperFlipRequested` | `FlipperFlipRequestedEvent` (flipId, amount, winChanceBps, txHash, native, …) | flip tx mined, randomness requested |
| `onFlipSettled` / `.onFlipperFlipSettled` | `FlipperFlipSettledEvent` (outcome, status, won, pending, payout, native, …) | coin landed. A `pending` (WinPending) flip's winnings are still owed, and the widget offers Retry payout. It gets a second event for the same `flipId` once they're paid; the last one is final |
| `onPayoutResolved` / `.onFlipperPayoutResolved` | `FlipperPayoutResolvedEvent` (flipId, tokenPaid, flipperPaid, by: self / other, native, txHash, …) | a pending win's winnings were paid, once per flip, alongside the final `flip-settled`. `by: "other"` is usually flipper's payout worker |
| `onListing` / `.onFlipperListing` | `FlipperListingEvent` (stage, token, txHash, error) | permissionless listing progress |
| `onError` / `.onFlipperError` | `FlipperErrorEvent` (code, message, context) | embed errors. `message` is safe to show. The SDK adds `context: "config"` for a bad base URL and `code: "network"` when the page fails to load |
| `onResize` / `.onFlipperResize` | height (points) | content height changed |
| `onEvent` / `.onFlipperEvent` | `FlipperEvent` enum | everything, including `.unknown(name:data:)` from newer embeds |

Amounts are decimal strings in the token's smallest unit, and each event's `raw` holds the full JSON payload.

## Security

- **Only the embed origin.** The base URL must be `https` (plain `http` is allowed only for
  `localhost`/`127.0.0.1`/`::1` with `allowInsecureLocalhost`, which defaults to DEBUG builds only), and credentials
  in the URL are rejected.
- **Navigation stays on the embed.**
  - Top-level navigation is limited to the embed origin.
  - Other `http(s)`, `mailto:` and `tel:` links open in the system browser or app.
  - Every other scheme (`javascript:`, `file:`, custom deep links) is blocked.
  - Sub-frames may load only the embed origin, `about:blank` and `about:srcdoc`.
  - `target=_blank` and `window.open` never create a second web view.
- **The bridge only listens to the embed.**
  - The `FlipperHost` script is injected at document start into the **main frame only**, as a frozen,
    non-writable object.
  - Messages are accepted only from the main frame whose `WKSecurityOrigin` is the embed origin, and only with
    `source: "flipper"` and `v: 1`. Oversized or malformed messages are dropped.
- **An allowlisted wallet surface.** The seven methods above are the only ones forwarded (`4200` otherwise; no
  message signing), and you can narrow them with `allowedMethods`.
- **No keys and no secrets.** Only JSON-RPC requests and public events cross the bridge; no keys, sessions or cookies.
- **Your wallet always confirms.** Every transaction and signature goes to *your* wallet, which must show its own
  confirmation UI. Never auto-approve bridge requests. If you use an embedded or custodial wallet without a built-in
  prompt, add one.
- **Hardening.** Link previews, back/forward gestures and automatic window opening are off, media capture is denied,
  and the inspector is available in DEBUG only.

## Local development

Run the web app (`pnpm dev:web`) and point the widget at it:

```swift
FlipperWidgetOptions(baseURL: URL(string: "http://localhost:3000/embed")!)   // DEBUG builds allow http://localhost
FlipperConfig(chainId: 31337)                                                   // the local fork
```

The iOS Simulator reaches the Mac's `localhost` directly. A physical device needs an https tunnel to your machine;
plain http to a LAN IP is rejected on purpose.

## Troubleshooting

- **Blank widget.** Check `onError`. A `config` error means the base URL isn't https (or is http outside DEBUG), and
  `network` means the page didn't load. The web view must be in a window hierarchy: WebKit doesn't run pages for
  detached views.
- **"Connect wallet" does nothing.** Handle `onConnectRequest` / `.onFlipperConnectRequest` and open your wallet UI.
  Once connected, publish the accounts (`update(accounts:chainId:)`).
- **The widget shows the wrong account or chain.** Your publishers must emit on every change and replay the current
  value. For AppKit, refresh on `sessionEventPublisher`.
- **Stuck on "Confirm in wallet…".** Your `request` never returned. Always return or throw, and use `4001` when the
  user dismisses your prompt.
- **"Switch to Robinhood Chain" loops.** After a successful `wallet_switchEthereumChain`, publish the new chain id.
  If the wallet doesn't know the chain, throw `4902` so the embed sends `wallet_addEthereumChain`.
- **The height doesn't change.** `autoHeight` is on by default. In UIKit, don't pin a fixed height constraint; with
  `autoHeight: false`, size the view yourself and the web view scrolls.
- **Debugging.** Set `onLog` (UIKit) to see dropped messages and navigation decisions, and use Safari's Web Inspector
  in DEBUG builds.

## Architecture

- `FlipperBridgeCore` holds the protocol logic and depends only on Foundation. It validates, routes RPCs, matches
  ids, tracks the page generation and queues messages until `ready`. It is unit tested with XCTest, with the JS it
  emits executed in JavaScriptCore.
- `FlipperWidgetUIView` wraps the core around WKWebView: the user script, the script message handler (through a weak
  proxy, so there's no retain cycle) and the navigation and UI delegates.
- `FlipperWidgetView` is a SwiftUI wrapper with an `@State` height.

Tests: `swift test` on a Mac (core, URL and navigation), or run
`xcodebuild test -scheme FlipperWidget -destination 'platform=iOS Simulator,name=iPhone 16'` for everything,
including real-WKWebView integration tests against a stub embed.

## Publishing (maintainers)

- **SwiftPM.** It needs `Package.swift` at a repository root, so publish `packages/ios` to the mirror repo:
  `git subtree split --prefix packages/ios -b ios-release`, push that branch to
  `github.com/flipperdotfamily/FlipperWidget-iOS`, and tag it with a bare semver (`0.1.0`). Optionally submit the
  repo to the Swift Package Index.
- **CocoaPods.** From the mirror checkout: run `pod spec lint FlipperWidget.podspec`, register once with
  `pod trunk register dev@flipper.family 'flipper.family'`, then run `pod trunk push FlipperWidget.podspec`. The
  podspec's `source` tag must exist on the mirror first.
