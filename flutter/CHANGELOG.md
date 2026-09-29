## Unreleased

- The default chain is now Robinhood Chain (4663).
- The bridge no longer forwards `personal_sign` / `eth_signTypedData_v4` (the embed never signs messages).
- `rpcUrl`, `apiUrl` and `addresses` in `FlipperConfig.extra` are no longer put in the embed URL, which now ignores
  them (anyone can craft a URL). They're sent as a `config` message after every `ready` instead
  (`FlipperBridge.hostConfig`; `FlipperConfig.hostOnlyConfig` and `kFlipperHostOnlyConfigKeys` are public). No change
  for apps.
- The embed's CSP loads images only from flipper.family and `data:`: pass `brandLogo` / `coinImage` as `data:` URIs.

## 0.1.0

Initial release.

- Opt-in EIP-5792 batch calls (`enableBatchCalls`): forwards `wallet_getCapabilities`, `wallet_sendCalls` and
  `wallet_getCallsStatus`. Off by default (answered 4200); never beyond the embed's 12 methods.
- `FlipperWidget`: the flipper.family embed in a WebView (webview_flutter), with auto-height, a transparent
  background, a placeholder until the embed is ready, and `FlipperWidgetController` (`setConfig`, `reload`,
  `refreshWallet`).
- Embed bridge protocol v1, host side, in the platform-independent `FlipperBridge`: origin and envelope checks,
  a wallet-method allowlist that hosts can narrow, request-id tracking with duplicate detection, EIP-1193 error
  mapping, page generations, and a queue that holds the wallet state and config until the embed is ready (RPC
  answers go out at once).
- `FlipperWallet`, `FlipperWalletBase` and `FlipperCallbackWallet` let the host app plug in its own wallet.
  `FlipperRpcError` passes EIP-1193 errors through, including 4902 for `wallet_switchEthereumChain`.
- `FlipperConfig` / `FlipperTheme` for chain, token(s), partner, locale, compact layout, picker, branding, theme
  mode, accent, radius and any extra embed config (brand name and logo, coin images, strings, limits).
  Config changes are applied live, except `chain` and `partner`, which reload the embed.
- Typed events (`FlipperEvent` sealed class): ready, connect-request, flip-requested, flip-settled,
  payout-resolved, listing, error, resize, and unknown event names for forward compatibility.
  `payout-resolved` (`onPayoutResolved`) reports that a pending win's winnings were paid.
- Security: https only (http for localhost / 10.0.2.2 only when `allowInsecureLocalhost`, which defaults to
  debug builds). Navigation stays on the embed. Other links open in the system browser. No file or content
  access, geolocation, or camera/microphone permissions. Inspection is enabled in debug builds only.
- Example app with a Reown AppKit (WalletConnect) adapter.

> This release was written without a Flutter SDK available (nothing was compiled, analyzed or tested in the
> authoring environment). Run `flutter analyze` and `flutter test` before publishing.
