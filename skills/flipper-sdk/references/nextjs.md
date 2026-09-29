# Next.js (App Router and Pages Router)

Use `@flipperdotfamily/react`; its API is in [react.md](react.md). This file covers what differs in Next.js: server
rendering, the provider tree, dynamic import and CSP.

```sh
pnpm add @flipperdotfamily/react
```

## How SSR works here

- `@flipperdotfamily/react` is a client component. On the server it renders an empty `<flipper-widget>` tag, and in the
  browser the element upgrades and renders itself. **No dynamic import is needed.**
- `import "@flipperdotfamily/widget"` (which the wrapper does) is a no-op on the server, so it never touches `window`.
- A "window is not defined" error during SSR comes from **wallet code** (connectors, `window.ethereum` read during
  render, or a config built at module scope that touches `window`), not from the widget. Move that code into the
  `"use client"` providers file, or into effects.

## App Router

**1. Providers** (edit the app's existing file; this is the usual RainbowKit + wagmi shape):

```tsx
// app/providers.tsx
"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { robinhood } from "viem/chains"; // viem 2.55 or newer
import "@rainbow-me/rainbowkit/styles.css";

const config = getDefaultConfig({
  appName: "Acme",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [robinhood /* , ...the app's existing chains */],
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

`app/layout.tsx` wraps `{children}` in `<Providers>`. It usually does already.

**2. The widget, in a client component next to those providers:**

```tsx
// app/flip/flip-card.tsx
"use client";

import { useRef } from "react";
import { FlipperWidget } from "@flipperdotfamily/react";
import type { FlipperEventMap } from "@flipperdotfamily/widget";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useWalletClient } from "wagmi";
import { useRouter } from "next/navigation";

const local = process.env.NEXT_PUBLIC_FLIPPER_LOCAL === "1";

export function FlipCard() {
  const { data: walletClient } = useWalletClient();
  const { openConnectModal } = useConnectModal();
  const router = useRouter();
  const seen = useRef(new Set<string>());

  function onFlipSettled(d: FlipperEventMap["flip-settled"]) {
    if (d.pending || seen.current.has(d.flipId)) return;
    seen.current.add(d.flipId);
    router.refresh(); // re-render server components that show balances or history
  }

  return (
    <FlipperWidget
      walletClient={walletClient}
      onConnectRequest={() => openConnectModal?.()}
      partner={process.env.NEXT_PUBLIC_FLIPPER_PARTNER}
      theme="auto"
      chainId={local ? 31337 : undefined}
      deploymentUrl={local ? "http://localhost:3000/embed/deployment.json" : undefined}
      onFlipSettled={onFlipSettled}
      onError={(e) => e.code !== "user-rejected" && console.warn("flipper:", e.message)}
    />
  );
}
```

**3. A server page renders it:**

```tsx
// app/flip/page.tsx (a Server Component: no "use client")
import { FlipCard } from "./flip-card";

export const metadata = { title: "Flip" };

export default function FlipPage() {
  return (
    <main style={{ maxWidth: 460, margin: "0 auto", padding: 16 }}>
      <FlipCard />
    </main>
  );
}
```

**Avoid layout shift.** The server HTML is an empty tag, so reserve space in `app/globals.css`:

```css
flipper-widget { display: block; }
flipper-widget:not(:defined) { min-height: 560px; }
```

**Dark mode with `next-themes`.** Its `.dark` class doesn't affect `theme="auto"`, so pass the resolved theme:

```tsx
const { resolvedTheme } = useTheme();
<FlipperWidget theme={resolvedTheme === "dark" ? "dark" : "light"} … />
```

## Pages Router

Put the providers in `pages/_app.tsx` (without `"use client"`). Import `FlipCard` into any page: the same component
works there, and the `"use client"` directive is ignored in the Pages Router.

## Optional: client-only rendering

This skips the SSR tag entirely. It is useful if you see hydration warnings (see Gotchas) or want no widget HTML on
the server. With the App Router, `ssr: false` is only allowed **inside a Client Component**:

```tsx
// app/flip/flip-card-lazy.tsx
"use client";
import dynamic from "next/dynamic";

export const FlipCardLazy = dynamic(() => import("./flip-card").then((m) => m.FlipCard), {
  ssr: false,
  loading: () => <div style={{ minHeight: 560 }} />,
});
```

## Env and config

| Env var | Use |
|---|---|
| `NEXT_PUBLIC_FLIPPER_PARTNER` | `partner` |
| `NEXT_PUBLIC_FLIPPER_LOCAL=1` | `chainId={31337}` + `deploymentUrl="http://localhost:3000/embed/deployment.json"` |

- flipper's own dev server uses port 3000, so run the Next app on another port (`next dev -p 3001`).
- For the local fork, add `foundry` (31337, from `viem/chains`) to the wagmi `chains` too.
- Only `NEXT_PUBLIC_*` variables reach client components.

## CSP (`next.config.ts` headers or middleware)

Add these to the existing policy. Don't replace it:

```ts
// next.config.ts
const csp = [
  "connect-src 'self' https://flipper.family https://api.flipper.family https://rpc.mainnet.chain.robinhood.com <the wallet's endpoints>",
  "img-src 'self' data: https://api.flipper.family <brandLogo / coinImage hosts>",
  // only when embedding the iframe: "frame-src https://flipper.family",
].join("; ");

export default {
  async headers() {
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: csp }] }];
  },
};
```

That is an illustration: merge the sources into the app's real `default-src` / `script-src` / `style-src`
directives. If the app uses a nonce-based CSP, the npm build needs no `script-src` change.

## Gotchas

- **Hydration warnings.** When `<flipper-widget>` upgrades, it sets a `variant` attribute and inline CSS variables
  on itself. If React warns about attributes on that tag, the warning is harmless. The `ssr: false` variant above
  removes it.
- **`ssr: false` in a Server Component** errors in Next 15+. Wrap it in a client component, as shown.
- **Server Components can't pass functions.** `onFlipSettled` and friends must live in the client component, not
  in `page.tsx`.
- **`window is not defined`.** See "How SSR works" above. Never read `window.ethereum` at module scope or during
  render in a component that also renders on the server.
- **Two wagmi configs.** If the app already has one, add the chain there. A second `WagmiProvider` gives the widget
  a different, disconnected client.
- **Middleware / edge.** Nothing in flipper runs on the server. There's no API key or secret to configure.
