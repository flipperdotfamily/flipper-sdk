# React: `@flipperdotfamily/react`

`@flipperdotfamily/react` wraps `<flipper-widget>`. It is a client component (`"use client"`) and SSR-safe: on the server it
renders the tag, and in the browser it upgrades. For Next.js, also read [nextjs.md](nextjs.md).

```sh
pnpm add @flipperdotfamily/react          # or npm i / yarn add / bun add
# only if you import types from it (strict pnpm): pnpm add @flipperdotfamily/widget@<the version @flipperdotfamily/react uses>
```

## API

```tsx
import { FlipperWidget, FlipperConfigProvider, useFlipperClient } from "@flipperdotfamily/react";
```

- `<FlipperWidget {...options} />`
  - **Props:** every widget option in camelCase: `provider`, `walletClient`, `chainId`, `rpcUrl`, `apiUrl`,
    `deploymentUrl`, `addresses`, `token`, `tokens`, `mode` (`"picker"` / `"single"`), `fit` (`"auto"` / `"fill"`),
    `size`, `details`, `tagline`, `eth`, `listing`, `minAmount`, `maxAmount`,
    `approval`, `variant`, `theme`, `accent`, `radius`, `branding`, `brandName`, `brandLogo`, `coinImage`,
    `coinImageTails`, `buttonLabel`, `locale`, `strings`, `reducedMotion`, `partner`. Plus `className`, `style`
    and `id`.
  - **Callbacks:** `onReady`, `onConnectRequest`, `onFlipRequested`, `onFlipSettled`, `onPayoutResolved`,
    `onListing`, `onError` and `onResize`. Each receives the event **detail**, not the event.
  - **`ref`:** gives the `<flipper-widget>` element: `open()`, `close()`, `refresh()`, and `client`.
- `<FlipperConfigProvider config={{ partner, theme, … }}>`: defaults for every widget below it. Props on a widget
  win over these.
- `useFlipperClient({ provider?, walletClient?, chainId?, rpcUrl?, addresses?, deploymentUrl? })`: returns
  `{ client, deployment, chain, loading, error }` for headless reads and writes (see
  [headless-sdk.md](headless-sdk.md)).

## 1. Add Robinhood Chain to the wallet config

Edit the app's **existing** wagmi / RainbowKit config. Don't create a second one. Robinhood Chain is viem's `robinhood`
chain (viem 2.55 or newer):

```ts
// src/chains.ts
export { robinhood } from "viem/chains"; // 4663. Local fork (31337): `foundry` from "viem/chains".
```

```ts
// src/wagmi.ts: RainbowKit
import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { robinhood } from "./chains";

export const config = getDefaultConfig({
  appName: "Acme",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  chains: [robinhood /* , ...the app's existing chains */],
});

// plain wagmi: createConfig({ chains: [robinhood, ...], transports: { [robinhood.id]: http(), ... }, connectors })
```

Why this matters: wagmi only follows the wallet onto chains in its config. Without 4663 there, `useWalletClient()`
loses its client after the widget switches the wallet, and the widget drops back to "Connect wallet".

## 2. A complete component (wagmi + RainbowKit)

This assumes the usual `<WagmiProvider config={config}><QueryClientProvider client={queryClient}>
<RainbowKitProvider>` tree already wraps the app.

```tsx
// src/components/FlipCard.tsx
import { useRef } from "react";
import { FlipperWidget } from "@flipperdotfamily/react";
import type { FlipperEventMap, FlipperTheme } from "@flipperdotfamily/widget";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useBalance, useWalletClient } from "wagmi";

// constant objects live outside the component: a new object each render re-applies (or, for `addresses`, reloads)
const theme: FlipperTheme = { mode: "auto", accent: "#7c5cff", radius: 16, fontFamily: "inherit" };

export function FlipCard() {
  const { data: walletClient } = useWalletClient(); // undefined until connected: the widget is read-only
  const { openConnectModal } = useConnectModal();   // undefined while connected
  const { address } = useAccount();
  const { refetch: refetchBalance } = useBalance({ address });
  const settled = useRef(new Set<string>());

  function onFlipSettled(d: FlipperEventMap["flip-settled"]) {
    if (d.pending) return;                          // WinPending: a final flip-settled follows
    if (settled.current.has(d.flipId)) return;
    settled.current.add(d.flipId);
    void refetchBalance();                          // refresh the app's own balances
    // analytics.track("flip_settled", { outcome: d.outcome, token: d.symbol, amount: d.amount, partner: d.partner });
  }

  return (
    <FlipperWidget
      walletClient={walletClient}
      onConnectRequest={() => openConnectModal?.()}
      partner="acme"
      theme={theme}
      onFlipSettled={onFlipSettled}
      onError={(e) => {
        if (e.code !== "user-rejected") console.warn("flipper:", e.context, e.message);
      }}
      style={{ display: "block", maxWidth: 460, margin: "0 auto" }}
    />
  );
}
```

On wagmi 3, `useAccount` is `useConnection`.

## 3. Other wallet stacks

**Plain wagmi (its own modal or buttons).**
`walletClient={useWalletClient().data}` and `onConnectRequest={() => setConnectOpen(true)}`, where
`setConnectOpen` is whatever opens the app's connect UI.

**ConnectKit.**

```tsx
import { useModal } from "connectkit";
const { setOpen } = useModal();
<FlipperWidget walletClient={walletClient} onConnectRequest={() => setOpen(true)} />
```

**Reown AppKit.** Add the chain to `createAppKit({ networks })`:

```ts
import { defineChain } from "@reown/appkit/networks";
export const robinhoodChain = defineChain({
  id: 4663,
  caipNetworkId: "eip155:4663",
  chainNamespace: "eip155",
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});
```

```tsx
import { useAppKit, useAppKitProvider } from "@reown/appkit/react";
import type { Eip1193Provider } from "@flipperdotfamily/widget";

export function FlipCard() {
  const { open } = useAppKit();
  const { walletProvider } = useAppKitProvider<Eip1193Provider>("eip155"); // undefined while disconnected
  return <FlipperWidget provider={walletProvider ?? null} onConnectRequest={() => void open()} partner="acme" />;
}
```

With AppKit's Wagmi adapter, the wagmi pattern (`useWalletClient`) works too.

**Privy.** If the app uses `@privy-io/wagmi`, use the wagmi pattern with `onConnectRequest={() => login()}`.
Otherwise:

```tsx
import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { FlipperWidget } from "@flipperdotfamily/react";
import type { Eip1193Provider } from "@flipperdotfamily/widget";

export function FlipCard() {
  const { login } = usePrivy();
  const { wallets } = useWallets();
  const wallet = wallets[0];
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);

  useEffect(() => {
    if (!wallet) return setProvider(null);
    let live = true;
    void wallet.getEthereumProvider().then((p) => live && setProvider(p as Eip1193Provider));
    return () => { live = false; };
    // keyed by address: the wallet object may be recreated on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.address]);

  return <FlipperWidget provider={provider} onConnectRequest={() => login()} partner="acme" />;
}
```

Add Robinhood Chain (viem's `robinhood`) to `PrivyProvider`'s `config.supportedChains`.

**Dynamic.** Use `@dynamic-labs/wagmi-connector` (`DynamicWagmiConnector`) with the wagmi pattern, and
`onConnectRequest={() => setShowAuthFlow(true)}` from `useDynamicContext()`.
- Without wagmi: `isEthereumWallet(primaryWallet)` (from `@dynamic-labs/ethereum`), then
  `await primaryWallet.getWalletClient()`, passed as `walletClient`.
- In that case, fetch it again whenever the wallet's account or network changes.

**thirdweb v5.** Convert the active wallet to EIP-1193 with `EIP1193.toProvider({ wallet, chain, client })` (from
`thirdweb/wallets`) and pass it as `provider`. Open thirdweb's connect UI from `onConnectRequest`. Check both calls
against the installed version.

**Injected only (no wallet library).** Omit `onConnectRequest`, and the widget calls `eth_requestAccounts`:

```tsx
const injected = typeof window !== "undefined" ? (window as unknown as { ethereum?: Eip1193Provider }).ethereum : undefined;
<FlipperWidget provider={injected ?? null} partner="acme" />
```

## 4. Defaults, refs and the headless hook

```tsx
// app root: shared defaults
<FlipperConfigProvider config={{ partner: "acme", theme: "auto", accent: "#7c5cff" }}>
  <App />
</FlipperConfigProvider>
```

```tsx
// button variant opened from the app's own UI
import type { FlipperWidget as FlipperWidgetElement } from "@flipperdotfamily/widget";
const ref = useRef<FlipperWidgetElement>(null);
<FlipperWidget ref={ref} variant="button" buttonLabel="Double or nothing" walletClient={walletClient} />
<button onClick={() => void ref.current?.open()}>Flip</button>
// after the app itself moves funds: ref.current?.refresh()
```

```tsx
// headless reads next to the widget
const { data: walletClient } = useWalletClient();
const { client, deployment, loading, error } = useFlipperClient({ walletClient });
useEffect(() => {
  if (!client) return;
  let live = true;
  void client.house().then((h) => live && setPaused(h.paused));
  return () => { live = false; };
}, [client]);
```

## 5. Local dev and config knobs

```tsx
const local = import.meta.env.VITE_FLIPPER_LOCAL === "1"; // Next.js: process.env.NEXT_PUBLIC_FLIPPER_LOCAL
<FlipperWidget
  chainId={local ? 31337 : undefined}
  deploymentUrl={local ? "http://localhost:3000/embed/deployment.json" : undefined}
  walletClient={walletClient}
/>
```

In local dev, the app's wagmi config also needs `foundry` (31337) in `chains`, so that the wallet client exists on
the fork.

## 6. Gotchas

- **Hoist or memoize objects.** Inline `addresses={{…}}` or `tokens={[…]}` literals are new objects on every render.
  `addresses` makes the widget reload its deployment, and `tokens` resets the token list. Put constants at module
  scope or in `useMemo`. `theme` and `strings` objects are cheap to replace, but hoist them anyway.
- **Pass `walletClient` as-is.** `useWalletClient().data` is `undefined` until connected and changes on every
  account or chain switch. That's expected; don't cache it in state.
- **`openConnectModal` is `undefined` while connected** (RainbowKit). Always call it as `openConnectModal?.()`.
- **Keep one React.** "Invalid hook call" or a null context usually means two React copies (a linked package or a
  monorepo). Check with `pnpm why react` / `npm ls react`. With Vite, add `resolve: { dedupe: ["react", "react-dom"] }`.
- **viem types.** A TS error on the `walletClient` prop usually means two viem copies. Align the versions and run
  `pnpm dedupe`.
- **React 18 without the wrapper.** React 18 sets attributes, not properties, on custom elements, so a raw
  `<flipper-widget provider={…}>` gets `"[object Object]"`. Use `@flipperdotfamily/react`, or set the properties through a
  `ref` in `useEffect`.
- **StrictMode.** Double mounting in development is fine: the element cleans up on disconnect.
- **Remix / other SSR.** The wrapper renders on the server. Keep wallet code (`window.ethereum`, connectors) in
  effects or client-only modules.
