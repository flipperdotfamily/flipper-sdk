# Changelog

## Unreleased

- The default chain is now Robinhood Chain (4663).
- The bridge no longer forwards `personal_sign` / `eth_signTypedData_v4` (the embed never signs messages).
- `config.rpcUrl`, `config.apiUrl` and `config.addresses` are no longer put in the embed URL, which now ignores them
  (anyone can craft a URL). They're sent as a `config` message after every `ready` instead (`FlipperBridgeCore`'s new
  `hostConfig` option; `hostOnlyConfigOf` and `HOST_ONLY_CONFIG_KEYS` are exported). No change for apps.
- The embed's CSP loads images only from flipper.family and `data:`: pass `brandLogo` / `coinImage` as `data:` URIs.
- `useFlipperHeadless().valueToSend` is the exact randomness fee when the house's adapter charges a flat fee (Dice,
  Pyth Entropy), and the padded fee only for a gas-priced one (Chainlink VRF), matching what `@flipperdotfamily/sdk`'s `flip()`
  now sends.

## 0.1.0

- Opt-in EIP-5792 batch calls (`enableBatchCalls`): forwards `wallet_getCapabilities`, `wallet_sendCalls` and
  `wallet_getCallsStatus`. Off by default (answered 4200); `allowedMethods` narrows but never goes beyond the embed's 12
  methods.
- `<FlipperWidget>` over `react-native-webview`, speaking embed bridge protocol v1. It takes an EIP-1193 provider or a
  `createFlipperWallet` adapter, and accepts hook-based `address` / `walletChainId`.
- Every embed option as a prop, with live config updates (no reload), auto-height, and typed event callbacks.
- `@flipperdotfamily/react-native/headless`: `useFlipperClient` and `useFlipperHeadless`, built on `@flipperdotfamily/sdk`.
- Security: https-only embed URL (http on loopback only in `__DEV__`), navigation locked to the embed origin,
  external links in the system browser, source / version / origin checks, a frozen `FlipperHost`, and an RPC
  allowlist.
- Tested in Node: bridge core, URL, navigation, and end-to-end runs with a stub embed in a vm "WebView".
