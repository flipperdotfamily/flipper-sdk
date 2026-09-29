# @flipperdotfamily/react-native

The [flipper.family](https://flipper.family) coin-flip widget for React Native and Expo. It shows the hosted embed in
a `react-native-webview` and routes the embed's wallet requests to **your app's wallet**: Reown AppKit /
WalletConnect, wagmi, the MetaMask SDK, Privy, a viem `WalletClient`, or anything with an EIP-1193 `request()`. You
can theme and white-label it, and it reports typed events. For a fully native UI there are also headless hooks built
on `@flipperdotfamily/sdk`.

- `<FlipperWidget>`: a drop-in WebView widget. It implements embed bridge protocol v1 (`packages/widget/BRIDGE.md`).
- `useFlipperHeadless()` / `useFlipperClient()` (`@flipperdotfamily/react-native/headless`) for building your own UI.
- React Native 0.72+ and Expo (the dev client or Expo Go: `react-native-webview` ships with Expo Go).

## Install

```sh
npm install @flipperdotfamily/react-native react-native-webview
# Expo:
npx expo install @flipperdotfamily/react-native react-native-webview
# iOS (bare React Native):
cd ios && pod install
```

The headless hooks also need `viem` and a `crypto.getRandomValues` polyfill (import it first in your entry file):

```sh
npm install viem react-native-get-random-values
```

## Quick start

```tsx
import { FlipperWidget } from "@flipperdotfamily/react-native";

export function FlipScreen({ provider, address, chainId, openWallet }) {
  return (
    <ScrollView>
      <FlipperWidget
        wallet={provider}              // any EIP-1193 provider, or null
        address={address}              // optional: hook-based wallet state
        walletChainId={chainId}
        theme="dark"
        accent="#ff5a1f"
        partner="acme"
        onConnectRequest={openWallet}  // "Connect wallet" in the widget: open your wallet UI
        onFlipSettled={(f) => console.log(f.outcome, f.payout)}
        style={{ marginHorizontal: 16 }}
      />
    </ScrollView>
  );
}
```

The widget sizes itself to its content (`autoHeight`), so place it in a `ScrollView`.

## Wallet wiring

By default the embed can ask the host wallet for seven JSON-RPC methods (three more with `enableBatchCalls`), and only in response to the user:

| Method | When |
|---|---|
| `eth_sendTransaction` | approvals, flips, listings (fully specified by the embed: `gas`, EIP-1559 fees) |
| `wallet_switchEthereumChain` / `wallet_addEthereumChain` | the wallet is on another chain (a `4902` from the switch makes the embed send add) |
| `wallet_watchAsset` | "Add to wallet" after a win |
| `eth_accounts`, `eth_chainId`, `eth_requestAccounts` | state reads |

Message signing (`personal_sign`, `eth_signTypedData_v4`) is never forwarded: the embed doesn't sign messages, so
those get `4200` like any other method outside the list.

Price, balance and preview reads never touch your wallet, because the embed has its own RPC.

`wallet` accepts any object with `request({ method, params })`. When the provider emits the EIP-1193 events
`accountsChanged`, `chainChanged` and `disconnect`, the widget follows them. Libraries that expose state through hooks
can pass `address` (or `accounts`) and `walletChainId` instead; props win over provider events.

### Reown AppKit (WalletConnect)

```tsx
import { useAccount, useAppKit, useProvider } from "@reown/appkit-react-native";

function Flip() {
  const { provider, providerType } = useProvider();
  const { address, chainId, isConnected } = useAccount();
  const { open } = useAppKit();
  return (
    <FlipperWidget
      wallet={isConnected && providerType === "eip155" ? provider : null}
      address={address ?? null}
      walletChainId={chainId ?? null}   // number or CAIP-2 ("eip155:4663") both work
      onConnectRequest={() => open()}
    />
  );
}
```

Add Robinhood Chain (4663; viem's `robinhood` from `viem/chains`) to AppKit's `networks` (see
`examples/react-native-expo/src/appkit.ts`).

### wagmi / viem

```tsx
const { data: walletClient } = useWalletClient();       // a viem WalletClient is EIP-1193-compatible
const { address, chainId } = useAccount();
<FlipperWidget wallet={walletClient ?? null} address={address ?? null} walletChainId={chainId} onConnectRequest={openConnectModal} />
```

### MetaMask SDK

```tsx
const provider = sdk.getProvider();                      // EIP-1193, emits accountsChanged / chainChanged
<FlipperWidget wallet={provider} onConnectRequest={() => sdk.connect()} />
```

### Any other wallet

```ts
import { createFlipperWallet, FlipperRpcError } from "@flipperdotfamily/react-native";

const wallet = createFlipperWallet({
  request: async (method, params) => {
    if (method === "eth_sendTransaction") return myWallet.sendTransaction((params as any[])[0]);  // must prompt the user
    throw new FlipperRpcError(4200, `Unsupported: ${method}`);
  },
  subscribe: (emit) => myWallet.onChange((s) => emit({ accounts: s.accounts, chainId: s.chainId })),
});
```

### Errors

Throw, or let your provider throw, errors with an EIP-1193 `code`. The code is passed through unchanged, and it
also works when it sits on a viem error's `cause`:
- `4001`: the user rejected or closed the prompt.
- `4100`: not connected.
- `4902`: unknown chain; the embed then sends `wallet_addEthereumChain`.

Errors without a code become `-32603`. Without a wallet, `eth_accounts` returns `[]`, `eth_chainId` returns the
configured chain, and `eth_requestAccounts` calls `onConnectRequest` and answers `4100`.

### Batched calls (optional)

The embed can also send three EIP-5792 methods: `wallet_getCapabilities`, `wallet_sendCalls` and
`wallet_getCallsStatus`. With a wallet that supports atomic batches, a native-ETH flip is then one confirmation
(wrap, approve and flip together) instead of up to three. The SDK doesn't forward them by default: they're answered
with `4200`, and the embed falls back to sending the transactions one by one.

Opt in only if the wallet implements EIP-5792 over your connection (many WalletConnect mobile wallets don't yet):

```tsx
<FlipperWidget wallet={provider} enableBatchCalls />
```

`allowedMethods` still narrows the forwarded set; it can include the batch methods only when `enableBatchCalls` is
on. Nothing outside the embed's 10 methods is ever forwarded. A wallet that doesn't support a batch call should
throw `4200` (or `5700` for an unsupported capability), and the embed then falls back.

## Props

| Prop | Default | |
|---|---|---|
| `wallet` | `null` | EIP-1193 provider or `createFlipperWallet(…)` |
| `address` / `accounts`, `walletChainId` | provider events | hook-based wallet state |
| `chain` | `4663` (Robinhood Chain) | chain to flip on (`31337` for a local fork). Changing it reloads the embed |
| `mode` | `"picker"` | `"picker"`: the user chooses the token. `"single"`: one fixed token (set `token`; without it the embed shows a configuration error), and no picker is rendered |
| `token`, `tokens` | $FLIPPER, all | initial (or, in single mode, the only) token; picker allowlist |
| `theme` | `"auto"` | `"light"`, `"dark"`, `"auto"`, or an object of custom theme tokens |
| `accent`, `radius` | flipper sky blue, `24` | accent colour (`"#ff5a1f"`); card corner radius in px (0–40) |
| `branding` | `true` | `false` removes the flipper.family marks |
| `partner` | — | attribution id, echoed in every event. Changing it reloads the embed |
| `locale`, `compact` | `en`, `false` | |
| `fit` | `"auto"` | `"auto"`: the view takes the widget's content height. `"fill"`: the widget fills the view at whatever size `style` gives it (a full screen, a tile), and `autoHeight` defaults to `false` |
| `hidePicker` | `false` | **deprecated**: use `mode="single"` |
| `details` | `false` | show the win chance / payout / fee line under the button (off: only a "↓ Odds 0.9 pts below usual" note, when fees trim the odds) |
| `tagline` | none | a headline under the coin while idle: `true` for the built-in one, or your own text |
| `config` | — | any other `FlipperEmbedConfig` field: `brandName`, `brandLogo`, `coinImage`, `coinImageTails`, `strings`, `minAmount`, `maxAmount`, `approval`, `listing`, `rpcUrl`, `apiUrl`, `addresses`. `rpcUrl`, `apiUrl` and `addresses` never go in the URL (the embed ignores them there); they're sent as a `config` message after every `ready` |
| `baseUrl` | `https://flipper.family/embed` | `http://localhost:3000/embed` in development |
| `allowInsecureLocalhost` | `__DEV__` | allows `http://` for localhost / 127.0.0.1 / 10.0.2.2 / ::1 only |
| `enableBatchCalls` | `false` | also forward the EIP-5792 batch methods (see "Batched calls") |
| `allowedMethods` | all seven (ten with `enableBatchCalls`) | narrows the RPC allowlist (it can't widen it) |
| `autoHeight`, `initialHeight`, `minHeight`, `maxHeight` | `true`, `560`, `120`, — | sizing |
| `style` | — | container style |
| `onOpenExternalUrl` | `Linking.openURL` | handle links that leave the embed |
| `webViewProps` | — | extra WebView props (`testID`, `renderLoading`, …); the security props can't be overridden |
| `debug` | `__DEV__` | logs dropped messages |

Changing a prop other than `chain`, `partner` or `baseUrl` sends one live `config` message, with no reload. The ref
handle offers `reload()`, `setConfig(partial)` and `refreshWallet()`.

## Theme and white-label

```tsx
<FlipperWidget
  theme={colorScheme === "dark" ? "dark" : "light"}   // follow the app
  accent="#ff5a1f"
  radius={16}
  branding={false}
  config={{
    brandName: "Acme Flip",
    brandLogo: "data:image/png;base64,iVBORw0…", // images as data: URIs: the embed's CSP loads no other hosts
    coinImage: "data:image/png;base64,iVBORw0…",
    coinImageTails: "data:image/png;base64,iVBORw0…",
    strings: { flip: "Lanzar" },
  }}
/>
```

`theme` also accepts an object of custom theme tokens, which is passed through to the embed as `config.theme`.

## Events

| Prop | Payload (BRIDGE.md section 5) |
|---|---|
| `onReady` | `{ version, chainId, account, token, variant, partner }` |
| `onConnectRequest` | `{ reason: "connect" \| "flip" \| "list", partner }` |
| `onFlipRequested` | `{ flipId, account, token, symbol, decimals, amount, winChanceBps, randomnessFee, txHash, approveTxHash, native, partner }`. With `native`, `token` is WETH and `symbol` is `"ETH"` |
| `onFlipSettled` | `{ flipId, outcome, status, won, pending, payout, payoutToken, flipperPaid, txHash, requestTxHash, native, … }`. A `pending` (WinPending) flip's winnings are still owed, and the widget offers Retry payout. It gets a second event with the same `flipId` once they're paid; the last one is final |
| `onPayoutResolved` | `{ flipId, account, token, symbol, decimals, tokenPaid, flipperPaid, by: "self" \| "other", native, txHash, partner }`. Once per pending win, when its winnings are paid (alongside the final `onFlipSettled`). `by: "other"` is usually flipper's payout worker. With `native`, `token` is WETH (the winnings arrive as WETH) and `symbol` is `"ETH"` |
| `onListing` | `{ stage, token, symbol, txHash, error, partner }` |
| `onError` | `{ code, message, context, partner }`. `message` is safe to show. The SDK adds `context: "config"` for a bad `baseUrl` and `code: "network"` for load failures |
| `onResize` | height in dp (clamped) |
| `onEvent` | every event as `{ name, data }`, including `{ name: "unknown", rawName, data }` from newer embeds |

Amounts are decimal strings in the token's smallest unit.

## Headless hooks (native UI)

```tsx
import "react-native-get-random-values";
import { useFlipperHeadless } from "@flipperdotfamily/react-native/headless";

function NativeFlip({ provider, address }) {
  const [text, setText] = useState("");
  const f = useFlipperHeadless({ wallet: provider, account: address, amount: text });
  if (!f.token) return <ActivityIndicator />;
  return (
    <View>
      <Text>{f.token.symbol} balance: {f.balance?.toString()}</Text>
      <TextInput value={text} onChangeText={setText} keyboardType="decimal-pad" />
      {f.reject && <Text>{f.reject.message}</Text>}
      {f.odds?.shifted && <Text>{f.odds.message}</Text>}
      <Button title={f.busy ? "Flipping…" : "Flip"} disabled={!f.canTransact || f.busy || !!f.reject} onPress={() => f.flip()} />
      {f.phase.kind === "settled" && <Text>{f.phase.copy.headline}</Text>}
      {f.phase.kind === "error" && <Text>{f.phase.message}</Text>}
    </View>
  );
}
```

`useFlipperClient()` returns a `FlipperClient` from `@flipperdotfamily/sdk`, with the full API: `preview`, `flip`,
`waitForSettlement`, `maxStake`, `claim`, holder rewards and staking. Reads go through the deployment's public RPC
(`rpcUrl` overrides it), and transactions go through your wallet. The contract addresses come from `addresses`, the
SDK registry, or the live manifest at `https://flipper.family/embed/deployment.json`.

## Security

- **Only the embed origin.** `baseUrl` must be https. Plain `http` is allowed only for loopback hosts with
  `allowInsecureLocalhost`, which defaults to `__DEV__`. URLs with credentials are rejected.
- **Navigation stays on the embed.**
  - Top-level navigation is limited to the embed origin.
  - Other `http(s)`, `mailto:` and `tel:` links open in the system browser.
  - Other schemes (`javascript:`, `file:`, `intent:`, deep links) are blocked.
  - Sub-frames may load only the embed origin and `about:blank` / `about:srcdoc`.
  - `target=_blank` and `window.open` never open a second WebView.
- **The bridge only listens to the embed.**
  - `window.FlipperHost` is injected before the page's scripts, in the main frame only, and is frozen and
    non-writable.
  - A message is dropped unless its page URL is on the embed origin and it carries `source: "flipper"` and `v: 1`.
  - Oversized or malformed messages are dropped.
- **An allowlisted wallet surface.** Only the seven methods above are forwarded (no message signing); anything
  else gets `4200`. You can narrow the list with `allowedMethods`.
- **No keys and no secrets.** Only JSON-RPC requests and public events cross the bridge.
- **Your wallet always confirms.** Every transaction or signature is shown by *your* wallet's own confirmation UI.
  Never auto-approve bridge requests; with an embedded or custodial wallet that has no prompt of its own, add one.
- **Hardening.**
  - Blocked: file access, universal access from file URLs, mixed content, geolocation, media capture, link previews
    and zoom.
  - The WebView is debuggable only in `__DEV__`.
  - If the web process dies, the widget reloads.
- **Residual risk (Android).** react-native-webview exposes `window.ReactNativeWebView` to every frame, so the origin
  check uses the page URL. The embed loads no third-party frames.

## Local development

```tsx
<FlipperWidget baseUrl={Platform.OS === "android" ? "http://10.0.2.2:3000/embed" : "http://localhost:3000/embed"} chain={31337} />
```

The Android emulator reaches the host machine at `10.0.2.2`. On a physical device, use an https tunnel: plain http
to a LAN IP is rejected on purpose. Android also needs cleartext traffic for `http://` in debug builds. With Expo,
use `expo-build-properties` with `android.usesCleartextTraffic: true` in the development profile only.

## Troubleshooting

- **Blank widget.** Check `onError`. `config` means `baseUrl` isn't https (or is http outside `__DEV__`); `network`
  means the page didn't load (on Android, also check cleartext settings for localhost).
- **"Connect wallet" does nothing.** Implement `onConnectRequest` and open your wallet UI.
- **Connected in the app but not in the widget.** Pass `address` / `walletChainId` (AppKit, wagmi), or use a provider
  that emits `accountsChanged` / `chainChanged`.
- **Stuck on "Confirm in wallet…".** Your provider's `request` never settled; reject with `4001` when the user
  dismisses the prompt. With WalletConnect, make sure the app returns from the wallet (set the `redirect` metadata).
- **"Switch to Robinhood Chain" repeats.** The wallet doesn't know chain 4663: add it to your wallet config or answer
  the switch with `4902`, so the embed sends `wallet_addEthereumChain`.
- **The height jumps or the content is cut off.** Keep `autoHeight` on and don't give the container a fixed height.
  Or turn it off, set a height and let the WebView scroll.
- **`crypto.getRandomValues` is not a function (headless).** Import `react-native-get-random-values` first in your
  entry file.

## How it works

`FlipperBridgeCore` (exported, WebView-independent) holds the protocol:
- validation and the allowlist;
- request id tracking, with duplicates rejected;
- page generations, so answers meant for a page that has since reloaded are dropped;
- a `ready` gate for the wallet state and live config, which are re-sent after every reload;
- `hostConfig`: the fields the embed only accepts from its host, never from its URL (`rpcUrl`, `apiUrl`, `addresses`;
  `hostOnlyConfigOf(props)` picks them out of `config`), sent in a `config` message after every `ready`;
- JSON-to-JS string encoding.

`<FlipperWidget>` wires it to `react-native-webview`: `injectedJavaScriptBeforeContentLoaded` for FlipperHost,
`onMessage` in, `injectJavaScript` out, and `onShouldStartLoadWithRequest` / `onOpenWindow` for navigation.

Tests run in Node with `pnpm test`: the bridge, URL and navigation logic, plus end-to-end runs in which the injected
scripts and a stub embed page execute in a `vm` "WebView". Typecheck with `pnpm typecheck`.

## Publishing (maintainers)

1. The npm org `@flipperdotfamily` must exist and be owned by the team (`npm org create flipperdotfamily`).
2. `pnpm --filter @flipperdotfamily/react-native typecheck && pnpm --filter @flipperdotfamily/react-native test`
3. `pnpm --filter @flipperdotfamily/react-native publish --access public`. pnpm rewrites `workspace:^0.1.0` for
   `@flipperdotfamily/sdk`, so publish `@flipperdotfamily/sdk` first.
