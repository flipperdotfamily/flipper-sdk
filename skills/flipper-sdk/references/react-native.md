# React Native / Expo: wiring `@flipperdotfamily/react-native` into an app

Follow these steps when the user's app is React Native or Expo: its `package.json` lists `react-native` (and maybe
`expo`). The package is `@flipperdotfamily/react-native` 0.1.0, with its source in `react-native/` in the [flipper-sdk repo](https://github.com/flipperdotfamily/flipper-sdk).
There are two ways to add flips; pick one:

- **`<FlipperWidget>`** (the default). The hosted embed runs in a `react-native-webview`, and every wallet request is
  sent to the app's own wallet. It's a drop-in, themeable and white-labelable widget.
- **Headless hooks** (`@flipperdotfamily/react-native/headless`) are for apps that want a fully native UI. They're built on
  `@flipperdotfamily/sdk` and need `viem`. See section 7.

## 1. Check the app first

- The app needs React Native 0.72+. Expo SDK 50+ works, in Expo Go or a dev build.
- Find the app's wallet. Search for `@reown/appkit-react-native` (or the older `@reown/appkit-*-react-native`),
  `@walletconnect/`, `wagmi`, `@metamask/sdk-react-native`, `@privy-io/expo`, `thirdweb`, or `ethers`/`viem` wallet
  clients. You will pass this wallet to the widget. Never add a second wallet library.
- Find where the widget goes. It sizes its own height, so put it in a `ScrollView`.

## 2. Install

```sh
npx expo install @flipperdotfamily/react-native react-native-webview    # Expo
npm i @flipperdotfamily/react-native react-native-webview && (cd ios && pod install)   # bare RN
```

If `react-native-webview` is already installed, keep that version; 13.x and 14.x both work.

## 3. Minimal code

```tsx
import { FlipperWidget } from "@flipperdotfamily/react-native";

<FlipperWidget
  wallet={provider}                 // EIP-1193 provider of the app's wallet, or null when disconnected
  address={address ?? null}         // if the wallet library exposes state via hooks
  walletChainId={chainId ?? null}   // number, "0x…" or "eip155:4663"
  partner="APP_ID"                  // ask the user for their partner id
  theme={colorScheme === "dark" ? "dark" : "light"}
  onConnectRequest={() => openTheAppsConnectModal()}
  onFlipSettled={(f) => { /* optional: analytics */ }}
  onError={(e) => { /* e.message is safe to show */ }}
/>
```

## 4. Wallet wiring by library

The `wallet` prop is any object with `request({ method, params })`. Provider events (`accountsChanged`,
`chainChanged`, `disconnect`) are followed automatically, and the `address` / `walletChainId` props override them.

| App uses | `wallet` | state props | `onConnectRequest` |
|---|---|---|---|
| Reown AppKit RN v2 | `isConnected && providerType === "eip155" ? useProvider().provider : null` | `useAccount()` → `address`, `chainId` | `useAppKit().open()` |
| wagmi (RN) | `useWalletClient().data ?? null` (viem WalletClient is EIP-1193) | `useAccount()` → `address`, `chainId` | the app's connect modal |
| MetaMask SDK | `sdk.getProvider()` | none (it emits events) | `sdk.connect()` |
| Privy / embedded wallets | `await wallet.getProvider()` (EIP-1193) | account address | the login flow |
| custom signer | `createFlipperWallet({ request(method, params), subscribe(emit) })` | via `subscribe` | the app's flow |

Robinhood Chain (4663) must be in the wallet library's network list. With AppKit, add viem's `robinhood` (from
`viem/chains`, viem 2.55 or newer) to `networks`; the Expo example has a complete `src/appkit.ts`. The widget sends `wallet_switchEthereumChain`
and, after a `4902`, `wallet_addEthereumChain`, so the provider has to support them or throw with those codes.

Batched calls (optional): add `enableBatchCalls` only if the app's wallet supports EIP-5792 (`wallet_sendCalls`)
over its connection. The embed then sends wrap, approve and flip as one confirmation for native-ETH flips. It's off
by default (answered 4200, and the embed falls back to separate transactions). `allowedMethods` still narrows the
set, and nothing beyond the embed's 10 methods is ever forwarded.

Errors: pass the wallet's EIP-1193 codes through (it already does if the provider throws `{ code }`). Use `4001`
for "user rejected". Never auto-approve requests: the wallet must show its own confirmation UI.

## 5. Options

- **Chain:** `chain` defaults to 4663 (Robinhood Chain); 31337 is the local fork.
- **Tokens:** `token` sets the starting token and `tokens` is the picker allowlist.
- **Look:** `theme`, `accent` and `radius` (0–40).
- **White-label:** `branding={false}`, plus `config={{ brandName, brandLogo, coinImage, coinImageTails, strings }}`.
  Images must be `data:` URIs: the embed's CSP loads no other image hosts.
- **Layout and language:** `locale`, `compact`, `mode` (`"picker"` / `"single"`: one fixed token, needs `token`,
  no picker) and `fit` (`"fill"`: the widget fills the view you size with `style`; `autoHeight` defaults to off).
  `hidePicker` is deprecated. `details` (win chance / payout / fee line) and `tagline` (`true` or your text) are
  opt-in extras, off by default.
- **Other `FlipperEmbedConfig` fields** go in `config`: `minAmount`, `maxAmount`, `approval`, `listing`, `rpcUrl`,
  `apiUrl`, `addresses`. The last three never go in the URL (the embed ignores them there): the widget sends them in
  a `config` message after every `ready`.

Changes to any prop except `chain`, `partner` and `baseUrl` apply live, with no reload. A ref gives you `reload()`,
`setConfig(partial)` and `refreshWallet()`. See [theming.md](theming.md) for the theme tokens.

## 6. Events

The callbacks are `onReady`, `onConnectRequest`, `onFlipRequested`, `onFlipSettled`, `onPayoutResolved`,
`onListing`, `onError`, `onResize` and `onEvent` (all events, with unknown names arriving as
`{ name: "unknown", rawName }`). The payloads are in [events.md](events.md). `onFlipSettled` can fire twice for a
`pending` (WinPending) flip, whose winnings are still owed (the widget offers Retry payout); de-duplicate by
`flipId`, and the last event is final. `onPayoutResolved` fires once when the winnings are paid.

## 7. Headless (native UI)

```sh
npx expo install viem react-native-get-random-values
```

```tsx
import "react-native-get-random-values";                 // first import of the entry file
import { useFlipperHeadless, formatTokenAmount } from "@flipperdotfamily/react-native/headless";

const f = useFlipperHeadless({ wallet: provider, account: address, amount: text /* user input, whole tokens */ });
// f.token, f.balance, f.preview, f.reject, f.odds, f.payoutIfWon, f.canTransact, f.switchChain(), f.flip(), f.phase
```

`useFlipperClient()` returns the full `@flipperdotfamily/sdk` client. Addresses resolve from the live manifest unless you pass
`addresses`; reads go through the deployment's public RPC, or `rpcUrl`. See [headless-sdk.md](headless-sdk.md).

## 8. Local development

- iOS Simulator: `baseUrl="http://localhost:3000/embed"`.
- Android emulator: `baseUrl="http://10.0.2.2:3000/embed"`.
- On both, set `chain={31337}` for the local fork.

`http://` is only accepted on loopback hosts while `__DEV__` is true (`allowInsecureLocalhost`). Android also needs
cleartext traffic in debug builds: with Expo, set `expo-build-properties` → `android.usesCleartextTraffic` in the dev
profile. A physical device needs an https tunnel.

## 9. Security checklist (tell the user)

- The embed URL must be https, or http on localhost in dev. Don't disable the navigation policy through
  `webViewProps`; the security props can't be overridden anyway.
- Only the seven wallet methods reach the wallet (ten with `enableBatchCalls`), and none of them signs a message
  (`personal_sign` / `eth_signTypedData_v4` get 4200). Narrow them further with `allowedMethods` if the app wants to.
- Every transaction is confirmed in the user's wallet. Warn if the app auto-signs through an embedded wallet.
- External links open in the system browser, never inside the widget.

## 10. Gotchas

- **Blank widget:** check `onError`. `config` means the URL is bad; `network` means the page failed to load (on
  Android, check cleartext for localhost).
- **"Connect wallet" does nothing:** `onConnectRequest` isn't wired.
- **Connected in the app but not the widget:** pass `address` / `walletChainId`, or pass `wallet={null}` while
  disconnected.
- **Stuck on "Confirm in wallet":** the provider's `request` never settles. With WalletConnect, set `redirect`
  metadata so the wallet returns to the app.
- **Headless `crypto.getRandomValues` errors:** import `react-native-get-random-values` first.
- **In the flipper-sdk repo,** run the package's tests with `pnpm --filter @flipperdotfamily/react-native test`.
