# @flipperdotfamily/vue

Vue 3 bindings for [flipper.family](https://flipper.family) coin flips: a typed `<FlipperWidget>` component (wrapping
the [`<flipper-widget>`](../widget) web component), a plugin for app-wide defaults, and a headless
`useFlipperClient` composable. Works with Vite, Nuxt (client-only) and Quasar.

```sh
npm i @flipperdotfamily/vue
```

```vue
<script setup lang="ts">
import { FlipperWidget } from "@flipperdotfamily/vue";
import { useConnectorClient } from "@wagmi/vue";
const { data: walletClient } = useConnectorClient(); // or any EIP-1193 provider via :provider
const openConnect = () => { /* open your wallet modal (Reown AppKit, wagmi…) */ };
</script>

<template>
  <FlipperWidget
    :wallet-client="walletClient ?? null"
    theme="dark"
    accent="#42b883"
    partner="acme"
    @connect-request="openConnect"
    @flip-settled="(d) => console.log(d.outcome)"
  />
</template>
```

- **Props**: every widget option (see the [widget README](../widget#configuration)). Objects (theme, strings,
  addresses) and booleans go through `v-bind`: `:branding="false"`, `:hide-picker="true"`.
- **Events** carry the `detail`: `ready`, `connect-request`, `flip-requested`, `flip-settled`, `payout-resolved`,
  `listing`, `error`, `resize`. Listening to `@connect-request` means you open your own wallet UI: the widget then skips its
  `eth_requestAccounts` fallback.
- **Template ref**: `el` (the element), `open()`, `close()`, `refresh()`.

App-wide defaults, and a global component:

```ts
app.use(FlipperPlugin, { partner: "acme", theme: { mode: "auto", accent: "#42b883" } });
```

Headless: `const { client, deployment, loading, error } = useFlipperClient(() => ({ provider: provider.value }))`.
The results are refs, rebuilt when the options change.

Nuxt: render it client-only (`<ClientOnly>`), or register the plugin in a `.client.ts` plugin file.

Docs: [flipper.family/docs/integrate](https://flipper.family/docs/integrate) · Example: [`examples/vue-vite`](../examples/vue-vite)
