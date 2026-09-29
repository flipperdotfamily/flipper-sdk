# @flipperdotfamily/svelte

Svelte 5 component for [flipper.family](https://flipper.family) coin flips, wrapping the
[`<flipper-widget>`](../widget) web component with typed props and callback props. It works with SvelteKit (it
renders the tag on the server and upgrades in the browser).

```sh
npm i @flipperdotfamily/svelte
```

```svelte
<script lang="ts">
  import { FlipperWidget } from "@flipperdotfamily/svelte";
  let { walletClient } = $props(); // from @wagmi/core's getConnectorClient, or pass any EIP-1193 `provider`
  let widget = $state<import("@flipperdotfamily/svelte").FlipperWidgetElement>();
</script>

<FlipperWidget
  {walletClient}
  theme={{ mode: "dark", accent: "#ff3e00" }}
  partner="acme"
  onConnectRequest={() => openYourWalletModal()}
  onFlipSettled={(d) => console.log(d.outcome)}
  bind:element={widget}
/>
```

- **Props**: every widget option (see the [widget README](../widget#configuration)), plus `class`, `style` and
  `bind:element`.
- **Callbacks** receive the `detail`: `onReady`, `onConnectRequest`, `onFlipRequested`, `onFlipSettled`,
  `onPayoutResolved`, `onListing`, `onError`, `onResize`. Setting `onConnectRequest` means you open your own wallet UI.
- The package ships its `.svelte` source, and your bundler compiles it (Svelte 5 required).

Docs: [flipper.family/docs/integrate](https://flipper.family/docs/integrate) · Example: [`examples/svelte-vite`](../examples/svelte-vite)
