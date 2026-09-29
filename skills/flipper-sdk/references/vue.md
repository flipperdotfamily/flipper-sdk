# Vue 3 and Nuxt: `@flipperdotfamily/vue`

```sh
pnpm add @flipperdotfamily/vue        # or npm i / yarn add / bun add
# types (strict pnpm): pnpm add @flipperdotfamily/widget@<the version @flipperdotfamily/vue uses>
```

## API

- `<FlipperWidget … />`
  - **Props:** every widget option: `provider`, `walletClient`, `chainId`, `theme`, `accent`, `radius`, `partner`,
    `token`, `tokens`, `branding`, `brandName`, `strings`, `addresses`, `deploymentUrl`… (see
    [vanilla.md](vanilla.md) §4 or the widget README). Use camelCase or kebab-case, as usual in Vue templates.
  - **Emits:** `ready`, `connect-request`, `flip-requested`, `flip-settled`, `payout-resolved`, `listing`, `error`,
    `resize`. The payload is the event **detail**.
  - **Template ref:** exposes `el` (the `<flipper-widget>` element), `open()`, `close()` and `refresh()`.
- `app.use(FlipperPlugin, { partner, theme, … })`: registers `<FlipperWidget>` globally, with defaults.
- `useFlipperClient(options)`: a composable around the headless client ([headless-sdk.md](headless-sdk.md)).
  `options` is an object, a ref or a getter (`() => ({ walletClient: wc.value })`). It returns shallow refs
  `{ client, deployment, chain, loading, error }`, rebuilt whenever the options change.

## 1. Wallet helper (wagmi core; also Reown AppKit's Wagmi adapter)

`@wagmi/vue` and AppKit's `WagmiAdapter` both build a `@wagmi/core` `Config`. Under strict pnpm, add `@wagmi/core`
directly, at the version already in the lockfile.

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
- Add Robinhood Chain to the config's `chains` / AppKit `networks`, using the chain from
  [react.md](react.md) §1. The same objects work in Vue.

## 2. A complete component (Reown AppKit + Wagmi adapter)

```ts
// src/lib/wallet.ts: the app's existing setup; shown for context
import { createAppKit } from "@reown/appkit/vue";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
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

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID;
export const wagmiAdapter = new WagmiAdapter({ networks: [robinhoodChain], projectId });
export const modal = createAppKit({
  adapters: [wagmiAdapter],
  networks: [robinhoodChain],
  projectId,
  metadata: { name: "Acme", description: "Acme", url: "https://acme.example", icons: [] },
});
```

```vue
<!-- src/components/FlipCard.vue -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { FlipperWidget } from "@flipperdotfamily/vue";
import type { Eip1193Provider, FlipperEventMap } from "@flipperdotfamily/widget";
import { watchFlipperProvider } from "@/lib/flipper-wallet";
import { modal, wagmiAdapter } from "@/lib/wallet";

const provider = shallowRef<Eip1193Provider | null>(null); // shallowRef: never deep-proxy a provider
const flipper = ref<InstanceType<typeof FlipperWidget> | null>(null);
const seen = new Set<string>();
let stop: (() => void) | undefined;

onMounted(() => {
  stop = watchFlipperProvider(wagmiAdapter.wagmiConfig, (p) => (provider.value = p));
});
onBeforeUnmount(() => stop?.());

function onSettled(d: FlipperEventMap["flip-settled"]) {
  if (d.pending || seen.has(d.flipId)) return; // WinPending: a final flip-settled follows
  seen.add(d.flipId);
  // refetch the app's balances, show a toast, track analytics…
}

function onError(e: FlipperEventMap["error"]) {
  if (e.code !== "user-rejected") console.warn("flipper:", e.context, e.message);
}
</script>

<template>
  <FlipperWidget
    ref="flipper"
    :provider="provider"
    theme="auto"
    accent="#7c5cff"
    :radius="16"
    partner="acme"
    @connect-request="modal.open()"
    @flip-settled="onSettled"
    @error="onError"
  />
</template>
```

- With `@wagmi/vue` and the app's own connect UI, pass the app's wagmi config to `watchFlipperProvider`, and open
  that UI from `@connect-request`.
- For an AppKit modal inside components, `useAppKit()` from `@reown/appkit/vue` returns `open`.
- Injected only: `:provider="injected"` with `const injected = shallowRef(window.ethereum ?? null)`, and no
  `@connect-request` handler (the widget calls `eth_requestAccounts`). Under SSR, read `window` in `onMounted`.

## 3. Global plugin and defaults

```ts
// src/main.ts
import { createApp } from "vue";
import { FlipperPlugin } from "@flipperdotfamily/vue";
import App from "./App.vue";

createApp(App).use(FlipperPlugin, { partner: "acme", theme: "auto", accent: "#7c5cff" }).mount("#app");
```

## 4. Refs, theme objects, variants

```ts
flipper.value?.open();    // variant="button"
flipper.value?.refresh(); // after the app moved funds
```

```ts
import type { FlipperTheme } from "@flipperdotfamily/widget";
// a module-scope constant: not reactive(), which would hand the widget a Proxy
const theme: FlipperTheme = { mode: "dark", accent: "#ff5a1f", fontFamily: "inherit", radius: 12 };
```

To follow the app's dark mode (VueUse `useDark()`, or a Pinia store), use
`:theme="isDark ? 'dark' : 'light'"`. `"auto"` only follows the OS.

## 5. Nuxt 3

- Wallet libraries are client-only. Create the AppKit / wagmi setup in a `plugins/wallet.client.ts` plugin (or
  import it only from client code).
- The wrapper renders `<flipper-widget>`, which upgrades in the browser. If a page throws during SSR because wallet
  code runs on the server, wrap the widget in `<ClientOnly>`:

```vue
<ClientOnly>
  <FlipCard />
  <template #fallback><div style="min-height: 560px" /></template>
</ClientOnly>
```

- Env: `runtimeConfig.public.flipperPartner`, plus `flipperLocal` for `:chain-id="31337"` +
  `deployment-url="http://localhost:3000/embed/deployment.json"`. Run Nuxt on a port other than 3000 when you use
  flipper's local stack.

## 6. Gotchas

- **Deep proxies.** `ref(provider)` / `reactive({ provider })` wrap the provider in a Proxy, and providers with
  private class fields then throw ("Cannot read private member…"). Use `shallowRef` or `markRaw`, for
  `walletClient` too.
- **The raw element in templates.** If you use `<flipper-widget>` directly instead of the wrapper, tell the compiler
  it's a custom element. In Vite: `vue({ template: { compilerOptions: { isCustomElement: (t) => t === "flipper-widget" } } })`.
  In Nuxt: `vue.compilerOptions.isCustomElement`.
- **`@error`** on `<FlipperWidget>` is the widget's error event (the payload is the detail), not a native DOM
  error.
- **Objects in templates.** `:tokens="['0x…']"` creates a new array on each render. Hoist it to a constant.
