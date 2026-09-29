# iOS: wiring the `FlipperWidget` Swift package into an app

Follow these steps when the user's app is native iOS: it has a `*.xcodeproj` / `*.xcworkspace`, `Package.swift` or a
`Podfile`. The package is `FlipperWidget` 0.1.0 (Swift package and CocoaPod), with its source in `ios/` in the [flipper-sdk repo](https://github.com/flipperdotfamily/flipper-sdk).
It shows the hosted embed in a `WKWebView` and sends every wallet request to a `FlipperWallet` that **the app**
implements. It needs iOS 15+ and Swift 5.9+ (Xcode 15+), and has no dependencies. It is built and tested with
Xcode 16.2, and its XCTests pass on the iOS 18.3 simulator, including against the real embed.

## 1. Check the app first

- The deployment target must be iOS 15 or later. Look for SwiftUI (`App`/`View`) or UIKit (`UIViewController`).
- Find the app's wallet: Reown AppKit (`ReownAppKit`, `AppKit.present()`), WalletConnect Sign, Coinbase Wallet SDK,
  Privy, Dynamic, web3swift, or a custom signer. You will write a thin adapter around it. Don't add a second wallet
  SDK.

## 2. Install

- **SPM:** in Xcode, choose Add Package Dependencies → `https://github.com/flipperdotfamily/FlipperWidget-iOS` and add
  the product `FlipperWidget`. While the package is unpublished, add the local path `…/flipper-sdk/ios` instead.
- **CocoaPods:** `pod 'FlipperWidget', '~> 0.1'`, then `pod install`.

No Info.plist keys are needed.

## 3. Minimal code

SwiftUI:

```swift
import FlipperWidget

FlipperWidgetView(
    config: FlipperConfig(partner: "APP_ID"),                     // ask the user for their partner id
    theme: FlipperTheme(mode: colorScheme == .dark ? .dark : .light, accent: "#7C5CFF"),
    wallet: flipperWallet                                          // FlipperWallet? (nil = read-only)
)
.onFlipperConnectRequest { _ in showConnect = true }               // open the app's wallet UI
.onFlipperFlipSettled { event in /* analytics */ }
.onFlipperError { print($0.message ?? "") }
```

UIKit: create a `FlipperWidgetUIView(config:theme:options:wallet:)` and set the `onConnectRequest`, `onFlipSettled`
and `onError` closures. Add it to a stack or scroll view; its `intrinsicContentSize` follows the content height. For
sheets there is `FlipperWidgetViewController`.

## 4. The wallet adapter

`FlipperWallet` is `@MainActor`:

```swift
func request(method: String, params: JSONValue) async throws -> JSONValue
var accountsPublisher: AnyPublisher<[String], Never> { get }   // replays the current value
var chainIdPublisher: AnyPublisher<Int?, Never> { get }
```

The quickest route is `FlipperWalletAdapter { method, params in … }`. Call `update(accounts:chainId:)` from the
wallet SDK's connect, disconnect, account-change and chain-change callbacks.

- **Methods to handle.** The embed calls `eth_sendTransaction` (forward the params unchanged),
  `wallet_switchEthereumChain` / `wallet_addEthereumChain`, `wallet_watchAsset`, and the state reads `eth_accounts`,
  `eth_chainId` and `eth_requestAccounts`.
- **Errors.** Throw `FlipperRPCError(code: 4001, …)` when the user rejects, and `4902` for an unknown chain; the embed
  then asks to add it. Anything else becomes `-32603`.
- **Reown AppKit.** Copy flipper-sdk's `ios/Examples/ReownAppKitFlipperWallet.swift` into the app. It sends
  `AppKit.instance.request(params: Request(…))`, waits for the matching `sessionResponsePublisher` id, and calls
  `launchCurrentWallet()`. It also adds Robinhood Chain (4663) as a chain preset (public RPC; swap in the app's
  provider for production traffic) and maps WalletConnect's 5000-range rejections to 4001. Open the modal with `AppKit.present()`.
- **Batched calls (optional).** Pass `FlipperWidgetOptions(enableBatchCalls: true)` only if the wallet implements
  EIP-5792 (`wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus`); a native-ETH flip is then one
  confirmation. It's off by default (answered 4200, and the embed falls back). `allowedMethods` still narrows the set,
  and nothing outside the embed's 10 methods is ever forwarded.
- **Confirmations.** Never auto-approve. The wallet must show its own confirmation for every transaction.

## 5. Options

```swift
FlipperConfig(chainId: 4663, token: nil, tokens: nil, mode: .picker, partner: "APP_ID", locale: "en", compact: false,
              fit: .auto, branding: true, extra: [:])             // extra: any FlipperEmbedConfig field
// mode: .single = one fixed token (set token:), no picker. fit: .fill = fill the view's frame (autoHeight off).
// hidePicker: still accepted, deprecated in favour of mode: .single
config.details = true                  // opt-in win chance / payout / fee line (default off)
config.tagline = .builtIn              // opt-in idle headline, or .text("Your line") (default none)
config.brandName / .brandLogo / .coinImage / .strings           // typed white-label helpers
FlipperTheme(mode: .auto, accent: "#ff5a1f", radius: 20, custom: nil)
FlipperWidgetOptions(baseURL:, allowInsecureLocalhost: DEBUG, enableBatchCalls: false, allowedMethods:, autoHeight: true,
                     initialHeight: 560, minHeight: 120, maxHeight: nil, isInspectable: DEBUG)
```

Setting `config` or `theme` on a live widget applies the change without a reload; `chainId` and `partner` reload it.
`setConfig([String: JSONValue])` sends raw config fields. `rpcUrl`, `apiUrl` and `addresses` in `config.extra` never go
in the URL (the embed ignores them there): the widget sends them in a `config` message after every `ready`. Images
(`brandLogo`, `coinImage`) must be `data:` URIs: the embed's CSP loads no other image hosts. See [theming.md](theming.md) and [events.md](events.md).

## 6. Events

UIKit uses closure properties; SwiftUI uses `.onFlipper…` modifiers. The events are Ready, ConnectRequest,
FlipRequested, FlipSettled, PayoutResolved, Listing, Error, Resize, and `onEvent` for all of them
(`FlipperEvent.unknown` for new names). Every typed event keeps its `raw` JSON. A `FlipSettled` with
`pending == true` (WinPending: winnings still owed, the widget offers Retry payout) is followed by a final one with
the same `flipId` once they're paid; de-duplicate by `flipId`. `onPayoutResolved` / `.onFlipperPayoutResolved`
fires once alongside it.

## 7. Local development

```swift
FlipperWidgetOptions(baseURL: URL(string: "http://localhost:3000/embed")!)   // DEBUG builds allow http://localhost
FlipperConfig(chainId: 31337)                                                   // local fork
```

The Simulator reaches the Mac's `localhost`. A physical device needs an https tunnel.

## 8. Security checklist (tell the user)

- The embed URL must be https, or http localhost in DEBUG only. Navigation is locked to the embed origin, and other
  links open in Safari.
- Only main-frame messages from the embed origin with `source: "flipper"` and `v: 1` are accepted, and only the seven
  wallet methods are forwarded (ten with `enableBatchCalls`); message signing (`personal_sign`,
  `eth_signTypedData_v4`) gets 4200. `allowedMethods` can narrow that list.
- No keys cross the bridge, and the wallet confirms everything.

## 9. Gotchas

- **Blank view:** check `onError`. Also make sure the view is in a window hierarchy: WebKit doesn't run pages for
  detached web views.
- **Stuck on "Confirm in wallet":** `request` never returned; always return or throw.
- **The widget shows the wrong account or chain:** the publishers didn't emit. Refresh them on the wallet SDK's
  session and chain events.
- **Debugging:** use `onLog` (UIKit) for dropped messages and navigation decisions, and Safari Web Inspector in DEBUG.
