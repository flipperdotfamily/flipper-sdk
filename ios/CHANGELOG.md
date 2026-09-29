# Changelog

## Unreleased

- The default chain is now Robinhood Chain (4663).
- The bridge no longer forwards `personal_sign` / `eth_signTypedData_v4` (the embed never signs messages).
- `rpcUrl`, `apiUrl` and `addresses` in `config.extra` are no longer put in the embed URL, which now ignores them
  (anyone can craft a URL). They're sent as a `config` message after every `ready` instead
  (`FlipperBridgeCore.hostConfig`; `FlipperEmbedURL.hostOnlyConfig` and `hostOnlyConfigKeys` are public). No change
  for apps.
- The embed's CSP loads images only from flipper.family and `data:`: pass `brandLogo` / `coinImage` as `data:` URIs.

## 0.1.0

- Opt-in EIP-5792 batch calls (`FlipperWidgetOptions.enableBatchCalls`): forwards `wallet_getCapabilities`,
  `wallet_sendCalls` and `wallet_getCallsStatus`. Off by default (answered 4200); never beyond the embed's 12 methods.
- First release: `FlipperWidgetView` (SwiftUI), `FlipperWidgetUIView` and `FlipperWidgetViewController` (UIKit)
  over WKWebView, speaking embed bridge protocol v1.
- The `@MainActor` `FlipperWallet` protocol, `FlipperWalletAdapter`, and `FlipperRPCError` with EIP-1193 codes.
- `FlipperConfig`, `FlipperTheme` and `FlipperWidgetOptions`; live config updates; auto-height.
- Typed events: ready, connect-request, flip-requested, flip-settled, payout-resolved, listing, error, resize and
  unknown. `payout-resolved` (`onPayoutResolved` / `.onFlipperPayoutResolved`) reports that a pending win's winnings
  were paid.
- Security: https-only embed URL (http localhost only in DEBUG), navigation locked to the embed origin, external links
  in the system browser, main-frame and origin checks on bridge messages, a frozen `FlipperHost`, and an RPC
  allowlist.
- Built with Xcode 16.2 for the iOS Simulator; 28 XCTests, including WKWebView integration tests, pass on iOS 18.3.
