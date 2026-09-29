# @flipperdotfamily/react

React bindings for [flipper.family](https://flipper.family) coin flips: the drop-in `<FlipperWidget />` (a typed,
SSR-safe wrapper around the [`<flipper-widget>`](../widget) web component) and a headless `useFlipperClient` hook.
React 18 and 19; works in Next.js (App Router and Pages), Remix, Vite, CRA…

```sh
npm i @flipperdotfamily/react
```

## Drop-in widget

The wallet is yours. Pass `walletClient` (viem / wagmi) or `provider` (any EIP-1193), and open your connect modal
from `onConnectRequest`:

```tsx
"use client";
import { FlipperWidget } from "@flipperdotfamily/react";
import { useConnectModal } from "@rainbow-me/rainbowkit"; // or AppKit's useAppKit().open, or your own
import { useWalletClient } from "wagmi";

export function Flip() {
  const { data: walletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();
  return (
    <FlipperWidget
      walletClient={walletClient}
      onConnectRequest={() => openConnectModal?.()}
      theme={{ mode: "dark", accent: "#ff5a1f", radius: 16 }}
      partner="acme"
      onFlipSettled={(d) => console.log(d.outcome, d.payout)}
    />
  );
}
```

- **Props**: every widget option (see the [widget README](../widget#configuration)): `chainId`, `token`, `tokens`,
  `hidePicker`, `variant`, `theme`, `accent`, `radius`, `branding`, `brandName`, `brandLogo`, `coinImage`, `strings`,
  `locale`, `partner`, `minAmount`, `maxAmount`, `approval`, `listing`, `eth`, `rpcUrl`, `apiUrl`, `addresses`…,
  plus `className`, `style` and `id`.
- **Callbacks** receive the event `detail`: `onReady`, `onConnectRequest`, `onFlipRequested`, `onFlipSettled`,
  `onPayoutResolved`, `onListing`, `onError`, `onResize`.
- **ref** gives the `<flipper-widget>` element: `ref.current.open()` (with `variant="button"`), `close()`,
  `refresh()`, and `client` (the SDK client).
- **SSR**: the component renders the tag on the server and loads the element in the browser (`import("@flipperdotfamily/widget")`
  in an effect), so there is nothing to configure for Next.js. Give it a `style={{ minHeight: 520 }}` to reserve space.

Defaults for every widget in a subtree:

```tsx
<FlipperConfigProvider config={{ partner: "acme", theme: { mode: "auto", accent: "#ff5a1f" } }}>{children}</FlipperConfigProvider>
```

## Headless

```tsx
const { client, deployment, loading, error } = useFlipperClient({ walletClient });
const house = await client?.house();
await client?.flip({ token: house!.flipper, amount: parseUnits("100", 18) });
```

`useFlipperClient` resolves the live deployment (or takes `chainId`, `rpcUrl`, `addresses`, `deploymentUrl`), and
returns an [`@flipperdotfamily/sdk`](../sdk) client wired to your wallet.

Docs: [flipper.family/docs/integrate](https://flipper.family/docs/integrate) · Example: [`examples/react-vite`](../examples/react-vite),
[`examples/nextjs-app-router`](../examples/nextjs-app-router)
