# Vanilla JS, CDN, and frameworks without a wrapper

Use `<flipper-widget>` directly in these cases:
- a plain HTML page;
- a site with its own bundler but no wrapper for its framework: Solid, Preact, Lit, Qwik, Astro, Alpine, jQuery,
  and older majors (Vue 2, Svelte 4, Angular < 17).

The element is a standard custom element. Importing `@flipperdotfamily/widget` registers it; on the server the import is a
no-op, so it is SSR-safe.

## 1. Load it

**CDN (no build step).** This single file bundles everything and registers the element:

```html
<script src="https://cdn.jsdelivr.net/npm/@flipperdotfamily/widget@0/dist/cdn/flipper-widget.js"></script>
<!-- same file from flipper.family: https://flipper.family/embed/flipper-widget.js -->
<!-- ES module build: https://cdn.jsdelivr.net/npm/@flipperdotfamily/widget@0/dist/cdn/flipper-widget.esm.js -->
```

- `@0` follows the latest 0.x. For production, pin an exact version (`@flipperdotfamily/widget@0.1.0`).
- The IIFE build also exposes a global `FlipperWidget` namespace, for example `FlipperWidget.PALETTES` and
  `FlipperWidget.defineFlipperWidget("acme-flip")`.
- It is about 113 KB gzipped (viem, lit and the SDK included).

**npm (with a bundler).** This ESM build shares the app's copies of viem and lit:

```sh
pnpm add @flipperdotfamily/widget     # or npm i / yarn add / bun add
```

```ts
import "@flipperdotfamily/widget";                                 // registers <flipper-widget>
import type { FlipperEventMap, Eip1193Provider } from "@flipperdotfamily/widget";
// custom tag name, without the auto-registration:
// import { FlipperWidget } from "@flipperdotfamily/widget/element";
// customElements.define("acme-flip", class extends FlipperWidget {});
```

Load it one way only: either the CDN script or the npm package, never both.

## 2. A complete page (injected wallet)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Flip</title>
  <script src="https://cdn.jsdelivr.net/npm/@flipperdotfamily/widget@0/dist/cdn/flipper-widget.js"></script>
  <style>
    body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; }
    flipper-widget { display: block; max-width: 460px; margin: 0 auto; }
    flipper-widget:not(:defined) { min-height: 560px; } /* reserve space until it upgrades */
  </style>
</head>
<body>
  <flipper-widget theme="auto" partner="acme" accent="#7c5cff"></flipper-widget>
  <script>
    const w = document.querySelector("flipper-widget");
    w.provider = window.ethereum ?? null;           // a property, never an attribute
    // No connect-request handler: pressing "Connect wallet" asks the provider for eth_requestAccounts.

    const done = new Set();
    w.addEventListener("flip-settled", (e) => {
      const d = e.detail;
      if (d.pending || done.has(d.flipId)) return;  // WinPending sends a second, final event
      done.add(d.flipId);
      console.log(d.outcome, d.payout, d.symbol);
    });
    w.addEventListener("error", (e) => {
      if (e.detail.code !== "user-rejected") console.warn("flipper:", e.detail.message);
    });
  </script>
</body>
</html>
```

Several injected wallets can compete for `window.ethereum`. To let the user pick one, use EIP-6963:

```js
const wallets = [];
window.addEventListener("eip6963:announceProvider", (e) => wallets.push(e.detail)); // { info: { name, icon, rdns, uuid }, provider }
window.dispatchEvent(new Event("eip6963:requestProvider"));
// after the user picks one: w.provider = chosen.provider;
```

## 3. Wallet wiring for other stacks

The rules are the same everywhere:
- Set `el.provider` (EIP-1193) or `el.walletClient` (a viem `WalletClient` with `account`), and `null` while
  disconnected.
- When the app has its own connect UI, call `e.preventDefault()` in `connect-request` and open that UI instead.
  Setting `el.onConnectRequest = fn` has the same effect.

### wagmi core (also Reown AppKit's Wagmi adapter)

This helper is also used by the Vue, Svelte and Angular references. Save it as `flipper-wallet.ts`:

```ts
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
    if (id === seq) onChange(p); // ignore stale results
  };
  void update();
  return watchAccount(config, { onChange: () => void update() });
}
```

- On wagmi 3, these actions are called `getConnection` and `watchConnection`.
- Add Robinhood Chain to the config's `chains` and `transports` (viem's `robinhood` chain, viem 2.55 or newer):

```ts
import { robinhood } from "viem/chains"; // 4663
```

Usage:

```ts
import "@flipperdotfamily/widget";
import { watchFlipperProvider } from "./flipper-wallet";
import { wagmiConfig, modal } from "./wallet"; // the app's existing config; `modal` if it uses Reown AppKit

const w = document.querySelector("flipper-widget")!;
const stop = watchFlipperProvider(wagmiConfig, (p) => (w.provider = p));
w.addEventListener("connect-request", (e) => {
  e.preventDefault();
  void modal.open(); // or whatever opens the app's connect UI
});
// on teardown: stop();
```

If the app uses Reown AppKit with `WagmiAdapter`, the config is `wagmiAdapter.wagmiConfig`, and `modal` is the value
`createAppKit()` returned. With AppKit's Ethers adapter instead, get the EIP-1193 provider from AppKit's provider
API for your installed version, and push it to `w.provider` whenever it changes.

### web3-onboard

```js
import Onboard from "@web3-onboard/core";
import injectedModule from "@web3-onboard/injected-wallets";

const onboard = Onboard({
  wallets: [injectedModule()],
  chains: [{ id: "0x1237", token: "ETH", label: "Robinhood Chain", rpcUrl: "https://rpc.mainnet.chain.robinhood.com" }],
});
onboard.state.select("wallets").subscribe((wallets) => (w.provider = wallets[0]?.provider ?? null));
w.addEventListener("connect-request", (e) => {
  e.preventDefault();
  void onboard.connectWallet();
});
```

Add the Robinhood Chain entry to the app's existing `Onboard({ chains })`. Don't create a second Onboard instance.

### ethers

ethers wraps an EIP-1193 object. Pass that object, not the ethers `BrowserProvider` / `Web3Provider` / `Signer`:

```ts
const eip1193 = window.ethereum;                 // whatever the app passes to `new BrowserProvider(...)`
const provider = new BrowserProvider(eip1193);   // the app's existing ethers code, unchanged
w.provider = eip1193;
```

### viem

```ts
const walletClient = createWalletClient({ account, chain: robinhood, transport: custom(window.ethereum) });
w.walletClient = walletClient; // must have `account`; recreate it when the account or chain changes
// or simply: w.provider = window.ethereum (the widget then follows accountsChanged / chainChanged itself)
```

## 4. Options: attributes vs properties

Strings and booleans work as attributes. Objects must be set as properties:

```html
<flipper-widget
  chain-id="robinhood"
  theme="dark"
  accent="#ff5a1f" radius="16"
  partner="acme"
  variant="compact"
  tokens="ETH,0xYourToken"
  min-amount="10" max-amount="1000"
  approval="exact"
  branding="false" brand-name="Acme" brand-logo="https://acme.example/logo.svg"
  locale="es"
  tagline="Double or nothing on Acme"
></flipper-widget>
<script>
  const w = document.querySelector("flipper-widget");
  w.theme = { mode: "dark", accent: "#ff5a1f", fontFamily: "inherit", radius: 12 };
  // w.addresses = { house: "0x…", lens: "0x…" };   // pinning: only if the user asks for it
</script>
```

- `chain-id` accepts `robinhood` (the default), `local` or a number. `variant` is `card`, `compact` or `button`.
- `mode="single"` fixes the token (set `token`, an address or `ETH`; without it the widget shows a configuration
  error) and removes the picker. `mode="picker"` (the default) lets the user choose, and `tokens` (a comma list of
  addresses and/or `ETH`) narrows the list. `hide-picker` is a deprecated alias for single. Booleans that default to
  on (`branding`, `eth`, `listing`) turn off with `="false"`.
- `fit="fill"` makes the widget take the element's height too (give it one): fixed-size cards, sidebars,
  full-bleed panels. `size="sm" | "md" | "lg"` scales it.
- Clean by default (no headline, no odds/fee line). `details` (bare attribute) adds the win chance / payout / fee
  line; `tagline` (bare = the built-in headline, or `tagline="Your text"`) adds a headline under the coin.
- Attribute values for `theme` and `addresses` may be JSON, but prefer properties.
- `provider`, `walletClient`, `strings` and `onConnectRequest` have **no** attribute form.
- Methods: `w.open()` / `w.close()` (the button variant), `w.refresh()` (re-reads balances), and `w.client` (the
  underlying `@flipperdotfamily/sdk` client).

## 5. Frameworks without a wrapper

**Solid.** Use `prop:`, `attr:` and `on:`. Declare the element for TSX:

```tsx
import "@flipperdotfamily/widget";
import type { Eip1193Provider, FlipperEventMap } from "@flipperdotfamily/widget";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements { "flipper-widget": JSX.HTMLAttributes<HTMLElement> }
    interface ExplicitProperties { provider: Eip1193Provider | null }
    interface ExplicitAttributes { theme: string; partner: string }
    interface CustomEvents {
      "connect-request": CustomEvent<FlipperEventMap["connect-request"]>;
      "flip-settled": CustomEvent<FlipperEventMap["flip-settled"]>;
    }
  }
}

export function Flip(props: { provider: Eip1193Provider | null; openConnect: () => void }) {
  return (
    <flipper-widget
      prop:provider={props.provider}
      attr:theme="dark"
      attr:partner="acme"
      on:connect-request={(e) => { e.preventDefault(); props.openConnect(); }}
      on:flip-settled={(e) => console.log(e.detail.outcome)}
    />
  );
}
```

**Preact.** Import `@flipperdotfamily/widget` before the first render. Preact then sets `provider` as a property, because
the upgraded element has one:

```tsx
import "@flipperdotfamily/widget";
<flipper-widget provider={provider} theme="dark" partner="acme"
  onconnect-request={(e: Event) => { e.preventDefault(); openConnect(); }}
  onflip-settled={(e: CustomEvent) => console.log(e.detail.outcome)} />
```

For TSX, declare `"flipper-widget"` in the `preact` module's `JSX.IntrinsicElements`.

**Lit.**

```ts
import "@flipperdotfamily/widget";
html`<flipper-widget .provider=${this.provider} theme="dark" partner="acme"
  @connect-request=${(e: Event) => { e.preventDefault(); this.openConnect(); }}
  @flip-settled=${this.onSettled}></flipper-widget>`;
```

**Qwik.** Render the tag, then wire it up on the client:

```tsx
import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import type { Eip1193Provider } from "@flipperdotfamily/widget";

export const Flip = component$(() => {
  const host = useSignal<HTMLElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup }) => {
    await import("@flipperdotfamily/widget");
    const w = host.value as HTMLElementTagNameMap["flipper-widget"];
    w.provider = (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
    const onSettled = (e: Event) => console.log((e as CustomEvent).detail.outcome);
    w.addEventListener("flip-settled", onSettled);
    cleanup(() => w.removeEventListener("flip-settled", onSettled));
  });
  return <flipper-widget ref={host} theme="dark" partner="acme" />;
});
```

If TypeScript rejects the tag, declare `"flipper-widget"` in Qwik's JSX intrinsic elements.

**Astro.** `<script>` tags are bundled and run in the browser:

```astro
<flipper-widget id="flip" theme="auto" partner="acme"></flipper-widget>
<script>
  import "@flipperdotfamily/widget";
  import type { Eip1193Provider } from "@flipperdotfamily/widget";
  const w = document.querySelector("flipper-widget")!;
  w.provider = (window as unknown as { ethereum?: Eip1193Provider }).ethereum ?? null;
  w.addEventListener("flip-settled", (e) => console.log(e.detail.outcome));
</script>
```

For a React, Vue or Svelte island, use that framework's wrapper with `client:only` or `client:load`.

**Alpine / jQuery.**

```html
<flipper-widget x-data x-init="$el.provider = window.ethereum ?? null" @flip-settled="console.log($event.detail)"></flipper-widget>
```

```js
$("flipper-widget").each(function () { this.provider = window.ethereum ?? null; })
  .on("flip-settled", (e) => console.log(e.originalEvent.detail));
```

**Vue 2, Svelte 4, Angular < 17.** Treat it as a custom element:
- Vue 2: `Vue.config.ignoredElements = ["flipper-widget"]`, and set `provider` on the element through a `ref`.
- Svelte 4: `<flipper-widget bind:this={el} theme="dark" on:flip-settled={…} />`, plus `el.provider = …`.
- Angular < 17: add `CUSTOM_ELEMENTS_SCHEMA`, and use `[provider]` / `(flip-settled)="…($event.detail)"`.

## 6. TypeScript

`import "@flipperdotfamily/widget"` adds `"flipper-widget"` to `HTMLElementTagNameMap`, so
`document.querySelector("flipper-widget")` is typed. `HTMLElementEventMap` types `connect-request`,
`flip-requested`, `flip-settled`, `payout-resolved` and `listing`. The other three names collide with DOM events, so
cast them:

```ts
w.addEventListener("error", (e: Event) => {   // annotate as Event: TS types "error" as ErrorEvent
  const d = (e as CustomEvent<FlipperEventMap["error"]>).detail;
});
```

## 7. CSP

If the page has a Content-Security-Policy, allow the following:
- `script-src`: `https://cdn.jsdelivr.net` (or `https://flipper.family`) for the CDN build. The npm build needs
  nothing extra.
- `connect-src`:
  - `https://flipper.family` for the deployment manifest;
  - the chain RPC (`https://rpc.mainnet.chain.robinhood.com`) or the manifest's `rpcUrl`;
  - `https://api.flipper.family` (the token list);
  - the wallet's own endpoints.
- `img-src`: `https://api.flipper.family` (token logos), `data:`, and the hosts of `brandLogo` / `coinImage`.
- Styles: Lit uses constructable stylesheets, which CSP doesn't block. Very old browsers fall back to `<style>`
  tags; for those, set `window.litNonce` to the page's style nonce before the widget loads.

## 8. Gotchas

- Events don't bubble: attach listeners to the element itself, not to `document`.
- Setting `provider` to the same object again is a no-op, and replacing it rewires the listeners. The widget listens
  to `accountsChanged`, `chainChanged` and `disconnect` on providers. A `walletClient` must be replaced when the
  account or chain changes.
- `theme="auto"` follows `prefers-color-scheme`, not a `.dark` class on `<html>`. With a manual toggle, set
  `w.theme = "dark"` / `"light"` from it.
- If the element never upgrades (it stays an empty `<flipper-widget>`), the script didn't load: check the CSP, the
  network tab, and that the tag is spelled correctly.
