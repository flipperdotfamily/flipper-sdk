# Svelte 5 and SvelteKit: `@flipperdotfamily/svelte`

The wrapper needs **Svelte 5** (runes and callback props). On Svelte 4, use the element directly (see
[vanilla.md](vanilla.md) §5).

```sh
pnpm add @flipperdotfamily/svelte     # or npm i / yarn add / bun add
# types (strict pnpm): pnpm add @flipperdotfamily/widget@<the version @flipperdotfamily/svelte uses>
```

## API

```svelte
<FlipperWidget {provider} theme="dark" partner="acme"
  onConnectRequest={open} onFlipSettled={(d) => …} bind:element />
```

- **Props:** every widget option in camelCase: `provider`, `walletClient`, `chainId`, `rpcUrl`, `deploymentUrl`,
  `addresses`, `token`, `tokens`, `mode`, `fit`, `size`, `details`, `tagline`, `eth`, `listing`, `minAmount`, `maxAmount`, `approval`, `variant`,
  `theme`, `accent`, `radius`, `branding`, `brandName`, `brandLogo`, `coinImage`, `coinImageTails`, `buttonLabel`,
  `locale`, `strings`, `reducedMotion`, `partner`.
- **Callback props:** `onReady`, `onConnectRequest`, `onFlipRequested`, `onFlipSettled`, `onPayoutResolved`,
  `onListing`, `onError` and `onResize`. Each receives the event **detail**.
- **`bind:element`:** the `<flipper-widget>` element, with `open()`, `close()`, `refresh()` and `client`.

## 1. Wallet helper (wagmi core; also Reown AppKit's Wagmi adapter)

```ts
// src/lib/flipper-wallet.ts
import { getAccount, watchAccount, type Config } from "@wagmi/core";
import type { Eip1193Provider } from "@flipperdotfamily/widget";

/** Calls `onChange` with the connected wallet's EIP-1193 provider, or null while disconnected. Returns an unsubscribe. */
export function watchFlipperProvider(config: Config, onChange: (p: Eip1193Provider | null) => void): () => void {
  let seq = 0;
  const update = async () => {
    const id = ++seq;
    const { address, connector } = getAccount(config);
    let p: Eip1193Provider | null = null;
    if (address && connector) {
      try {
        p = (await connector.getProvider()) as Eip1193Provider;
      } catch {
        p = null;
      }
    }
    if (id === seq) onChange(p);
  };
  void update();
  return watchAccount(config, { onChange: () => void update() });
}
```

- On wagmi 3, the actions are `getConnection` / `watchConnection`.
- Add Robinhood Chain (4663) to the wagmi `chains` / AppKit `networks`, using the chain from
  [react.md](react.md) §1 (viem) or [vue.md](vue.md) §2 (AppKit).

## 2. A complete component

This assumes the app's existing `src/lib/wallet.ts` exports a wagmi `config` and, with Reown AppKit, the `modal`
returned by `createAppKit` from `@reown/appkit`. With AppKit's `WagmiAdapter`, the config is
`wagmiAdapter.wagmiConfig`.

```svelte
<!-- src/lib/components/FlipCard.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { FlipperWidget } from "@flipperdotfamily/svelte";
  import type { Eip1193Provider, FlipperEventMap, FlipperTheme } from "@flipperdotfamily/widget";
  import { watchFlipperProvider } from "$lib/flipper-wallet";
  import { config, modal } from "$lib/wallet";

  const theme: FlipperTheme = { mode: "auto", accent: "#7c5cff", radius: 16, fontFamily: "inherit" };

  let provider = $state.raw<Eip1193Provider | null>(null); // raw: never deep-proxy a provider
  let element = $state<HTMLElementTagNameMap["flipper-widget"]>();
  const seen = new Set<string>();

  // onMount only runs in the browser, so wallet code stays out of SSR; the returned function is the cleanup
  onMount(() => watchFlipperProvider(config, (p) => (provider = p)));

  function onFlipSettled(d: FlipperEventMap["flip-settled"]) {
    if (d.pending || seen.has(d.flipId)) return; // WinPending: a final flip-settled follows
    seen.add(d.flipId);
    // invalidate("app:balances"), a toast, analytics…
  }

  function onError(e: FlipperEventMap["error"]) {
    if (e.code !== "user-rejected") console.warn("flipper:", e.context, e.message);
  }
</script>

<FlipperWidget
  {provider}
  {theme}
  partner="acme"
  onConnectRequest={() => modal.open()}
  {onFlipSettled}
  {onError}
  bind:element
/>
```

- **Own connect UI:** replace `modal.open()` with whatever opens it.
- **Injected only:** set `provider = window.ethereum ?? null` inside `onMount`, and drop `onConnectRequest` (the
  widget calls `eth_requestAccounts`).
- **Refreshing SvelteKit data** after a flip: `import { invalidate } from "$app/navigation"`, then
  `invalidate("app:balances")`, with `depends("app:balances")` in the load function.

## 3. SvelteKit SSR

- The wrapper renders the `<flipper-widget>` tag, which upgrades in the browser. Keep every wallet call in
  `onMount` or `$effect`: neither runs on the server.
- If a route still fails during SSR (a wallet library touching `window` at import time), render the widget only in
  the browser:

```svelte
<script lang="ts">
  import { browser } from "$app/environment";
  import FlipCard from "$lib/components/FlipCard.svelte";
</script>

{#if browser}<FlipCard />{:else}<div style="min-height: 560px"></div>{/if}
```

  Or set `export const ssr = false;` in that route's `+page.ts`.
- Reserve space to avoid layout shift: `:global(flipper-widget:not(:defined)) { display: block; min-height: 560px; }`.

## 4. Theming, dark mode, config knobs

```svelte
<FlipperWidget {provider} theme={$isDark ? "dark" : "light"} accent="#ff5a1f" branding={false}
  brandName="Acme" brandLogo="/logo.svg" tagline="Double or nothing on Acme" />
```

- `theme="auto"` follows the OS, not the app's toggle.
- Hoist `strings` / `theme` / `tokens` / `addresses` objects into constants. An inline literal is a new object on
  every render; for `addresses`, that reloads the deployment.
- Local dev: `chainId={31337}` `deploymentUrl="http://localhost:3000/embed/deployment.json"`, behind
  `import.meta.env.VITE_FLIPPER_LOCAL`. Run the Vite dev server on a port other than 3000.

## 5. Gotchas

- **`$state` proxies plain objects.** If the provider is a plain object (not a class instance), `$state` wraps it in
  a Proxy. Always use `$state.raw` for `provider` / `walletClient`.
- **`bind:element`** is `undefined` until mounted. Call `element?.open()`.
- **Svelte 4** (`on:` directives, `export let`) can't use this wrapper. Use the raw element:
  `<flipper-widget bind:this={el} theme="dark" on:flip-settled={(e) => …} />`, plus `el.provider = …`.
- **Events don't bubble.** A handler on a parent element never sees them. Use the callback props.
