# flipper_family

The [flipper.family](https://flipper.family) coin-flip widget for Flutter apps. It is a drop-in widget you can
white-label. Your users flip listed tokens on Robinhood Chain against the house (the majors, Robinhood stock
tokens and a curated set of Robinhood Chain tokens at launch), and every transaction is signed by **the wallet your app
already has**.

`FlipperWidget` loads the hosted embed (`https://flipper.family/embed`) in a WebView. The embed has no wallet
of its own. It sends its wallet requests (connect, send a transaction, switch chain) over a small bridge to a
`FlipperWallet` that you supply, and it reports what happens (flips, listings, errors, its height) back to your
app as typed events.

> **Status: 0.1.0, not yet compiled.** This package was written in an environment without a Flutter SDK. Nothing
> in it has been compiled, analyzed or run, and that includes the tests. The code follows the official APIs of
> webview_flutter 4.10+, url_launcher 6.3+ and reown_appkit 1.9 closely. Before you publish or ship it, run
> `flutter analyze`, `flutter test` and the example app on a device.

- [Install](#install)
- [Quick start](#quick-start)
- [Wiring your wallet](#wiring-your-wallet)
- [Configuration, theming and white-label](#configuration-theming-and-white-label)
- [Events](#events)
- [Height](#height)
- [Controller](#controller)
- [Security](#security)
- [Local development](#local-development)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Publishing](#publishing)

## Install

```yaml
dependencies:
  flipper_family: ^0.1.0
```

The package supports Android and iOS. It needs Dart 3.6 and Flutter 3.27 or newer.

### Android

- `minSdkVersion` **24** or higher, in `android/app/build.gradle(.kts)`: `minSdk = 24`.
- Internet access. Flutter only adds this to debug builds, so declare it in `android/app/src/main/AndroidManifest.xml`:

  ```xml
  <uses-permission android:name="android.permission.INTERNET" />
  ```

- Links such as the block explorer, `mailto:` and `tel:` open in other apps through `url_launcher`. On Android 11
  and newer, declare the intents you open, inside `<manifest>`:

  ```xml
  <queries>
    <intent>
      <action android:name="android.intent.action.VIEW" />
      <data android:scheme="https" />
    </intent>
    <intent>
      <action android:name="android.intent.action.SENDTO" />
      <data android:scheme="mailto" />
    </intent>
    <intent>
      <action android:name="android.intent.action.DIAL" />
      <data android:scheme="tel" />
    </intent>
  </queries>
  ```

### iOS

- iOS 13 or newer (required by `webview_flutter_wkwebview`).
- No permissions are needed. The widget never asks for the camera, the microphone or the location.
- `url_launcher` opens links without extra configuration. If your app also calls `canLaunchUrl`, list the schemes
  in `Info.plist`:

  ```xml
  <key>LSApplicationQueriesSchemes</key>
  <array>
    <string>https</string>
    <string>mailto</string>
    <string>tel</string>
  </array>
  ```

## Quick start

```dart
import 'package:flipper_family/flipper_family.dart';

FlipperWidget(
  wallet: myWallet, // a FlipperWallet; null (or no accounts) = not connected
  config: const FlipperConfig(partner: 'acme'),
  theme: const FlipperTheme(mode: FlipperThemeMode.dark, accent: '#7C5CFF'),
  onConnectRequest: (_) => openMyConnectSheet(),
  onFlipSettled: (e) => debugPrint('flip ${e.flipId}: ${e.outcome}'),
)
```

The widget takes the full width it is given. By default it sizes its height to the embed's content, so you can
put it in a `ListView` or a `Column`. Without a wallet it still shows live prices and flip previews. When the
user taps **Connect**, the widget calls `onConnectRequest`, and you open your wallet UI.

## Wiring your wallet

Implement `FlipperWallet`, or extend `FlipperWalletBase`, which owns the streams for you:

```dart
abstract class FlipperWallet {
  Future<Object?> request(String method, Object? params); // EIP-1193
  List<String> get accounts;               // active account first, [] when disconnected
  int? get chainId;                        // null when unknown
  Stream<List<String>> get accountsChanges;
  Stream<int?> get chainIdChanges;
}
```

```dart
class MyWallet extends FlipperWalletBase {
  MyWallet(this.sdk) {
    sdk.onSessionChanged((s) => update(accounts: s.accounts, chainId: s.chainId));
  }
  final MyWalletSdk sdk;

  @override
  Future<Object?> request(String method, Object? params) =>
      sdk.request(method, params); // must show the wallet's own confirmation UI
}
```

- `update(accounts: ..., chainId: ...)` accepts `4663`, `"4663"`, `"0x1237"` or `"eip155:4663"`, and emits only
  what changed. Call `update(accounts: const [], chainId: null)` on disconnect.
- For a quick hookup without a class, `FlipperCallbackWallet(onRequest: (method, params) => ...)` does the same.
- If you implement `FlipperWallet` directly, update the `accounts` and `chainId` getters in the same synchronous
  block that emits on the streams. The widget reads the getters when a stream fires.
- Pass `null` (or a wallet without accounts) while nobody is connected. Swapping the wallet object is fine: the
  widget resubscribes and sends the new state.

### Methods the embed calls

By default only these seven, matched exactly (plus the three EIP-5792 methods with `enableBatchCalls`; see "Batched calls"): `eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `eth_sendTransaction`,
`wallet_switchEthereumChain`, `wallet_addEthereumChain` and `wallet_watchAsset`. Message signing (`personal_sign`,
`eth_signTypedData_v4`) is never forwarded, because the embed doesn't sign messages. In practice, v1 sends transactions (approvals, flips, listings), switches or adds the chain,
and watches assets after a win. `params` is always an EIP-1193 array. Transactions come fully specified (`gas`,
EIP-1559 fees), so forward them unchanged. Reads never reach your wallet, because the embed has its own RPC.

`allowedMethods` narrows this list. For example, `{'eth_sendTransaction', 'wallet_switchEthereumChain',
'wallet_addEthereumChain'}` refuses message signing. The list can never be widened. The widget answers refused
methods with 4200.

While no wallet is connected, the widget answers by itself. `eth_accounts` returns `[]`. `eth_chainId` returns
the configured chain. `eth_requestAccounts` calls `onConnectRequest` and then fails with 4100. Everything else
fails with 4100.

### Batched calls (optional)

The embed can also send three EIP-5792 methods: `wallet_getCapabilities`, `wallet_sendCalls` and
`wallet_getCallsStatus`. With a wallet that supports atomic batches, a native-ETH flip is then one confirmation
(wrap, approve and flip together) instead of up to three. By default the widget answers them with 4200, and the embed
falls back to separate transactions.

Opt in only if your wallet implements EIP-5792:

```dart
FlipperWidget(wallet: wallet, enableBatchCalls: true)
```

`allowedMethods` still narrows the result, and it can include the batch methods only when `enableBatchCalls` is on.
Nothing outside the embed's 10 methods (`kFlipperBridgeMethods`) is ever forwarded. If your wallet can't handle a
batch request, throw `FlipperRpcError(4200, ...)` and the embed falls back.

### Errors

Throw `FlipperRpcError(code, message, [data])` from `request`. The widget passes the code through unchanged:

| Code | Use it when |
|---|---|
| `4001` | the user rejected or closed the prompt (`FlipperRpcError.userRejected()`) |
| `4100` | no account is connected, or the method isn't authorized |
| `4200` | your wallet doesn't support the method |
| `4900` / `4901` | disconnected / not connected to the requested chain |
| `4902` | `wallet_switchEthereumChain` to a chain the wallet doesn't know. The embed then sends `wallet_addEthereumChain` |
| `-32602` / `-32603` | invalid params / internal error |

Other exceptions are converted as follows. An integer `code` and a `String message` property are used when the
error has them (reown's `JsonRpcError` does, for example). Anything else becomes -32603 "Internal error". There is
no timeout, because users can take minutes in a wallet app. Always answer, with 4001 if the user backs out.

### Reown AppKit (WalletConnect)

[`example/lib/reown_wallet.dart`](example/lib/reown_wallet.dart) is a complete `FlipperWallet` over
[Reown AppKit](https://docs.reown.com/appkit/flutter/core/installation) (`reown_appkit` 1.9). It is kept out of
the package, so you only depend on AppKit if you use it. Copy the file into your app:

```dart
// Before creating the modal: register Robinhood Chain (older AppKit versions don't list it).
ReownAppKitModalNetworks.addSupportedNetworks('eip155', [robinhoodChain]);

final appKitModal = ReownAppKitModal(context: context, projectId: '...', metadata: ...);
await appKitModal.init();
final wallet = ReownFlipperWallet(appKitModal);

FlipperWidget(
  wallet: wallet,
  onConnectRequest: (_) => appKitModal.openModalView(),
);
```

The adapter does the following:

- It mirrors the session from `onModalConnect`, `onModalUpdate`, `onModalNetworkChange` and `onModalDisconnect`,
  reading the address with `session.getAddress('eip155')`.
- It forwards requests with `appKitModal.request(topic: session.topic, chainId: <CAIP-2>, request:
  SessionRequestParams(method: ..., params: ...))`, which also brings the wallet app to the front.
- It handles `wallet_switchEthereumChain` with `appKitModal.requestSwitchToChain(network)`, which adds the chain
  to the wallet first if needed. Chains that AppKit doesn't know fail with 4902.
- It maps WalletConnect's rejection codes (5000 to 5003) to 4001. AppKit reports some failures by resolving to
  `null`, so a missing result for a signing method is treated as an error, never as a signature.
- It normalizes chain ids. AppKit 1.9 uses CAIP-2 (`eip155:4663`) and older versions use plain numbers.

`robinhoodChain` uses Robinhood Chain's public RPC (`https://rpc.mainnet.chain.robinhood.com`) and its Blockscout
explorer. Wallets that don't know the chain receive this URL through `wallet_addEthereumChain`, so keep it a public
endpoint.

## Configuration, theming and white-label

```dart
FlipperWidget(
  config: const FlipperConfig(
    chain: 4663,                 // 4663 Robinhood Chain (default), 31337 local fork
    token: '0x…',                // token selected at start (default $FLIPPER)
    tokens: ['0x…', '0x…'],      // picker allowlist; one address = no picker
    mode: FlipperTokenMode.single, // one fixed token (needs `token`), no picker; picker (default) lets users choose
    fit: FlipperFit.fill,        // fill the view's constraints (autoHeight off); auto (default): content height
    details: true,               // opt-in win chance / payout / fee line (default off: only an odds deviation note)
    tagline: FlipperTagline.builtIn, // opt-in idle headline; or FlipperTagline.text('Double or nothing on Acme')
    partner: 'acme',             // attribution id, [A-Za-z0-9._:-]{1,64}
    locale: 'es',                // built-in strings; unknown locales fall back to English
    compact: true,               // small inline coin, denser layout
    branding: false,             // remove flipper.family marks
    extra: {                     // any other embed config field
      'brandName': 'Acme Flips',
      'brandLogo': 'data:image/png;base64,iVBORw0…', // images as data: URIs: the embed's CSP loads no other hosts
      'coinImage': 'data:image/png;base64,iVBORw0…',
      'coinImageTails': 'data:image/png;base64,iVBORw0…',
      'strings': {'flip': 'Toss it'},
      'minAmount': '10',
      'maxAmount': '5000',
      'approval': 'exact',       // or 'max' (default)
    },
  ),
  theme: const FlipperTheme(
    mode: FlipperThemeMode.auto, // light | dark | auto (follows the system)
    accent: '#7C5CFF',           // CTA, focus rings, links; text on it is picked for contrast
    radius: 16,                  // px, 0–40 (default 24)
  ),
)
```

| Option | URL parameter | Live config field | Notes |
|---|---|---|---|
| `config.chain` | `chain` | `chainId` | Always sent. **Changing it reloads the embed.** |
| `config.partner` | `partner` | `partner` | Echoed in every event. **Changing it reloads the embed.** |
| `config.token` | `token` | `token` | |
| `config.tokens` | `tokens` (comma-separated) | `tokens` | |
| `config.mode` | `mode` (`picker`/`single`) | `mode` | |
| `config.fit` | `fit` (`auto`/`fill`) | `fit` | |
| `config.details` | `details` (`1`/`0`) | `details` | |
| `config.tagline` | `tagline` (`1` or the text) | `tagline` (`true` or the text) | |
| `config.hidePicker` (deprecated: use `mode`) | `hidePicker` (`1`/`0`) | `hidePicker` | |
| `config.compact` | `compact` (`1`/`0`) | `variant` (`compact`/`card`) | |
| `config.branding` | `branding` (`1`/`0`) | `branding` | |
| `config.locale` | `locale` | `locale` | |
| `config.extra` | `config` (base64 JSON) | its keys, at the top level | Wins over the individual parameters. |
| `theme.mode` | `theme` | `theme` | |
| `theme.accent` | `accent` | `accent` | Use `FlipperTheme.accentFromArgb(color.toARGB32())` for a Flutter `Color`. |
| `theme.radius` | `radius` | `radius` | |

- Changes to anything other than `chain`, `partner` and `baseUrl` are applied live, without a reload. The widget
  sends one `config` message that contains only the fields that changed. A field you remove is sent as `null`,
  which means "back to the default". Rebuilding with an equal config sends nothing, because configs are compared
  by value.
- For custom theme tokens (the object form of the embed's `theme`), pass `extra: {'theme': {...}}`. It overrides
  `mode`.
- `rpcUrl`, `apiUrl` and `addresses` in `extra` decide where funds, approvals and reads go, so the embed never takes
  them from its URL (anyone can craft one). The widget leaves them out of the URL and sends them in a `config`
  message after every `ready` instead (`FlipperBridge.hostConfig`, `FlipperConfig.hostOnlyConfig`,
  `kFlipperHostOnlyConfigKeys`). The embed's CSP still only connects to flipper's own RPC and API.
- `extra` values must be JSON-compatible. An invalid configuration is reported through `onError`, and nothing
  is loaded (see [Security](#security)).

## Events

Every event arrives as a `FlipperEvent`, a sealed class, at `onEvent`, followed by its typed callback. Payloads
are parsed leniently, and the untouched `data` is always available as `event.raw`. Amounts are decimal strings
in the token's smallest unit, and every payload carries `partner`.

| Event | Callback | Fields |
|---|---|---|
| `ready` | `onReady` | `version`, `chainId`, `account`, `token`, `variant`, `partner` |
| `connect-request` | `onConnectRequest` | `reason` (`connect`, `flip`, `list`; `null` when it came from an `eth_requestAccounts` while disconnected) |
| `flip-requested` | `onFlipRequested` | `flipId`, `account`, `token`, `symbol`, `decimals`, `amount`, `winChanceBps`, `randomnessFee`, `txHash`, `approveTxHash`, `native` |
| `flip-settled` | `onFlipSettled` | `flipId`, `outcome` (`won`/`lost`/`refunded`), `status` (`Won`, `WonFallback`, `WinPending`, `Lost`, `LostInventory`, `Refunded`), `won`, `pending`, `payout`, `payoutToken`, `flipperPaid`, `txHash`, `requestTxHash`, `native`, ... |
| `payout-resolved` | `onPayoutResolved` | `flipId`, `account`, `token`, `symbol`, `decimals`, `tokenPaid`, `flipperPaid`, `by` (`self`/`other`), `native`, `txHash` |
| `listing` | `onListing` | `stage` (`started`/`submitted`/`listed`/`failed`), `token`, `symbol`, `txHash`, `error` |
| `error` | `onError` | `code`, `message` (plain English, safe to show), `context` |
| `resize` | `onResize` | the new height, already clamped |
| anything else | `onEvent` only | `FlipperUnknownEvent(name, raw)` |

- A `WinPending` flip (`pending: true`) has its stake back but its winnings still owed; the widget shows them with
  a Retry payout button. It gets a second `flip-settled` with the same `flipId` when the winnings are paid.
  De-duplicate by `flipId`: the last event is final.
- `payout-resolved` fires once per pending win, alongside that final `flip-settled`. `tokenPaid` is the winnings
  in `token` (the stake already came back); `flipperPaid` is $FLIPPER paid instead, `"0"` unless the token still
  couldn't be bought after the pending timeout. `by` is `self` when this widget's Retry payout paid it, `other`
  when someone else did (usually flipper's payout worker). `native` is true when the stake was native ETH: `token`
  is WETH (the winnings are paid in WETH) and `symbol` is `"ETH"`. A pending win the widget only learned about from
  an earlier session reports `native: false` and `"WETH"`. Retry errors arrive at `onError` with context `flip`.
- `onError` also carries two host-side errors. `code: "config"` means the configuration is invalid and nothing
  was loaded. `code: "network"` means the embed page failed to load.

```dart
onEvent: (event) {
  switch (event) {
    case FlipperFlipSettledEvent(:final flipId, :final outcome, pending: false):
      analytics.log('flip', {'id': flipId, 'outcome': outcome});
    case FlipperUnknownEvent(:final name):
      debugPrint('newer embed event: $name');
    default:
      break;
  }
},
```

## Height

With `autoHeight: true` (the default), the widget starts at `initialHeight` (560) and follows the embed's
`resize` events. It rounds each height up and clamps it to `minHeight` (120) and `maxHeight` (none by default).
When `maxHeight` cuts the content off, the embed scrolls inside the widget. With `autoHeight: false`, the widget
fills a parent with a bounded height, for example `Expanded` or `SizedBox`, and otherwise uses `initialHeight`.

`placeholder` is shown over the transparent WebView until the embed is ready:

```dart
FlipperWidget(placeholder: const Center(child: CircularProgressIndicator()))
```

By default the WebView claims no gestures, so vertical drags scroll the page around it. Pass
`gestureRecognizers` to change that, for example when the widget has a fixed height inside a scroll view.

## Controller

```dart
final flipper = FlipperWidgetController();

FlipperWidget(controller: flipper, ...);

flipper.setConfig({'theme': 'light', 'accent': '#ff5a1f'}); // live config, embed field names
flipper.reload();                                           // reload from the current properties
flipper.refreshWallet();                                    // resend the wallet state
flipper.isReady;                                            // the embed sent `ready`
```

`setConfig` takes the embed's field names (`theme`, `accent`, `radius`, `branding`, `locale`, `variant`,
`hidePicker`, `token`, `tokens`, `brandName`, `strings`, ...). Messages are queued until the embed is ready. It
does not change the widget's `config` / `theme` properties. A later reload starts from those properties again.

## Security

- **The embed never holds keys.** Every signature and transaction goes through your wallet's own confirmation
  UI. **Never auto-approve requests that come from the widget.** Treat them like requests from any website:
  show the user what they sign.
- **HTTPS only.** `baseUrl` must be `https`. Plain `http` is accepted only for `localhost`, `127.0.0.1`,
  `10.0.2.2` and `::1`, and only while `allowInsecureLocalhost` is true, which defaults to `kDebugMode`. A URL
  with credentials (`user:pass@`) or any other scheme is a configuration error. The widget reports it through
  `onError` and never loads it.
- **Navigation stays on the embed.** The main frame may only load pages under the embed URL's path on its origin.
  Other `http(s)` links, including other pages of the same site, and `mailto:` / `tel:` links open in the
  system browser or the default app. `javascript:`, `file:`, `data:`, `intent:` and custom schemes are blocked.
  Sub-frames may only load `about:blank`, `about:srcdoc` or the embed origin. New windows (`target="_blank"`,
  `window.open`) never create a WebView, and their http(s) targets open in the system browser.
- **Messages are validated.** The widget handles only messages that arrive while the WebView shows the embed
  origin, with `v: 1` and `source: "flipper"`, and no larger than 512 KiB. Requests can only call the seven
  allowlisted methods, none of which signs a message (narrow the list with `allowedMethods`). Replies to requests from a previous page are
  dropped.
- **WebView hardening.** JavaScript is on (the embed needs it). The background is transparent. Zoom is off.
  File and content URL access, geolocation and mixed content are off (Android). Every permission request
  (camera, microphone) is denied. Link previews are off (iOS). Remote debugging and Web Inspector are enabled
  only in debug builds.
- **Nothing secret crosses the bridge.** There are no keys, sessions or cookies. Events carry public onchain data
  and your `partner` id.

What webview_flutter doesn't expose, so the platform defaults apply:

- The JavaScript channel carries no frame or origin information. The widget checks the origin of the page
  currently shown, tracked from navigation callbacks. The channel object is injected into every frame, including
  sub-frames on Android. An `<iframe>` inside the embed page could therefore post to it. The embed loads no
  third-party frames, and the sub-frame navigation policy blocks foreign origins on iOS. On Android, sub-frame
  navigations are not reported to Flutter.
- Android: Safe Browsing (on by default since WebView 66), universal and file access from file URLs (off by
  default since API 16), and the plugin's multiple-windows support, which the plugin routes through the
  navigation policy above.
- iOS: `javaScriptCanOpenWindowsAutomatically` is left at WebKit's default (off). WKWebView reports
  `target="_blank"` links as sub-frame navigations without a target frame. To open them in the browser, the
  widget runs a small script after each embed page load. The script turns new-window links and `window.open`
  into top-level navigation attempts, which the policy then opens externally.

## Local development

Run the repo's `./dev.sh`. It serves the web app on port 3000 against a local fork, which has chain id 31337.

```dart
FlipperWidget(
  baseUrl: FlipperWidget.localDevBaseUrl, // 10.0.2.2:3000 on Android, localhost:3000 elsewhere
  config: const FlipperConfig(chain: kFlipperLocalChainId), // 31337
)
```

- **Android emulator:** `http://10.0.2.2:3000/embed`, the emulator's alias for your machine.
- **iOS simulator:** `http://localhost:3000/embed`.
- **Physical Android device:** run `adb reverse tcp:3000 tcp:3000` and use `http://localhost:3000/embed`
  (`kFlipperLocalEmbedUrl`).
- **Physical iPhone:** use an https tunnel to your machine. Plain http to a LAN IP is rejected on purpose.
- Plain http works only in debug builds (`allowInsecureLocalhost` defaults to `kDebugMode`). The platforms have
  their own cleartext rules, so see [Troubleshooting](#troubleshooting).
- Your wallet must be on chain 31337 with the fork's RPC (`http://127.0.0.1:8545` on your machine).

## Troubleshooting

**The widget is blank.**
- Check `onError`. `code: "config"` means `baseUrl` was rejected (for example `http` in a release build).
  `code: "network"` means the page didn't load: check the device's connectivity or the dev server.
- Android: make sure the `INTERNET` permission is in the main manifest. Release builds don't get it
  automatically.
- In debug builds the embed's console output is printed with a `[flipper embed]` prefix. Remote debugging
  (`chrome://inspect`) and Safari's Web Inspector are enabled.
- The widget needs a bounded width. In a `Row`, wrap it in `Expanded`.

**Cleartext HTTP is blocked on Android (`net::ERR_CLEARTEXT_NOT_PERMITTED`).** Android 9 and newer block http
by default. Allow it for the debug build only, in `android/app/src/debug/AndroidManifest.xml`:

```xml
<application android:networkSecurityConfig="@xml/network_security_config" />
```

Then add `android/app/src/debug/res/xml/network_security_config.xml`:

```xml
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">10.0.2.2</domain>
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">127.0.0.1</domain>
  </domain-config>
</network-security-config>
```

The simplest alternative is `android:usesCleartextTraffic="true"` on `<application>` in the debug manifest.

**Cleartext HTTP is blocked on iOS.** If the local page doesn't load in the simulator, add
`NSAppTransportSecurity` → `NSAllowsLocalNetworking` = `YES` to `Info.plist`, ideally in a debug-only
configuration.

**The wallet doesn't respond.**
- The widget waits for your `request` future indefinitely. Make sure every code path completes it, with
  `FlipperRpcError.userRejected()` when the user closes the prompt.
- The embed shows "Connect" until `accounts` is non-empty. Check that your wallet emits on `accountsChanges` or
  calls `update(...)`. `controller.refreshWallet()` resends the state.
- A 4200 error means the method isn't in `allowedMethods`.
- If a chain switch fails with 4902, the wallet doesn't know chain 4663. The embed then sends
  `wallet_addEthereumChain`, and your wallet has to forward it or handle it.
- WalletConnect: the wallet app has to come to the foreground to sign. AppKit does that. Other SDKs may need a
  deep link.

**The height doesn't update.** Check that `autoHeight` is true and that the parent doesn't force a height, for
example with `Expanded` or a tight `SizedBox`. Also check that `maxHeight` isn't capping it. `onResize` shows
the heights the embed reports.

**Links don't open.** Add the Android `<queries>` shown above. On iOS, links in a closed shadow root with
`target="_blank"` can't be intercepted. Ask for the embed to use `window.open` or plain links.

**Changing `chain` or `partner` resets the widget.** This is by design: they are part of the embed URL. Every
other field is applied live.

## How it works

The package implements the host side of the embed bridge protocol v1.

1. `FlipperWidget` builds the embed URL (`chain`, `token`, `theme`, `accent`, `radius`, `branding`, `partner`,
   `locale`, `compact`, `hidePicker`, `tokens`, `config`) and loads it in a `WebViewController`. The controller
   has a JavaScript channel named `FlipperHost`, which the page sees as
   `window.FlipperHost.postMessage(json)`.
2. The page posts `{v: 1, source: "flipper", type: "rpc" | "event", ...}` strings. The platform-independent
   `FlipperBridge` validates them, forwards RPCs to your wallet, and dispatches events.
3. Replies, the wallet state (`{type: "wallet", accounts, chainId}`) and live config are delivered with
   `runJavaScript`, which calls `window.FlipperBridge.receive(json)`. RPC answers go out at once (the embed
   reads `eth_accounts` / `eth_chainId` when it mounts, before `ready`); the wallet state and live config wait for
   `ready`, with wallet states coalescing and config partials merging.
4. A new page load resets the bridge. Replies to requests from the old page are dropped, and the wallet state is
   sent again after the new `ready`.

`FlipperBridge`, `buildEmbedUri`, `decideFlipperNavigation` and the config helpers are exported and have no
WebView dependency, so you can unit-test an integration without a device.

## Publishing

1. Confirm the `repository`, `issue_tracker` and `documentation` URLs in `pubspec.yaml`. The repository URL is a
   placeholder, and pub.dev checks that it contains this package's pubspec.
2. `flutter analyze` and `flutter test` must pass. Run the example on an Android emulator and an iOS simulator.
3. `dart pub publish --dry-run` must report no warnings. It checks the description length, the LICENSE, the
   CHANGELOG entry for the version, the size and the files that `.pubignore` leaves out.
4. Publish under a [verified publisher](https://dart.dev/tools/pub/verified-publishers) such as
   `flipper.family`. You need DNS verification of the domain in Google Search Console, then create the publisher
   on pub.dev and move the package to it. After that, `dart pub publish`.
5. Optional: publish from CI with GitHub Actions OIDC. See
   [automated publishing](https://dart.dev/tools/pub/automated-publishing).

## License

MIT, see [LICENSE](LICENSE).
