# Android: wiring the flipper.family widget into an app

Instructions for an agent adding the flip widget to an Android app (Views or Jetpack Compose). The library is
`family.flipper:widget` (Kotlin package `family.flipper.widget`). Its source and full docs are in
`android/` in the [flipper-sdk repo](https://github.com/flipperdotfamily/flipper-sdk) (README.md). It shows the hosted embed (`https://flipper.family/embed`) in a hardened WebView
and routes the embed's wallet requests to a wallet **the host app provides**. The widget never holds keys.

Status: 0.1.0. The sources and unit tests have been compile-checked, but the Gradle build hasn't run yet. If the
artifact isn't on Maven Central yet, build it from `android/` in flipper-sdk
(`gradle wrapper && ./gradlew :widget:publishToMavenLocal`) and add `mavenLocal()` to the app's repositories.

## 1. Check the project first

- `minSdk` must be 24 or higher and `compileSdk` 35 or higher, with Java/Kotlin target 17. Raise these in the
  app's `build.gradle(.kts)` if needed, and tell the user you did.
- Work out whether the screen is Compose (`setContent { }`, `@Composable`) or Views (XML layouts, Fragments). Use
  the matching API below.
- Find the app's existing wallet stack: Reown AppKit / WalletConnect, Privy, web3j with its own key management,
  an embedded wallet SDK. You will adapt **that** wallet. Don't add a new one unless the user asks.

## 2. Install

```kotlin
dependencies { implementation("family.flipper:widget:0.1.0") }
```

The INTERNET permission comes from the library manifest. Don't add a serialization plugin: the app only needs
`kotlinx.serialization.json` types, which come in transitively.

## 3. Minimal code

Compose:

```kotlin
FlipperWidget(
    modifier = Modifier.fillMaxWidth(),          // no fixed height: it auto-sizes
    wallet = wallet,                             // FlipperWallet? (null = read-only)
    config = FlipperConfig(partner = "<partner-id>"),
    theme = FlipperTheme(mode = if (isSystemInDarkTheme()) FlipperThemeMode.DARK else FlipperThemeMode.LIGHT),
    onConnectRequest = { reason -> /* open the app's connect UI */ },
    onFlipSettled = { e -> /* analytics: e.flipId, e.outcome, e.status, e.payout */ },
)
```

Views: add a `<family.flipper.widget.FlipperWidgetView android:layout_height="wrap_content" .../>` (attributes
`app:flipperPartner`, `app:flipperThemeMode`, `app:flipperAccent`, and so on), then in code:

```kotlin
widget.wallet = wallet
widget.onConnectRequest = { reason -> openConnect() }
```

The view destroys itself with its Activity/Fragment-view lifecycle. Only call `destroy()` if you set
`autoDestroy = false`. Everything runs on the main thread.

## 4. Wallet adapter pattern

Implement `FlipperWallet`, or extend `MutableFlipperWallet` and call `update(accounts, chainId)` or `disconnect()`
when the wallet state changes:

```kotlin
interface FlipperWallet {
    suspend fun request(method: String, params: JsonElement): JsonElement   // EIP-1193
    val accounts: Flow<List<String>>   // active first, [] = disconnected
    val chainId: Flow<Long?>
}
```

Rules to follow when writing the adapter:

- Forward `params` (a JSON array, EIP-1193 shape) to the wallet unchanged, and return the result as JSON (the tx
  hash as `JsonPrimitive`, `JsonNull` for null).
- **Every transaction and signature must go through the wallet's own confirmation UI. Never auto-approve.**
- Failures: `throw FlipperRpcException(code, message)`. Pass wallet codes through unchanged: 4001 when the user
  rejects or closes the prompt (otherwise the widget waits forever), 4902 when `wallet_switchEthereumChain` targets
  an unknown chain (the widget then sends `wallet_addEthereumChain`), 4100, 4200, 4900/4901, -32602, -32603.
- After a successful switch, emit the new id from `chainId`.
- The SDK only ever forwards `eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `eth_sendTransaction`,
  `wallet_switchEthereumChain`, `wallet_addEthereumChain` and `wallet_watchAsset` (plus the three EIP-5792 methods
  with `enableBatchCalls`). Message signing (`personal_sign`, `eth_signTypedData_v4`) is refused with 4200: the embed
  never signs messages. While `accounts` is empty it answers the page itself: `eth_requestAccounts` then triggers
  `onConnectRequest(null)`.
- **Reown AppKit:** copy flipper-sdk's `android/samples/ReownAppKitWallet.kt` into the app. Then:
  - call `AppKit.setChains(listOf(RobinhoodChain, ...))`;
  - create **one** `ReownAppKitWallet().also { it.register() }` after `AppKit.initialize`, in the Application;
  - open the AppKit sheet (`AppKitComponent` in a `ModalBottomSheet`, or `navController.openAppKit()`) from
    `onConnectRequest`.

  `RobinhoodChain` is `eip155:4663`, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer
  `https://robinhoodchain.blockscout.com`.

## 5. Config and theme

| API | URL param / live field | Notes |
|---|---|---|
| `FlipperConfig.chain` | `chain` | default 4663 (Robinhood Chain); 31337 = local fork. **Reloads** when changed. |
| `FlipperConfig.partner` | `partner` | attribution id `[A-Za-z0-9._:-]{1,64}`, echoed in events. **Reloads** when changed. |
| `FlipperConfig.token` / `tokens` | `token` / `tokens` | preselected token / picker allowlist |
| `FlipperConfig.locale` | `locale` | BCP 47 |
| `FlipperConfig.compact` | `compact` / live `variant` | compact layout |
| `FlipperConfig.mode` | `mode` | `FlipperTokenMode.SINGLE`: one fixed token (needs `token`), no picker |
| `FlipperConfig.fit` | `fit` | `FlipperFit.FILL`: fill the view's size (autoHeight off) |
| `FlipperConfig.hidePicker` | `hidePicker` | deprecated: use `mode` |
| `FlipperConfig.details` | `details` | opt-in win chance / payout / fee line (default off) |
| `FlipperConfig.tagline` | `tagline` | opt-in idle headline: `FlipperTagline.BuiltIn` or `FlipperTagline.Text("…")` |
| `FlipperConfig.branding` | `branding` | `false` removes flipper.family marks |
| `FlipperConfig.extra` | `config` (base64 JSON) | use `flipperExtraConfig(brandName, brandLogo, coinImage, coinImageTails, strings, minAmount, maxAmount, approval, listing, rpcUrl, apiUrl, addresses, themeTokens, other)`. Images as `data:` URIs (the embed's CSP loads no other image hosts). `rpcUrl` / `apiUrl` / `addresses` never go in the URL: they're sent in a `config` message after every `ready` |
| `FlipperTheme(mode, accent, radius)` | `theme`, `accent`, `radius` | `LIGHT` / `DARK` / `AUTO`; CSS colour; px 0..40 |
| `FlipperWidgetOptions.baseUrl` | (the page) | https only. **Reloads** when changed. |
| `FlipperWidgetOptions.allowedMethods` | (none) | narrows the RPC allowlist (never widens it) |
| `FlipperWidgetOptions.enableBatchCalls` | (none) | default `false`. Forward the EIP-5792 batch methods (`wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus`) only if the wallet supports them; the embed then does a one-confirmation native-ETH flip. When off they're answered 4200 and the embed falls back. XML: `app:flipperEnableBatchCalls` |
| `FlipperWidgetOptions.autoHeight`, `initialHeightDp` (560), `minHeightDp` (120), `maxHeightDp` | (none) | sizing |

Changing anything except chain, partner or baseUrl is sent to the page live, without a reload. For imperative
changes in Compose, use `rememberFlipperWidgetController()` with `.setConfig(...)` and `.reload()`.

## 6. Events

`onEvent(FlipperEvent)` receives every event, then the typed callback runs. Every event keeps its raw JSON in
`event.data`, and every field is nullable.

| Callback | Event and key fields |
|---|---|
| `onReady` | `Ready`: `version, chainId, account, token, variant` |
| `onConnectRequest(reason)` | `reason`: `connect`, `flip` or `list`; null means an `eth_requestAccounts` with no wallet |
| `onFlipRequested` | `FlipRequested`: `flipId, amount, token, txHash, native, ...` |
| `onFlipSettled` | `FlipSettled`: `flipId, outcome, status, won, pending, payout, payoutToken, txHash, native` |
| `onPayoutResolved` | `PayoutResolved`: `flipId, tokenPaid, flipperPaid, by, native, txHash` |
| `onListing` | `Listing`: `stage, token, txHash, error` |
| `onError` | `Error`: `code, message, context` |
| `onResize(heightDp)` | height in dp |

`onFlipSettled`: `status` is a **string**, and `outcome` is `"won"`, `"lost"` or `"refunded"`. A `WinPending` flip
(stake back, winnings still owed; the widget offers Retry payout) gets a second `flip-settled` event with the same
`flipId` once they're paid; de-duplicate by `flipId`, and treat the last one as final. `onPayoutResolved` fires
once alongside it (`by` is `"self"` or `"other"`).

`onError` also carries host-side problems:

| `code` | When |
|---|---|
| `config` | bad URL; the SDK never loads it |
| `network` | the page failed to load |
| `webview` | the WebView is missing, or its renderer died |

## 7. Security notes to keep

- Don't set `allowInsecureLocalhost = true` in release builds, and don't point `baseUrl` at http. By default
  http is accepted only for `localhost`, `127.0.0.1`, `10.0.2.2` and `[::1]` in debuggable apps.
- Don't widen cleartext for the release app. Allow `10.0.2.2` / `localhost` only in a
  `src/debug` network security config.
- Leave the SDK's WebView settings, navigation policy and message checks alone. External links already open in the
  browser; to use Custom Tabs, set `onOpenExternalUrl`.
- Never log or send private keys or seed phrases anywhere near the widget. The bridge carries public data only.

## 8. Gotchas

- **Local dev.** From the emulator, use
  `FlipperWidgetOptions(baseUrl = FlipperDefaults.EMULATOR_DEV_EMBED_URL)` (`http://10.0.2.2:3000/embed`) with
  `FlipperConfig(chain = 31337)`. You also need a debug-only cleartext config. On a device, run
  `adb reverse tcp:3000 tcp:3000` and use `http://localhost:3000/embed`.
- **Views sizing.** Use `wrap_content` for auto-height; `match_parent` or a fixed height disables it.
- **Compose sizing.** Don't set a height on the modifier unless you want a fixed size.
- **Stuck spinner.** A `request` that never returns leaves the widget waiting. Always resolve or throw 4001.
- **Reown AppKit adapter.** Register it once per process: `AppKit.setDelegate` accumulates delegates. AppKit
  1.6.x is built with Kotlin 2.4 metadata, so the app needs Kotlin 2.3 or newer.
- **Redirects.** A redirect from `baseUrl` to another origin is treated as an external link. Use the final URL.
- **Minification.** R8 is handled by the AAR's consumer rules; don't disable consumer ProGuard files.
