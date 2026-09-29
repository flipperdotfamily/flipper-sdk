# Flutter: wiring `flipper_family` into an app

Follow these steps when the user's app is Flutter (a `pubspec.yaml` with `flutter:` under `dependencies`). The
package is `flipper_family` 0.1.0, and its source is in `flutter/` in the [flipper-sdk repo](https://github.com/flipperdotfamily/flipper-sdk). It shows the hosted
embed (`https://flipper.family/embed`) in a WebView and sends every wallet request to a wallet object **the host
app** supplies. Android and iOS only.

> 0.1.0 was written without a Flutter SDK, so it has never been compiled. After wiring it in, run `flutter pub
> get`, `flutter analyze` and the app. Report any compile error in the package back to the user rather than
> patching around it silently.

## 1. Check the app first

- Flutter version: `flutter --version`. The app needs Flutter 3.27+ and Dart 3.6+. If it's older, tell the user
  before going further.
- Find the app's wallet. Search for `reown_appkit`, `walletconnect_flutter_v2`, `web3dart`, `privy`,
  `coinbase_wallet_sdk`, `magic_sdk`, or a custom signer. You will adapt this wallet. Do not add a second one.
- Find where the widget goes: a screen, and a scrollable or fixed-height area.

## 2. Install

```yaml
# pubspec.yaml
dependencies:
  flipper_family: ^0.1.0   # or: path: ../flipper-sdk/flutter while unpublished
```

Android (`android/app`):
- Set `minSdk = 24` or higher in `build.gradle(.kts)`.
- Add `<uses-permission android:name="android.permission.INTERNET" />` to `src/main/AndroidManifest.xml`.
- Add `<queries>` for `VIEW https`, `SENDTO mailto` and `DIAL tel`, so external links open (the package README
  has the XML).

iOS: iOS 13+. No permissions or plist keys are required.

## 3. Minimal code

```dart
import 'package:flipper_family/flipper_family.dart';

FlipperWidget(
  wallet: wallet,                                   // FlipperWallet? (null = not connected)
  config: const FlipperConfig(partner: 'APP_ID'),   // ask the user for their partner id
  theme: const FlipperTheme(mode: FlipperThemeMode.auto, accent: '#7C5CFF'),
  onConnectRequest: (_) => openTheAppsConnectFlow(),
  onFlipSettled: (e) { /* optional: analytics, confetti */ },
  onError: (e) { /* show e.message for embed errors; log code == 'config' */ },
)
```

It fills the given width and sizes its own height (`autoHeight`), so it can go straight into a `ListView` or
`Column`. In a `Row`, wrap it in `Expanded`.

## 4. The wallet adapter

Write one class that extends `FlipperWalletBase`, in the app, next to its existing wallet code:

```dart
class AppFlipperWallet extends FlipperWalletBase {
  AppFlipperWallet(this.sdk) {
    // Mirror the app wallet's state: call update() on connect, disconnect,
    // account change and chain change.
    sdk.onChange((s) => update(accounts: s.isConnected ? [s.address] : const [], chainId: s.chainId));
  }
  final AppWalletSdk sdk;

  @override
  Future<Object?> request(String method, Object? params) async {
    // Forward EIP-1193 requests unchanged. The SDK must show its own confirmation UI.
    try {
      return await sdk.request(method, params);
    } on AppWalletRejected {
      throw const FlipperRpcError.userRejected();
    }
  }
}
```

Rules to follow:
- **Never auto-approve.** Every `eth_sendTransaction` / signature must go through the wallet's confirmation UI.
  Don't write code that signs requests from the widget silently, even if the user asks for "one-tap" flips.
  Explain why instead.
- `update(chainId: ...)` accepts `4663`, `"4663"`, `"0x1237"` or `"eip155:4663"`. Accounts are listed with the
  active account first. On disconnect, call `update(accounts: const [], chainId: null)`.
- Always complete the `request` future. Throw `FlipperRpcError(code, message)` to fail: 4001 for a rejection,
  4100 when not connected, 4200 for an unsupported method, 4902 when `wallet_switchEthereumChain` targets an
  unknown chain (the embed then sends `wallet_addEthereumChain`). Pass wallet error codes through unchanged.
- The embed calls only `eth_accounts`, `eth_requestAccounts`, `eth_chainId`, `eth_sendTransaction`,
  `wallet_switchEthereumChain`, `wallet_addEthereumChain` and `wallet_watchAsset`. Message signing
  (`personal_sign`, `eth_signTypedData_v4`) is never forwarded (answered 4200): the embed doesn't sign messages.
- Batched calls (optional): pass `enableBatchCalls: true` only if the wallet supports EIP-5792
  (`wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus`); a native-ETH flip is then one
  confirmation. It's off by default (answered 4200, and the embed falls back). `allowedMethods` still narrows the set,
  and nothing outside the embed's 10 methods is ever forwarded.
- Keep one adapter instance per wallet. Pass `null` until the app wallet is initialized. Dispose the adapter with
  the screen, or at app level.
- For callback-style SDKs you can use `FlipperCallbackWallet(onRequest: ...)` plus `update(...)`.

**Reown AppKit / WalletConnect:** copy flipper-sdk's `flutter/example/lib/reown_wallet.dart` (`ReownFlipperWallet`
and `robinhoodChain`) into the app. Then:
- Call `ReownAppKitModalNetworks.addSupportedNetworks('eip155', [robinhoodChain])` **before** constructing
  `ReownAppKitModal`.
- `robinhoodChain.rpcUrl` is Robinhood Chain's public RPC (`https://rpc.mainnet.chain.robinhood.com`); keep it a
  public endpoint, because wallets that don't know the chain receive it through `wallet_addEthereumChain`.
- Create the adapter after `await appKitModal.init()`, and wire `onConnectRequest: (_) =>
  appKitModal.openModalView()`.

## 5. Config and theme

| Need | Code | Live? |
|---|---|---|
| Chain (4663 Robinhood Chain, the default; 31337 local) | `FlipperConfig(chain: ...)` | reloads |
| Partner attribution | `FlipperConfig(partner: 'acme')` | reloads |
| Start token / allowlist / fixed token | `token:`, `tokens: [...]`, `mode: FlipperTokenMode.single` (`hidePicker` is deprecated) | yes |
| Fill a fixed-size view | `fit: FlipperFit.fill` (autoHeight off) | yes |
| Opt-in extras (off by default) | `details: true` (win chance / payout / fee), `tagline: FlipperTagline.builtIn` or `FlipperTagline.text('…')` | yes |
| Compact layout | `compact: true` | yes |
| Remove flipper marks | `branding: false` | yes |
| Language | `locale: 'es'` | yes |
| Brand name, logo, coin faces, strings, limits | `extra: {'brandName':..., 'brandLogo':..., 'coinImage':..., 'coinImageTails':..., 'strings': {...}, 'minAmount': '10', 'maxAmount':..., 'approval': 'exact'}`. Images as `data:` URIs (the embed's CSP loads no other image hosts) | yes |
| RPC, API, contract overrides | `extra: {'rpcUrl':..., 'apiUrl':..., 'addresses': {...}}`. Never in the URL (the embed ignores them there): sent in a `config` message after every `ready` | yes |
| Light / dark / system | `FlipperTheme(mode: FlipperThemeMode.dark)` | yes |
| Accent colour | `FlipperTheme(accent: '#7C5CFF')` or `FlipperTheme.accentFromArgb(color.toARGB32())` | yes |
| Corner radius (0–40) | `FlipperTheme(radius: 16)` | yes |
| Custom theme tokens | `extra: {'theme': {...}}` (overrides `mode`) | yes |

To match the app's theme, derive `FlipperTheme` from `Theme.of(context)` in `build`. Equal configs are compared
by value, so rebuilding sends nothing. Imperative updates go through `FlipperWidgetController.setConfig({...})`
with embed field names. The controller also has `reload()`, `refreshWallet()` and `isReady`.

## 6. Events

`onEvent` receives every event as a sealed `FlipperEvent`, with the raw data in `.raw`. The typed callbacks are
`onReady`, `onConnectRequest`, `onFlipRequested` (`native`), `onFlipSettled` (`outcome` won/lost/refunded, `status`
string, `pending`, `native`), `onPayoutResolved` (`tokenPaid`, `flipperPaid`, `by`, `native`), `onListing`
(`stage`), `onError` (`code`, `message`, `context`) and `onResize(double)`.
- De-duplicate `flip-settled` by `flipId`. A `pending: true` (`WinPending`) flip has its winnings still owed (the
  widget offers Retry payout) and settles a second time when they're paid; `onPayoutResolved` fires once then.
- `onError` with `code: 'config'` means the widget refused its configuration and loaded nothing. `code:
  'network'` means the page failed to load. Other codes come from the embed, and their `message` is safe to
  show.

## 7. Security notes for the user

- Production `baseUrl` stays at the default `https://flipper.family/embed`. Plain http is accepted only for
  localhost / 127.0.0.1 / 10.0.2.2 / ::1 in debug builds (`allowInsecureLocalhost` defaults to `kDebugMode`).
  Don't set it to `true` in release code.
- The WebView only stays on the embed. Other links open in the system browser, and custom schemes are blocked.
  Don't loosen this and don't wrap the widget in another WebView.
- No keys or sessions cross the bridge. The wallet's own UI confirms everything.

## 8. Local development

With the repo's `./dev.sh` running (web on :3000, fork chain 31337):
`baseUrl: FlipperWidget.localDevBaseUrl` (`10.0.2.2:3000` on the Android emulator, `localhost:3000` otherwise),
`config: FlipperConfig(chain: kFlipperLocalChainId)`. On a physical Android device, run `adb reverse tcp:3000
tcp:3000` and use `kFlipperLocalEmbedUrl`. Android needs a **debug-only** cleartext exception for these hosts
(network security config, see the package README). The wallet must point at chain 31337. Gate all of this
behind `kDebugMode` or a `--dart-define`, never ship it.

## 9. Gotchas

- Blank widget: check `onError` first. Then look for a missing `INTERNET` permission (Android release), http in
  a release build, unbounded width in a `Row`, or Android cleartext rules in local dev.
- "Connect" never goes away: the adapter isn't calling `update(accounts: ...)` / emitting on
  `accountsChanges`.
- Transactions hang: the adapter's `request` future never completes. Make sure rejections throw 4001.
- A chain switch fails: the wallet doesn't know 4663. Return 4902 so the embed sends `wallet_addEthereumChain`,
  and make sure the adapter forwards that call.
- Changing `chain` or `partner` resets the widget (URL params). Everything else updates live.
- webview_flutter reports `target="_blank"` links as navigations. The widget opens them externally. Don't add a
  `NavigationDelegate` of your own, because the widget owns its WebView controller.
- Don't put the widget inside a scroll view with `gestureRecognizers` that claim vertical drags, unless you give
  it a fixed height (`autoHeight: false`).
