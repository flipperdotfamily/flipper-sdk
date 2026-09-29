# Changelog

All notable changes to `family.flipper:widget` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0]

Initial release, implementing host bridge protocol v1 (`packages/widget/BRIDGE.md`). Not yet published: the release
date goes here when it ships.

### Added

- Opt-in EIP-5792 batch calls (`FlipperWidgetOptions.enableBatchCalls`, XML `flipperEnableBatchCalls`): forwards
  `wallet_getCapabilities`, `wallet_sendCalls` and `wallet_getCallsStatus`. Off by default (answered 4200); never
  beyond the embed's 10 methods.
- `FlipperWidgetView`: a FrameLayout hosting a hardened WebView that loads `https://flipper.family/embed`. It can
  be used from XML (`app:flipper*` attributes) or code, supports auto-height, and destroys itself with its
  view-tree lifecycle. The default chain is Robinhood Chain (4663).
- `FlipperWidget` composable, with `FlipperWidgetController` for `reload()` / `setConfig(...)`.
- `FlipperWallet` interface (EIP-1193 `request` plus `accounts` / `chainId` flows), `MutableFlipperWallet`,
  `FlipperRpcException` (alias `FlipperRpcError`) and `FlipperChainId` helpers.
- `FlipperConfig`, `FlipperTheme`, `FlipperThemeMode`, `FlipperWidgetOptions` and `flipperExtraConfig(...)` for
  white-labelling.
- Typed `FlipperEvent`s (`Ready`, `ConnectRequest`, `FlipRequested`, `FlipSettled`, `PayoutResolved`, `Listing`,
  `Error`, `Resize`, `Unknown`), each keeping its raw JSON. `PayoutResolved` (`onPayoutResolved`) reports that a
  pending win's winnings were paid.
- `FlipperBridge`, `EmbedUrl` and `NavigationPolicy`: the pure-Kotlin protocol layer, unit-tested on the JVM.
- A Reown AppKit adapter sample (`samples/ReownAppKitWallet.kt`), not part of the artifact.

### Security

- No message signing: the bridge refuses `personal_sign`, `eth_sign` and `eth_signTypedData*` with 4200, even when
  listed in `allowedMethods` (the embed never signs messages).
- `rpcUrl`, `apiUrl` and `addresses` in `flipperExtraConfig` / `FlipperConfig.extra` never go in the embed URL, which
  ignores them (anyone can craft a URL). The bridge sends them in a `config` message after every `ready`
  (`FlipperBridge.hostConfig`, `EmbedUrl.hostOnlyConfig`, `EmbedUrl.HOST_ONLY_CONFIG_KEYS`).
- The embed's CSP loads images only from flipper.family and `data:`: pass `brandLogo` / `coinImage` as `data:` URIs.

### Known limitations

- Compile-checked with kotlinc 2.1.20 (Compose plugin) against android-36, Compose 1.7.6, webkit 1.12.1 and
  lifecycle 2.8.7. Resources pass aapt2, and the 45 JVM unit tests passed then. The changes under Security, and
  their tests, have been read through but not yet compiled or run. The Gradle build (AGP, publishing, javadoc) and
  runtime behaviour on a device have not been exercised yet.
- On WebViews without `WEB_MESSAGE_LISTENER`, the `addJavascriptInterface` fallback can't tell which frame sent a
  message (see README, Security).
