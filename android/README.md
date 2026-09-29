# flipper.family widget for Android

`family.flipper:widget` is a drop-in, white-label [flipper.family](https://flipper.family) coin-flip widget for
Android apps, for both Views and Jetpack Compose. It loads the hosted embed page (`https://flipper.family/embed`)
in a hardened `WebView`. The embed has no wallet of its own, so the SDK routes its wallet requests to a wallet
that your app supplies. The user signs every transaction in your wallet's own confirmation UI.

> **Status: 0.1.0, compile-checked but never built with Gradle or run on a device.** Gradle couldn't run where
> this was written: the only JDKs available were Java 8 and Android Studio's Java 25. So the checks were done
> directly with the tools and jars already on the machine:
>
> - All Kotlin sources were compiled with kotlinc 2.1.20 and the Compose compiler plugin: the library, the Compose
>   API, the tests and the Reown sample.
> - They were compiled against the android-36 `android.jar`, Compose 1.7.6 (the version BOM 2024.12.01 selects),
>   androidx.webkit 1.12.1 and lifecycle 2.8.7.
> - The Reown sample was compiled against AppKit 1.6.17.
> - `res/` and the manifest pass `aapt2 compile/link`.
> - The 45 JVM unit tests pass (run with coroutines 1.10.1 and serialization-json 1.6.3).
>
> **Not verified yet:** the Gradle build itself (AGP 8.7.3, `maven-publish`, signing, the AGP/Dokka javadoc jar)
> and runtime behaviour in a real WebView. Run `gradle wrapper` once, then `./gradlew :widget:build`
> (see [Building](#building-and-testing)), then try it on an emulator.

The embed side of the protocol is specified in [`packages/widget/BRIDGE.md`](../widget/BRIDGE.md). This SDK
implements the host side, and it behaves the same as the React Native, Flutter and iOS SDKs.

- [Install](#install)
- [Quick start](#quick-start)
- [Wallet wiring](#wallet-wiring)
- [Configuration, theme and white-label](#configuration-theme-and-white-label)
- [Events](#events)
- [Auto-height](#auto-height)
- [Security](#security)
- [Local development](#local-development)
- [Troubleshooting](#troubleshooting)
- [Advanced: your own WebView](#advanced-your-own-webview)
- [Building and testing](#building-and-testing)
- [Publishing to Maven Central](#publishing-to-maven-central)

## Install

```kotlin
// app/build.gradle.kts
dependencies {
    implementation("family.flipper:widget:0.1.0")
}
```

Requirements:

- `minSdk` 24 or higher, `compileSdk` 35 or higher, Java/Kotlin target 17, and Kotlin 2.0 or newer in the app.
  The library is built with Kotlin 2.1.
- The **INTERNET** permission is declared in the library manifest and merged into your app automatically.
- The artifact includes the Compose API, so it depends on Compose `runtime` and `ui` (BOM 2024.12.01) even if you
  only use Views. R8 removes the parts you don't use.
- Transitive dependencies: `androidx.webkit:webkit`, `androidx.lifecycle:lifecycle-runtime`,
  `kotlinx-coroutines-android` and `kotlinx-serialization-json`. The library itself doesn't use the serialization
  compiler plugin, and your app doesn't need it either.
- **Cleartext HTTP (local development only).** Android 9+ blocks `http://`. To point the widget at a dev server,
  allow cleartext in **debug builds only**, never in release:

  ```xml
  <!-- app/src/debug/res/xml/network_security_config.xml -->
  <network-security-config>
      <domain-config cleartextTrafficPermitted="true">
          <domain includeSubdomains="false">10.0.2.2</domain>
          <domain includeSubdomains="false">localhost</domain>
          <domain includeSubdomains="false">127.0.0.1</domain>
      </domain-config>
  </network-security-config>
  ```

  ```xml
  <!-- app/src/debug/AndroidManifest.xml (merged into debug builds only) -->
  <manifest xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:tools="http://schemas.android.com/tools">
      <application
          android:networkSecurityConfig="@xml/network_security_config"
          tools:replace="android:networkSecurityConfig" />
  </manifest>
  ```

  Leave out `tools:replace` if your main manifest doesn't set a network security config.

## Quick start

### Jetpack Compose

```kotlin
import family.flipper.widget.*

@Composable
fun FlipScreen(wallet: FlipperWallet?, openConnect: () -> Unit) {
    FlipperWidget(
        modifier = Modifier.fillMaxWidth(),
        wallet = wallet,                                   // null = read-only, "Connect" asks you
        config = FlipperConfig(partner = "acme"),
        theme = FlipperTheme(
            mode = if (isSystemInDarkTheme()) FlipperThemeMode.DARK else FlipperThemeMode.LIGHT,
            accent = "#7C5CFF",
        ),
        onConnectRequest = { openConnect() },
        onFlipSettled = { e -> Log.i("flip", "${e.flipId} ${e.outcome} ${e.status}") },
        onError = { e -> Log.w("flip", "${e.code}: ${e.message}") },
    )
}
```

The composable sizes its own height to the widget (see [Auto-height](#auto-height)), and cleans up the `WebView`
when it leaves the composition. If you need to reload or change config imperatively, use a controller:

```kotlin
val controller = rememberFlipperWidgetController()
FlipperWidget(controller = controller, wallet = wallet)
Button(onClick = { controller.setConfig(theme = FlipperTheme(FlipperThemeMode.DARK)) }) { Text("Dark") }
Button(onClick = { controller.reload() }) { Text("Reload") }
```

### Views (XML)

```xml
<family.flipper.widget.FlipperWidgetView
    android:id="@+id/flipper"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    app:flipperPartner="acme"
    app:flipperThemeMode="dark"
    app:flipperAccent="#7C5CFF" />
```

```kotlin
val widget = findViewById<FlipperWidgetView>(R.id.flipper)
widget.wallet = myWallet
widget.onConnectRequest = { reason -> openMyConnectSheet() }
widget.onFlipSettled = { e -> showToast("${e.outcome}: ${e.payout}") }
```

### Views (code)

```kotlin
val widget = FlipperWidgetView(context).apply {
    configure(
        config = FlipperConfig(chain = 4663, partner = "acme", locale = "es"),
        theme = FlipperTheme(mode = FlipperThemeMode.AUTO, radius = 16),
        options = FlipperWidgetOptions(maxHeightDp = 720),
        wallet = myWallet,
    )
    listener = object : FlipperWidgetListener {
        override fun onConnectRequest(reason: String?) = openMyConnectSheet()
        override fun onFlipSettled(event: FlipperEvent.FlipSettled) = track(event)
    }
}
container.addView(widget, ViewGroup.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
```

The page loads when the view is first attached to a window, so everything you set before that goes into the first
URL. The view destroys itself when its view-tree `LifecycleOwner` (your Activity, or your Fragment's view) is
destroyed. If you manage the lifecycle yourself, set `autoDestroy = false` and call `destroy()`. Call every method
on the main thread.

XML attributes: `flipperBaseUrl`, `flipperChain`, `flipperToken`, `flipperTokens` (comma-separated),
`flipperPartner`, `flipperLocale`, `flipperCompact`, `flipperHidePicker`, `flipperBranding`, `flipperThemeMode`
(`light|dark|auto`), `flipperAccent`, `flipperRadius`, `flipperAutoHeight`, `flipperInitialHeight`,
`flipperMinHeight`, `flipperMaxHeight` (dimensions), `flipperAllowInsecureLocalhost`.

## Wallet wiring

The widget borrows your app's wallet through one interface:

```kotlin
interface FlipperWallet {
    suspend fun request(method: String, params: JsonElement): JsonElement  // EIP-1193
    val accounts: Flow<List<String>>   // active account first; empty = disconnected
    val chainId: Flow<Long?>           // null = unknown
}
```

- `request` receives only these methods: `eth_accounts`, `eth_requestAccounts`, `eth_chainId`,
  `eth_sendTransaction`, `wallet_switchEthereumChain`, `wallet_addEthereumChain` and `wallet_watchAsset`.
  Everything else, including message signing (`personal_sign`, `eth_signTypedData_v4`), is refused with 4200 before
  it reaches you. `options.enableBatchCalls` adds the three EIP-5792 methods (see "Batched calls"), and
  `options.allowedMethods` can narrow the list, but nothing outside the embed's 10 methods is ever forwarded.
- `params` is the JSON array (or object) exactly as the page sent it. `eth_sendTransaction` arrives fully
  specified: `gas`, EIP-1559 fees, and already simulated. Forward it unchanged apart from what your wallet normally
  adds, such as the nonce.
- Return the JSON result: a tx hash `JsonPrimitive("0x...")`, `JsonNull`, a `JsonArray`, and so on.
- **Show your wallet's own confirmation UI for every transaction and signature. Never auto-approve.**
- There is no timeout. If the user closes your prompt, throw `FlipperRpcException(4001, ...)` so the widget
  doesn't wait forever.
- After a successful `wallet_switchEthereumChain`, emit the new id from `chainId`. The widget needs a `wallet`
  message to see the switch.
- `request` runs on the main thread. Switch dispatchers yourself for blocking work.

The simplest implementation extends `MutableFlipperWallet`:

```kotlin
class MyWallet(private val signer: MySigner) : MutableFlipperWallet() {
    override suspend fun request(method: String, params: JsonElement): JsonElement = when (method) {
        "eth_sendTransaction" -> {
            val tx = params.jsonArray[0].jsonObject
            val approved = signer.confirm(tx) ?: throw FlipperRpcException.userRejected()
            JsonPrimitive(signer.send(approved))                    // tx hash
        }
        "wallet_switchEthereumChain" -> {
            val id = FlipperChainId.parse(params.jsonArray[0].jsonObject["chainId"])
                ?: throw FlipperRpcException(FlipperRpcException.INVALID_PARAMS, "Invalid params")
            if (!signer.supports(id)) throw FlipperRpcException.unrecognizedChain()   // 4902
            signer.switchTo(id); update(chainId = id); JsonNull
        }
        else -> throw FlipperRpcException(4200, "Unsupported method: $method")
    }
}

// when the user connects / switches / disconnects:
wallet.update(accounts = listOf(address), chainId = 4663)
wallet.disconnect()
```

### Batched calls (optional)

The embed can also send three EIP-5792 methods: `wallet_getCapabilities`, `wallet_sendCalls` and
`wallet_getCallsStatus`. With a wallet that supports atomic batches, a native-ETH flip is then one confirmation
(wrap, approve and flip together) instead of up to three. By default the SDK answers them with 4200, and the embed
falls back to separate transactions.

Opt in only if your wallet implements EIP-5792:

```kotlin
FlipperWidgetOptions(enableBatchCalls = true)   // XML: app:flipperEnableBatchCalls="true"
```

`allowedMethods` still narrows the result, and it can include the batch methods only when `enableBatchCalls` is on.
Nothing outside the embed's 10 methods (`FlipperBridge.BRIDGE_METHODS`) is ever forwarded. If your wallet can't handle
a batch request, throw `FlipperRpcException(4200, …)` and the embed falls back.

### Errors

Throw `FlipperRpcException(code, message, data?)` (alias `FlipperRpcError`). The code reaches the page unchanged,
and the widget turns it into a plain-English message. Any other exception becomes `-32603` with the exception's
message, or `"Internal error"` if it has none.

| Code | Meaning |
|---|---|
| `4001` | user rejected the request |
| `4100` | not authorized / no account (the SDK sends it when there is no wallet) |
| `4200` | unsupported method (the SDK sends it for anything outside the allowlist) |
| `4900` / `4901` | disconnected / not connected to the requested chain |
| `4902` | unrecognized chain: answer to `wallet_switchEthereumChain`. The widget then sends `wallet_addEthereumChain` |
| `-32600` | invalid request (the SDK sends it for a duplicate in-flight id or a non-string method) |
| `-32602` / `-32603` | invalid params / internal error |

### No wallet, and the connect flow

While `wallet` is null, or its `accounts` is empty, the SDK answers the page itself and doesn't call `request`:

| Method | Answer |
|---|---|
| `eth_accounts` | `[]` |
| `eth_chainId` | hex of the configured `chain` (`0x1237` for 4663) |
| `eth_requestAccounts` | calls `onConnectRequest(null)`, then error 4100 "No wallet connected. The host app was asked to connect one." |
| anything else | error 4100 "No wallet connected." |

When the user taps **Connect**, the widget sends a `connect-request` event, and the SDK calls
`onConnectRequest(reason)` with `"connect"`, `"flip"` or `"list"`. Open your wallet UI. Once the user has
connected, update `accounts`/`chainId`, and the SDK pushes a `wallet` message to the page. The SDK pushes wallet
state after every `ready` and on every change. It skips a state identical to the last one sent. Without a
connected wallet, or when the chain is unknown, it sends the configured chain.

Setting `wallet` to a different object resubscribes to its flows. Setting it to null pushes
`accounts: []` with the configured chain.

### Reown AppKit

The library doesn't depend on Reown. [`samples/ReownAppKitWallet.kt`](samples/ReownAppKitWallet.kt) is a complete
adapter to copy into an app that uses [Reown AppKit for Android](https://docs.reown.com/appkit/android/core/usage)
(`com.reown:android-bom`, `com.reown:android-core`, `com.reown:appkit`). It:

- sends requests with `AppKit.request(Request(method, params.toString(), chainId), onSuccess = { sent -> ... },
  onError = { ... })`, and matches `SentRequestResult.WalletConnect.requestId` against
  `AppKit.ModalDelegate.onSessionRequestResponse(Modal.Model.SessionRequestResponse)`. A
  `JsonRpcResponse.JsonRpcResult` resolves the request, and a `JsonRpcResponse.JsonRpcError` becomes
  `FlipperRpcException(code, message)` with the code passed through. It also buffers responses that arrive before
  `onSuccess`. Coinbase sessions answer through `SentRequestResult.Coinbase.results`.
- keeps `accounts`/`chainId` from `AppKit.getAccount()` (on `Dispatchers.IO`, because it blocks), refreshed on
  `onSessionApproved`, `onSessionUpdate`, `onSessionEvent` (including `chainChanged`), `onSessionExtend` and
  `onSessionDelete`.
- answers `eth_accounts` / `eth_requestAccounts` / `eth_chainId` from that state. WalletConnect wallets don't
  serve these over the relay.
- handles `wallet_switchEthereumChain` locally when the session already approved the target chain, and asks the
  wallet otherwise. The wallet may answer 4902, and the widget then follows up with `wallet_addEthereumChain`.
- declares **Robinhood Chain as a custom `Modal.Model.Chain`** (`RobinhoodChain`): `eip155:4663`, ETH with 18
  decimals, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `https://robinhoodchain.blockscout.com`. Pass it
  to `AppKit.setChains(...)` before opening the modal.

```kotlin
// Application.onCreate, after CoreClient.initialize(...) and AppKit.initialize(...)
AppKit.setChains(listOf(RobinhoodChain))
val wallet = ReownAppKitWallet().also { it.register() }   // ONE instance per process

// Compose: open the AppKit sheet on connect requests
var showAppKit by remember { mutableStateOf(false) }
FlipperWidget(wallet = wallet, onConnectRequest = { showAppKit = true })
if (showAppKit) {
    ModalBottomSheet(onDismissRequest = { showAppKit = false }) {
        AppKitComponent(shouldOpenChooseNetwork = false, closeModal = { showAppKit = false })
    }
}
// or, with navigation-compose + appKitGraph(navController): navController.openAppKit(shouldOpenChooseNetwork = false)
```

Details to check against your AppKit version: the sample compiles against the AppKit 1.6.17 classes. AppKit
1.6.17 is built with Kotlin 2.4 metadata, so **an app on that version needs Kotlin 2.3 or newer**; this library
itself needs only 2.1. Three points are inferred rather than documented, and are marked `UNVERIFIED`
in the file:

- the type of `JsonRpcResult.result`, which is `Any?` and in practice a String;
- whether `AppKit.getAccount()` reflects `chainChanged` right away;
- how each wallet handles `wallet_switchEthereumChain` over WalletConnect.

`AppKit.setDelegate` adds collectors every time you call it, so register the adapter once.

## Configuration, theme and white-label

```kotlin
FlipperConfig(
    chain = 4663,                 // Robinhood Chain (default), always sent; 31337 = local fork
    token = "0x...",              // token selected at start
    tokens = listOf("0x...", "0x..."), // picker allowlist
    partner = "acme",             // attribution id [A-Za-z0-9._:-]{1,64}, echoed in every event
    locale = "es",                // BCP 47; unknown locales fall back to English
    compact = true,               // compact layout
    branding = false,             // remove flipper.family marks (white-label)
    mode = FlipperTokenMode.SINGLE, // one fixed token (needs `token`), no picker; PICKER (default) lets users choose
    fit = FlipperFit.FILL,        // fill the view's size (autoHeight off); AUTO (default): content height
    details = true,               // opt-in win chance / payout / fee line (default off: only an odds deviation note)
    tagline = FlipperTagline.BuiltIn, // opt-in idle headline; or FlipperTagline.Text("Double or nothing on Acme")
    extra = flipperExtraConfig(   // everything else the embed accepts
        brandName = "Acme Flips",
        brandLogo = "data:image/png;base64,iVBORw0…", // images as data: URIs: the embed's CSP loads no other hosts
        coinImage = "data:image/png;base64,iVBORw0…",
        coinImageTails = "data:image/png;base64,iVBORw0…",
        strings = mapOf("flip" to "Toss"),
        minAmount = "10", maxAmount = "5000",
        approval = "exact",       // or "max" (default)
        listing = false,          // hide permissionless listing
        themeTokens = null,       // the embed's custom theme object (sent as `theme`)
    ),
)
FlipperTheme(mode = FlipperThemeMode.DARK, accent = "#ff5a1f", radius = 12)
FlipperWidgetOptions(
    baseUrl = "https://flipper.family/embed",
    allowInsecureLocalhost = null, // null = only in debuggable apps
    allowedMethods = null,         // narrow the RPC allowlist, e.g. setOf("eth_accounts", "eth_chainId", "eth_sendTransaction")
    enableBatchCalls = false,      // forward the EIP-5792 batch methods (see "Batched calls")
    autoHeight = true, initialHeightDp = 560, minHeightDp = 120, maxHeightDp = null,
)
```

| Field | URL param | Live `config` message | Change after load |
|---|---|---|---|
| `options.baseUrl` | (the page) | | reload |
| `config.chain` | `chain` (always) | | reload |
| `config.partner` | `partner` | | reload |
| `config.token` | `token` | `token` | live |
| `config.tokens` | `tokens` (comma-separated) | `tokens` (array) | live |
| `config.locale` | `locale` | `locale` | live |
| `config.compact` | `compact=1/0` | `variant: "compact" \| "card"` | live |
| `config.mode` | `mode=picker\|single` | `mode` | live |
| `config.fit` | `fit=auto\|fill` | `fit` | live |
| `config.details` | `details=1/0` | `details` | live |
| `config.tagline` | `tagline=1` or the text | `tagline` (`true` / text; `false` when unset) | live |
| `config.hidePicker` (deprecated: use `mode`) | `hidePicker=1/0` | `hidePicker` | live |
| `config.branding` | `branding=1/0` | `branding` | live |
| `theme.mode` | `theme=light\|dark\|auto` | `theme` | live |
| `theme.accent` | `accent` (URL-encoded, `#` kept) | `accent` | live |
| `theme.radius` | `radius` | `radius` | live |
| `config.extra` | `config` (standard base64 JSON, URL-encoded) | keys spread at top level | live |
| `config.extra` `rpcUrl` / `apiUrl` / `addresses` | never (the embed ignores them in its URL) | after every `ready` (`FlipperBridge.hostConfig`) | live |

- Only fields that are set go into the URL. Params already on `baseUrl` are kept, except the ones the SDK sets.
- Live changes go out as **one** `config` message with only the changed fields. It is queued and merged until the
  page is `ready`. If you unset a boolean or enum, the SDK sends its default (`variant: "card"`, `branding: true`,
  `hidePicker: false`, `theme: "auto"`). Other unset fields go out as `null`.
- The embed applies `config` after the individual params, so `extra` wins over typed fields with the same name.
  `extra` can't override the message envelope (`v`, `source` and `type` are ignored).
- `rpcUrl`, `apiUrl` and `addresses` decide where funds, approvals and reads go, so the embed never takes them from
  its URL (anyone can craft one). The SDK leaves them out of the URL and sends them in a `config` message after every
  `ready` instead. The embed's CSP still only connects to flipper's own RPC and API.
- Match the host's dark mode by passing `FlipperThemeMode.DARK/LIGHT` from `isSystemInDarkTheme()` or your app
  theme. With `AUTO`, the page follows `prefers-color-scheme`. In a WebView, that comes from your app theme's
  `isLightTheme` when you target API 33 or higher. The SDK disables WebView algorithmic darkening, so your colours
  stay exact.

## Events

For every event, `onEvent(event)` runs first. It runs for every event, including names this SDK version doesn't
know, which arrive as `FlipperEvent.Unknown`. The typed callback runs after it. Parsing is lenient: fields are
nullable, and `event.data` always holds the raw JSON. Amounts are decimal strings in the token's smallest unit.
`event.partner` is available on every event.

| Callback | `FlipperEvent` | Fields |
|---|---|---|
| `onReady` | `Ready` | `version, chainId, account, token, variant` |
| `onConnectRequest(reason)` | `ConnectRequest` | `reason`: `connect` \| `flip` \| `list` (null when triggered by `eth_requestAccounts`) |
| `onFlipRequested` | `FlipRequested` | `flipId, account, token, symbol, decimals, amount, winChanceBps, randomnessFee, txHash, approveTxHash, native` |
| `onFlipSettled` | `FlipSettled` | `flipId, account, token, symbol, decimals, amount, outcome (won\|lost\|refunded), status (Won\|WonFallback\|WinPending\|Lost\|LostInventory\|Refunded), won, pending, payout, payoutToken, flipperPaid, txHash, requestTxHash, native` |
| `onPayoutResolved` | `PayoutResolved` | `flipId, account, token, symbol, decimals, tokenPaid, flipperPaid, by (self\|other), native, txHash` |
| `onListing` | `Listing` | `stage (started\|submitted\|listed\|failed), token, symbol, txHash, error` |
| `onError` | `Error` | `code, message, context` |
| `onResize(heightDp)` | `Resize` | `width, height` (CSS px) |

- A pending win (`status == "WinPending"`, `pending == true`) means the stake came back but the winnings are still
  owed; the widget shows them with a Retry payout button. It gets a second `flip-settled` for the same `flipId`
  once the winnings are paid. De-duplicate by `flipId`: the last event is final.
- `onPayoutResolved` fires once per pending win, alongside that final `flip-settled`. `tokenPaid` is the winnings
  in `token` (the stake already came back); `flipperPaid` is $FLIPPER paid instead, `"0"` unless the token still
  couldn't be bought after the pending timeout. `by` is `self` when this widget's Retry payout paid it, `other`
  when someone else did (usually flipper's payout worker). `native` is true when the stake was native ETH: `token`
  is WETH (the winnings are paid in WETH) and `symbol` is `"ETH"`. A pending win the widget only learned about from
  an earlier session reports `native: false` and `"WETH"`. Retry errors arrive through `onError` with context
  `flip`.
- `onError` also reports host-side problems:

  | `code` | When |
  |---|---|
  | `config` | the URL was refused. The SDK never loads a bad URL and blanks the view. |
  | `network` | the page failed to load |
  | `webview` | no WebView provider, or the renderer died. The SDK recreates the WebView and reloads up to 3 times. |

## Auto-height

The page reports `resize` events with its height in CSS px. The SDK computes `ceil(height)`, clamps it to
`[minHeightDp, maxHeightDp]`, and passes the result to `onResize`. One CSS px is one dp in the WebView. With
`autoHeight = true` (the default):

- **View**: use `layout_height="wrap_content"`. The view measures `initialHeightDp` (560) until the first `resize`,
  then the page's height converted with `displayMetrics.density`. `match_parent` or a fixed height always wins.
- **Compose**: the composable applies `Modifier.height(...)` from the latest resize. An explicit height earlier in
  your `modifier` wins.
- Heights are capped at 20,000 dp as a safety limit.

With `autoHeight = false`, size the widget yourself. The page then scrolls inside it.

## Security

- **HTTPS only.** `baseUrl` must be `https`. Plain `http` is accepted only for `localhost`, `127.0.0.1`, `10.0.2.2`
  and `[::1]`, and only when `allowInsecureLocalhost` is on. It is on by default in debuggable apps, and off in
  release. URLs with user info (`user:pass@`), other schemes or no host are refused with `onError(code = "config")`
  and never loaded.
- **One origin.** Everything is checked against the embed origin (`scheme://host[:port]` of `baseUrl`):
  - Main-frame navigation to that origin loads.
  - Other http(s) links, `mailto:` and `tel:` open in the system browser or default app (`ACTION_VIEW` with
    `CATEGORY_BROWSABLE`; override with `onOpenExternalUrl` to use Custom Tabs).
  - `javascript:`, `file:`, `data:`, `content:`, `intent:` and custom schemes are blocked.
  - `target=_blank` and `window.open` never create a new WebView (`setSupportMultipleWindows(false)`).
  - Sub-frames may load only `about:blank`, `about:srcdoc` and the embed origin. Android only reports non-http(s)
    sub-frame navigations to the app, so an iframe of another https origin can't be blocked there. Such an iframe
    can't talk to the host (next point), and the embed page itself loads scripts only from its own origin.
- **Message checks.** `window.FlipperHost` is provided with `WebViewCompat.addWebMessageListener`, scoped to the
  embed origin. The SDK accepts a message only when all of these hold:
  - it came from the main frame, and its origin equals the embed origin;
  - it is at most 524,288 characters;
  - it is a JSON object with `v === 1` and `source === "flipper"`.

  Replies from a previous page load are discarded.
  - **Fallback:** on WebView versions without `WEB_MESSAGE_LISTENER` (older than about 2020), the SDK falls back to
    `addJavascriptInterface(obj, "FlipperHost")`. That object is injected into every frame, and Android gives no
    frame info, so messages are checked against the WebView's current URL origin instead.
  - **Residual risk:** a cross-origin iframe inside the embed page could post messages that pass this check. The
    embed page doesn't create such iframes, and every wallet action still needs the user's confirmation in your
    wallet.
- **RPC allowlist.** Only the seven wallet methods above can cross the bridge, and none of them signs a message. You
  can narrow the list, never widen it. Reads go through the embed's own RPC.
- **No keys in the page.** The page never receives private keys, sessions or tokens. Only public wallet state
  (accounts, chain) crosses the bridge.
- **Your wallet confirms everything.** Every transaction and signature must go through your wallet's own
  confirmation UI. **Never auto-approve bridge requests**, and never sign on the page's behalf without the user's
  prompt.
- **WebView hardening:**
  - JavaScript and DOM storage are on. That is all the page needs.
  - File and content access is off, including universal and file access from file URLs.
  - Mixed content is `NEVER_ALLOW`.
  - Geolocation is off, and camera, microphone and other permission requests are denied.
  - Zoom is off, windows don't open automatically, and Safe Browsing is on.
  - The background is transparent.
  - `WebView.setWebContentsDebuggingEnabled(true)` is set only when the app is debuggable.
  - Renderer crashes are contained (`onRenderProcessGone`).

## Local development

The repo's `./dev.sh` runs the web app at `http://localhost:3000` against an anvil fork that uses **chain id
31337**. From the Android emulator, the host machine is `10.0.2.2`:

```kotlin
FlipperWidget(
    wallet = wallet,
    config = FlipperConfig(chain = FlipperDefaults.LOCAL_CHAIN_ID),               // 31337
    options = FlipperWidgetOptions(baseUrl = FlipperDefaults.EMULATOR_DEV_EMBED_URL), // http://10.0.2.2:3000/embed
)
```

- Allow cleartext for `10.0.2.2` in a **debug** network security config ([Install](#install)).
- `http://` works only in debuggable builds, unless you set `allowInsecureLocalhost = true`. Never ship that.
- On a physical device, run `adb reverse tcp:3000 tcp:3000` and use `http://localhost:3000/embed`.
- Your wallet must be on chain 31337 with RPC `http://10.0.2.2:8545` from the emulator.
- Inspect the page at `chrome://inspect` (debug builds only).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `onError(code = "config")` with an http URL | Use https, or a debug build with a debug host, or set `allowInsecureLocalhost = true` (dev only). |
| Blank page from `http://10.0.2.2:3000`, `net::ERR_CLEARTEXT_NOT_PERMITTED` | Add the debug network security config. |
| Widget never gets `ready` | Check `chrome://inspect` for page errors. The page must be served from `baseUrl`'s origin: a redirect to another origin (`flipper.family` to `www.flipper.family`) is treated as an external link. Use the final URL. |
| Connect button does nothing | Handle `onConnectRequest`, and make sure your wallet's `accounts` flow emits after connecting. |
| "Switch to Robinhood Chain" loops | Emit the new chain from `chainId` after `wallet_switchEthereumChain` succeeds, or throw 4902 if the wallet doesn't know the chain. |
| Flip spinner waits forever | Your `request` never returned. Throw `FlipperRpcException(4001, ...)` when the user closes the prompt. |
| Height doesn't follow the widget | Use `wrap_content` (View), or no fixed height (Compose), and keep `autoHeight = true`. |
| Links don't open | `onOpenExternalUrl` returned true, or no app handles the URL (logged). |
| `@JavascriptInterface` fallback stripped by R8 | The AAR ships `consumer-rules.pro`. Make sure consumer rules aren't disabled. |
| Java callers must implement every listener method | The library is compiled with `-Xjvm-default=all`. If your toolchain doesn't see the defaults, extend a Kotlin adapter class. |

## Advanced: your own WebView

`FlipperBridge` is the whole protocol with no WebView dependency. Feed it the raw strings from
`window.FlipperHost.postMessage`, the sending frame's origin and whether it came from the main frame. Evaluate the
JavaScript it gives you in the page, and call `onPageStarted()` on every top-level load.

```kotlin
val bridge = FlipperBridge(
    scope = lifecycleScope,
    evaluateJavascript = { js -> webView.evaluateJavascript(js, null) },
    listener = myListener,
    embedOrigin = EmbedUrl.validate(baseUrl, allowInsecureLocalhost = BuildConfig.DEBUG),
)
bridge.wallet = myWallet
// WebMessageListener:   bridge.onMessage(message.data!!, sourceOrigin.toString(), isMainFrame)
// WebViewClient.onPageStarted: bridge.onPageStarted()
```

`EmbedUrl.build(...)` builds and validates the URL, and `NavigationPolicy.decide(url, isMainFrame, origin)` gives
the navigation decision.

## Building and testing

The repo doesn't include `gradlew`/`gradle-wrapper.jar`. Generate them once with any Gradle 8.9 or newer (the
wrapper is pinned to 8.11.1 in `gradle/wrapper/gradle-wrapper.properties`):

```sh
cd packages/android
gradle wrapper --gradle-version 8.11.1      # creates gradlew, gradlew.bat, gradle/wrapper/gradle-wrapper.jar
./gradlew :widget:testDebugUnitTest          # JVM unit tests: FlipperBridgeTest, EmbedUrlTest
./gradlew :widget:assembleRelease            # build/outputs/aar/widget-release.aar
./gradlew :widget:publishToMavenLocal        # try it from another project via mavenLocal()
```

You need JDK 17 or newer and the Android SDK with platform 35 (`ANDROID_HOME`, or `sdk.dir` in
`local.properties`). The unit tests cover the pure layer:

- source, version and type filtering; origin and main-frame checks; size limits;
- the allowlist and narrowing; id matching (string and number ids); duplicate ids; error mapping; no-wallet
  answers; page generations;
- the ready queue: coalescing, merging and its limit; wallet-state pushes; resize clamping; JS escaping (including
  U+2028/U+2029);
- chain-id normalization; URL building and validation; base64 config; the navigation policy; config diffs.

Version set:

- AGP 8.7.3, Gradle 8.11.1, Kotlin 2.1.21 with the Compose compiler plugin;
- Compose BOM 2024.12.01, androidx.webkit 1.12.1, lifecycle 2.8.7;
- coroutines 1.10.2, serialization-json 1.8.1, JUnit 4.13.2.

Newer AGP 9 applies Kotlin itself, so moving there means dropping the `kotlin-android` plugin.

## Publishing to Maven Central

Coordinates: **`family.flipper:widget:0.1.0`**. The build publishes the `release` AAR, its sources jar, its javadoc
jar (generated by AGP with Dokka), the POM (with name, description, URL, MIT license, developers and SCM) and the
Gradle module metadata. Each file gets a `.asc` signature and `.md5`/`.sha1`/`.sha256`/`.sha512` checksums.

The legacy OSSRH (`s01.oss.sonatype.org`) was shut down in 2025. Everything now goes through the **Central
Publisher Portal** (<https://central.sonatype.com>).

### One-time setup

1. **Account and namespace.** Sign in at <https://central.sonatype.com>, then go to **Namespaces**, **Add
   Namespace**, and enter `family.flipper`. The Portal shows a verification key. Add it as a **DNS TXT record on
   `flipper.family`** (the namespace is the reversed domain). Once the TXT record resolves, click **Verify
   Namespace**. You can remove the record after the namespace is verified.
2. **User token.** In the Portal, go to **Account**, then **Generate User Token**. This gives you a token username
   and password. Your login password doesn't work for publishing, and neither do old OSSRH tokens.
3. **GPG key.**

   ```sh
   gpg --full-generate-key                                   # RSA 4096 (or ed25519), with a passphrase
   gpg --list-secret-keys --keyid-format=long                # note the key id
   gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>  # Central checks public keyservers
   gpg --keyserver keys.openpgp.org --send-keys <KEYID>
   gpg --armor --export-secret-keys <KEYID> > signing-key.asc   # keep secret; never commit
   ```

4. **Credentials.** Put them in `~/.gradle/gradle.properties`, never in the repo, or pass them as
   `ORG_GRADLE_PROJECT_*` environment variables in CI:

   ```properties
   mavenCentralUsername=<token username>
   mavenCentralPassword=<token password>
   signingInMemoryKey=<contents of signing-key.asc; newlines escaped as \n, or use the env var>
   signingInMemoryKeyPassword=<gpg passphrase>
   # signingInMemoryKeyId=<last 8 hex of the key id>   (only for a subkey)
   ```

   In CI: `export ORG_GRADLE_PROJECT_signingInMemoryKey="$(cat signing-key.asc)"`. The plain `SIGNING_KEY`,
   `SIGNING_PASSWORD`, `MAVEN_CENTRAL_USERNAME` and `MAVEN_CENTRAL_PASSWORD` variables are read as well.

   Signing is required only when publishing a non-SNAPSHOT version to a Maven repository. `publishToMavenLocal`
   works without a key.

5. **SCM URL.** `widget/build.gradle.kts` points at the public repository,
   `https://github.com/flipperdotfamily/flipper-sdk`. Central requires valid SCM metadata.

### Release, option A (recommended): Portal bundle upload

This path doesn't depend on IP-bound staging, and it lets you review the deployment in the Portal UI before
publishing.

```sh
cd packages/android
rm -rf widget/build/staging-deploy
./gradlew :widget:publishReleasePublicationToStagingDeployRepository
cd widget/build/staging-deploy && zip -r ../widget-0.1.0-bundle.zip family && cd -
# upload in the UI (Deployments, then Publish Component), or with the Publisher API:
TOKEN=$(printf '%s:%s' "$MAVEN_CENTRAL_USERNAME" "$MAVEN_CENTRAL_PASSWORD" | base64)
curl --fail -X POST "https://central.sonatype.com/api/v1/publisher/upload?name=family.flipper:widget:0.1.0&publishingType=USER_MANAGED" \
     -H "Authorization: Bearer $TOKEN" \
     -F "bundle=@widget/build/widget-0.1.0-bundle.zip"
# -> deployment id. Check it with:
curl --fail -X POST -H "Authorization: Bearer $TOKEN" "https://central.sonatype.com/api/v1/publisher/status?id=<deployment id>"
```

When the deployment is `VALIDATED`, click **Publish** in the Portal. You can also
`POST /api/v1/publisher/deployment/<id>`, or upload with `publishingType=AUTOMATIC` to publish as soon as
validation passes. The bundle must contain only `family/flipper/widget/0.1.0/*`. Delete stray `maven-metadata.xml`
files if your Gradle version writes them.

### Release, option B: OSSRH Staging API compatibility endpoint

Use this if you'd rather keep a Gradle `publish` flow:

```sh
./gradlew :widget:publishReleasePublicationToCentralPortalRepository
# Required for Gradle's maven-publish: move the upload into the Portal, from the SAME machine/IP.
TOKEN=$(printf '%s:%s' "$MAVEN_CENTRAL_USERNAME" "$MAVEN_CENTRAL_PASSWORD" | base64)
curl --fail -X POST -H "Authorization: Bearer $TOKEN" \
  "https://ossrh-staging-api.central.sonatype.com/manual/upload/defaultRepository/family.flipper?publishing_type=user_managed"
```

Then review and publish it in the Portal. Use `publishing_type=automatic` to release as soon as validation passes.
Without the `/manual/upload` call, the deployment never shows up in the Portal.

### After publishing

The artifact usually appears on Maven Central (`repo1.maven.org`) within 30 minutes, and in search later. Versions
are immutable, so bump `VERSION_NAME` in `gradle.properties` for every release and add a `CHANGELOG.md` entry.
SNAPSHOT versions need snapshots enabled for the namespace in the Portal, and go to
`https://central.sonatype.com/repository/maven-snapshots/`. This build doesn't configure that.

If `withJavadocJar()` fails with Kotlin 2.x sources in AGP's bundled Dokka, a placeholder javadoc jar (a README
inside) is acceptable to Central. Alternatively, apply the Dokka plugin and attach its output.

## License

MIT, see [LICENSE](LICENSE).
