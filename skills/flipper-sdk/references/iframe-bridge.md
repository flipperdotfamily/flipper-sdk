# iframe embed and the bridge protocol

The hosted embed at `https://flipper.family/embed` is `<flipper-widget>` on a full-bleed page. It has no wallet of
its own. It borrows the host's wallet over a small postMessage bridge (protocol v1) and reports events back. Use it
in these cases:
- The page can't run third-party code in its own context: a strict CSP, an untrusted or sandboxed page, a CMS, or no
  bundler control.
- You want isolation: the widget's viem and lit never load into the host's JS realm.
- A native app hosts it in a WebView. The platform packages implement the bridge for you; see the mobile references.

On a normal web app you control, prefer the in-page component (vanilla.md / the wrappers): it themes more deeply,
with CSS variables, `::part()` and host fonts.

## 1. Web host helper: `mountFlipperIframe`

```sh
pnpm add @flipperdotfamily/widget   # the host helper is the @flipperdotfamily/widget/host entry
```

```ts
import { mountFlipperIframe } from "@flipperdotfamily/widget/host";
import type { FlipperEventMap } from "@flipperdotfamily/widget";

const embed = mountFlipperIframe({
  container: "#flipper",                        // element or selector
  provider: null,                               // the connected EIP-1193 provider; null = read-only for now
  params: { theme: "dark", accent: "7c5cff", radius: 16, partner: "acme" },
  onConnectRequest: () => openMyConnectModal(), // default: provider.request({ method: "eth_requestAccounts" })
  onEvent: (name, data) => {
    if (name === "flip-settled") {
      const d = data as FlipperEventMap["flip-settled"];
      if (!d.pending) console.log(d.flipId, d.outcome);
    }
  },
});

// when the user connects, switches account or disconnects:
embed.setProvider(connectedProvider ?? null);
// live config (no reload): sync dark mode, preselect a token…
embed.setConfig({ theme: "light", token: "0x…" });
// on teardown:
embed.destroy();
```

**Without a bundler** (CDN):

```html
<div id="flipper"></div>
<script src="https://cdn.jsdelivr.net/npm/@flipperdotfamily/widget@0/dist/cdn/flipper-host.js"></script>
<!-- or https://flipper.family/embed/flipper-host.js -->
<script>
  const embed = FlipperEmbedHost.mountFlipperIframe({
    container: "#flipper",
    provider: window.ethereum ?? null,
    params: { theme: "auto", partner: "acme" },
  });
</script>
```

**Options**

| Option | Default | Meaning |
|---|---|---|
| `container` | (required) | element or selector the iframe is appended to |
| `provider` | `null` | EIP-1193 provider. The helper answers the embed's RPCs with it and watches `accountsChanged` / `chainChanged` / `disconnect` |
| `embedUrl` | `https://flipper.family/embed` | local dev: `http://localhost:3000/embed` |
| `params` | | URL params (table below) |
| `config` | | full `FlipperEmbedConfig`, sent as the base64 `config` param |
| `onConnectRequest(data)` | `eth_requestAccounts` on the provider | open the app's connect UI, then call `setProvider` |
| `onEvent(name, data)` | | every event: `ready`, `connect-request`, `flip-requested`, `flip-settled`, `payout-resolved`, `listing`, `error`, `resize` |
| `autoHeight` | `true` | sets the iframe height from `resize` events (it starts at 560 px) |
| `title` | "flipper coin flip" | the iframe's accessible title |

The helper also takes care of the protocol details:
- It sets `hostOrigin` to `location.origin`.
- It accepts messages only from that iframe and the embed's origin.
- It refuses methods outside the allowlist (4200) and answers every RPC.
- It re-sends the wallet state after `ready` and on every provider event.

It returns `{ iframe, setProvider, setConfig, destroy }`.

**React** (mount once, then push the provider):

```tsx
import { useEffect, useRef } from "react";
import { mountFlipperIframe, type FlipperIframe } from "@flipperdotfamily/widget/host";
import type { Eip1193Provider } from "@flipperdotfamily/widget";

export function FlipEmbed({ provider, openConnect }: { provider: Eip1193Provider | null; openConnect: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const embed = useRef<FlipperIframe | null>(null);
  const open = useRef(openConnect);
  useEffect(() => { open.current = openConnect; });

  useEffect(() => {
    if (!box.current) return;
    const e = mountFlipperIframe({ container: box.current, params: { theme: "auto", partner: "acme" }, onConnectRequest: () => open.current() });
    embed.current = e;
    return () => { e.destroy(); embed.current = null; };
  }, []);

  useEffect(() => { embed.current?.setProvider(provider); }, [provider]);

  return <div ref={box} style={{ maxWidth: 460, margin: "0 auto" }} />;
}
```

With wagmi, get the provider from `connector.getProvider()` (see the `watchFlipperProvider` helper in vue.md /
svelte.md / angular.md). With Reown AppKit, it is `useAppKitProvider("eip155").walletProvider`.

## 2. URL params

`https://flipper.family/embed?chain=4663&theme=dark&accent=4cc2ff&partner=acme`. Every param is optional.

| Param | Values | Default |
|---|---|---|
| `chain` | `4663`, `31337`, `robinhood`, `local` | the site's deployment (Robinhood Chain) |
| `token` | token address | $FLIPPER |
| `tokens` | comma-separated addresses (one = no picker) | all |
| `mode` | `picker`, `single` (needs `token`; no picker at all) | `picker` |
| `hidePicker` | `1` / `true`: deprecated alias of `mode=single` | off |
| `fit` | `auto` (report height via `resize`), `fill` (fill a fixed-size frame) | `auto` |
| `size` | `sm`, `md`, `lg`, `auto` | `auto` |
| `details` | `1` / `true`: win chance / payout / fee line under the button | off |
| `tagline` | `1` / `true` (built-in headline) or your text | none |
| `theme` | `light`, `dark`, `auto` | `auto` |
| `accent` | hex, `#` optional (`4cc2ff`, `%23ff5a1f`) | flipper sky blue |
| `radius` | px, 0–40 | 24 |
| `branding` | `0` / `false` removes the flipper marks | on |
| `partner` | `[A-Za-z0-9._:-]{1,64}`; a registered code (1–32 of `a-z 0-9 _ -`) is also attributed onchain | none |
| `locale` | `en`, `es` | `en` |
| `compact` | `1` / `true` | off |
| `approval` | `max`, `exact` | `max` |
| `connect` | `event` (emit `connect-request`) or `request` (also send `eth_requestAccounts`) | `event` |
| `hostOrigin` | the parent's origin | none (posts to `*`) |
| `config` | base64url JSON `FlipperEmbedConfig` | none; wins over the individual params |

`FlipperEmbedConfig` accepts `chainId`, `token`, `tokens`, `mode`, `hidePicker` (deprecated), `variant` (`card` / `compact`), `fit`, `size`, `details`, `tagline`, `theme` (a
mode or a full theme object), `accent`, `radius`, `branding`, `brandName`, `brandLogo`, `coinImage`,
`coinImageTails` (`data:` URIs: the embed's CSP loads no other image hosts), `locale`, `strings`, `partner`,
`minAmount`, `maxAmount`, `approval`, `listing`, `eth`, `rpcUrl`, `apiUrl` and `addresses`. Build it with
`encodeConfigParam(cfg)` from `@flipperdotfamily/widget/host`, or pass `config` to `mountFlipperIframe`.

What a URL may set, since anyone can craft one:
- `rpcUrl`, `apiUrl` and `addresses` are **ignored in the URL**. A host sends them in a `config` message after
  `ready`; `mountFlipperIframe` and the platform packages do this for you.
- Opened directly (no iframe parent, no native bridge), the embed also ignores the URL's `strings`, `brandName`,
  `brandLogo`, `coinImage`, `coinImageTails` and custom `tagline` text, and takes only the theme mode and plain colour
  tokens.

## 3. The protocol, for custom hosts

Only needed when you can't use the helper (native WebViews, other languages). The full spec is BRIDGE.md in the
`@flipperdotfamily/widget` package.

- **Envelope.** Every message has `v: 1` and a `source`: `"flipper"` from the embed, `"flipper-host"` from the host.
  Ignore everything else.
- **Embed to host:**
  - `{ type: "rpc", id, method, params }`: wallet methods only.
  - `{ type: "event", name, data }`
- **Host to embed:**
  - `{ type: "rpc-result", id, result }` / `{ type: "rpc-error", id, error: { code, message } }`
  - `{ type: "wallet", accounts, chainId }`: `chainId` is a hex string; `accounts` is `[]` when disconnected.
  - `{ type: "config", …FlipperEmbedConfig }`
- **Methods the embed may send:**
  - `eth_accounts`, `eth_chainId`, `eth_requestAccounts`
  - `eth_sendTransaction` (fully specified: gas and EIP-1559 fees; forward it unchanged)
  - `wallet_switchEthereumChain`, `wallet_addEthereumChain`, `wallet_watchAsset`
  - optionally `wallet_getCapabilities`, `wallet_sendCalls`, `wallet_getCallsStatus` (EIP-5792; answer `4200` if
    unsupported, and the widget falls back to sequential transactions)
  - never `personal_sign` or `eth_signTypedData_v4`: the embed doesn't sign messages. Answer them with `4200` and
    never forward them to the wallet (a compromised embed could use them to ask for a Permit signature).
- **Lifecycle:**
  1. Load the embed.
  2. Wait for the `ready` event, then send `wallet`.
  3. Send `wallet` again on every connect, disconnect, account or chain change.
  4. Size the frame from `resize`.
  5. Answer **every** RPC exactly once. Use `4001` when the user closes the wallet prompt; otherwise the widget
     waits forever.
  6. A reload resets the embed: send `wallet` again after the new `ready`.
- **Error codes:** 4001 rejected, 4100 not connected, 4200 unsupported, 4900/4901 disconnected / wrong chain, 4902
  unknown chain (the embed then sends `wallet_addEthereumChain`), -32602 / -32603.
- **Security:**
  - Check `event.source === iframe.contentWindow` and `event.origin === "https://flipper.family"`.
  - Post to that origin, not `*`.
  - Pass `hostOrigin` so the embed pins the parent's origin.
  - Nothing secret ever crosses the bridge: no keys, sessions or tokens.
  - Send `rpcUrl` / `apiUrl` / `addresses` only in a `config` message after every `ready`, never in the URL.

**WebViews (React Native, Flutter, iOS, Android).**
- Inject `window.FlipperHost = { postMessage(json) { … } }` **before the content loads** (a document-start user
  script, a JS channel, or `addJavascriptInterface`).
- Deliver host messages with `window.FlipperBridge.receive(json)`.
- Native transports carry JSON **strings**, and iframes carry objects.
- Keep the WebView on `https://flipper.family/embed`, and open other links in the system browser.
- The platform packages already do all of this. Follow [react-native.md](react-native.md),
  [flutter.md](flutter.md), [ios.md](ios.md) or [android.md](android.md) rather than hand-rolling it.

## 4. CSP and sandboxing on the host page

- `frame-src https://flipper.family` (local dev: `http://localhost:3000`), plus `script-src` for the CDN host script
  if you use it.
- The embed sends `frame-ancestors *`, so any site may frame it. It loads scripts only from its own origin, connects
  only to flipper's own RPC and API, and loads images only from its own origin, `data:` and the API's logo proxy.
- `mountFlipperIframe` sandboxes the iframe with
  `allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox` (the minimum, so explorer links can
  open). Use the same if you add a `sandbox` attribute yourself.

## 5. Gotchas

- **The iframe doesn't resize.** A custom host must handle `resize` (`iframe.style.height = data.height + "px"`).
  The helper does it unless `autoHeight: false`. If no events arrive at all, check the origin checks: the
  `embedUrl` origin must match `event.origin`, and a hand-set `hostOrigin` must equal the parent's exact origin
  (scheme, host and port).
- **"Connect wallet" never goes away.** The host isn't sending `wallet` after `ready`, or it sends it before `ready`
  (the message is lost).
- **A transaction hangs.** An RPC was never answered. Always reply, including errors.
- **Theming is limited.** CSS variables and `::part()` don't cross the frame. Use the `config` theme object. The
  font is the embed's.
- **Local dev.** Use `embedUrl: "http://localhost:3000/embed"` with `params: { chain: "local" }`. The embed page
  serves the local deployment inline, so no `deploymentUrl` is needed.
