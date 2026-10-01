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

## 0.2.0

### Patch Changes

- 3233bb5: The edge schedule and drawdown-scaled Kelly, for the house's new views:
  - `house()` now carries `terms`, the base terms now: `{ baseWinChanceBps, flipperPayoutBps, kellyBps, scheduled }`
    from `currentBaseWinChanceBps()`, `currentFlipperPayoutBps()` and `currentKellyBps()`. The edge schedule steps the
    base down from 45% / 2.05× toward 47.5% / 2× as the house's net buybacks grow, so show `terms`, not `params`. A house
    from before the schedule answers from `params()`. Also as `baseTerms()`.
  - `edgeProgress()`: net buybacks, their ratcheted high, the schedule's endpoints, progress and the edges now (null
    without a schedule).
  - `minStake($FLIPPER)` and `maxStake(token, hi, true)` use the current payout and base win chance.
  - New `formatWinChance`, `houseEdgeBps`; `formatMultiple` shows up to three decimals, rounded down (2.025×).
  - The widget and the React Native headless hook show the current terms.
  - House ABI regenerated: `currentBaseWinChanceBps`, `currentFlipperPayoutBps`, `currentKellyBps`, `edgeProgress`,
    `edgeSchedule`, `netBuybackEth`, `buybackHigh`, `kellyMinBps`, `kellyDdStartBps`, `kellyDdEndBps`,
    `setEdgeSchedule`, `setBuybackHigh`, `setKellySchedule` and their events.
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
- Updated dependencies [3233bb5]
  - @flipperdotfamily/sdk@0.2.0

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
