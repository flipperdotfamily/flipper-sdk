# Troubleshooting

Start with the widget's own diagnostics:
1. Log the `error` event: `context: "config"` means the deployment, RPC or API didn't load, and `message` says
   why.
2. Check the browser console for CSP violations.
3. Check the network tab for `deployment.json`, the RPC POSTs and `api.flipper.family`.

## SSR: "window is not defined" / "document is not defined"

- `import "@flipperdotfamily/widget"` and the wrappers are SSR-safe: registration is a no-op on the server. The error comes
  from **wallet code**:
  - a wagmi / AppKit / Privy config built at module scope in a server-rendered file;
  - `window.ethereum` read during render;
  - a CDN `<script>` handled by a server template.
- Next.js: keep the wallet setup and the widget in `"use client"` files, and read `window` in `useEffect`.
  Optional: `next/dynamic(…, { ssr: false })`, called from a client component (a Server Component can't use it).
- Nuxt: `<ClientOnly>` / `*.client.ts` plugins. SvelteKit: `onMount` or `{#if browser}`, or `ssr = false` for the
  route. Angular: `isPlatformBrowser` / `afterNextRender`.

## Objects set as attributes

Symptoms: the widget ignores the wallet, or you see `provider="[object Object]"` / `theme="[object Object]"` in the
DOM.
- `provider`, `walletClient`, `strings` and `onConnectRequest` have no attribute form. They must be set as
  **properties** (`el.provider = p`). `theme` / `addresses` accept JSON strings, but properties are better.
- React 18 sets attributes on custom elements, so use `@flipperdotfamily/react` (or set the properties from a `ref` in
  `useEffect`).
- Vue without the wrapper: register the tag with `isCustomElement` so `:provider` binds as a property.
- Lit: use `.provider=${p}` (the leading dot). Solid: use `prop:provider`.

## Stuck on "Loading…"

The widget shows "Loading…" until the house state is read from the chain RPC. Common causes:
- **The RPC is unreachable, or blocked by CSP / CORS / an ad-blocker / a corporate proxy.** Allow it in
  `connect-src` (`https://rpc.mainnet.chain.robinhood.com`, or the manifest's `rpcUrl`). After the RPC timeout, the
  button switches to "Can't reach Robinhood Chain" and retries when clicked.
- **Rate limits.** Public RPCs are rate-limited. Set `rpcUrl` to a dedicated endpoint for busy pages.
- **Local dev:** anvil isn't running, or `rpcUrl` points at `127.0.0.1:8545` from a device or emulator that can't
  reach it.

## "Not live on this network yet"

The deployment couldn't be resolved. The `error` event (`context: "config"`) has the exact message.
- **The manifest is unreachable.** `https://flipper.family/embed/deployment.json` (or your `deploymentUrl`) is
  blocked by CSP `connect-src`, the site is offline, or a local `deploymentUrl` points at a server that isn't running.
- **The chain isn't in the manifest.** For example a chain id the manifest doesn't list, a typo in the chain id, or
  `chain-id="local"` without the local `deploymentUrl`. Check the live chains with
  `curl -s https://flipper.family/embed/deployment.json` and look at `.deployments`. If a chain isn't listed, the
  user needs a deployment URL or pinned `addresses` for it.
- **Pinned addresses are incomplete.** Pinning needs `house` and `lens`, plus `rpcUrl` for a chain with no built-in
  public RPC.
- **Pre-launch.** If flipper isn't deployed on the chain yet, this message is correct.

## Wrong chain / the switch is refused

- The widget sends `wallet_switchEthereumChain`. On error 4902 (and on the -32603 "unrecognized chain" some wallets
  use), it sends `wallet_addEthereumChain` with the chain's name, RPC and explorer, then switches.
- If a wallet (often a WalletConnect mobile wallet) doesn't support adding chains, the user adds the network by hand:
  chain id 4663 (`0x1237`), RPC `https://rpc.mainnet.chain.robinhood.com`, symbol ETH, explorer
  `https://robinhoodchain.blockscout.com`.
- **wagmi apps:** add Robinhood Chain (viem's `robinhood`) to the config's `chains` + `transports`. Otherwise wagmi
  won't follow the wallet onto 4663: `useWalletClient()` goes `undefined` after the switch, and the widget shows "Connect wallet"
  again.
- **A hand-made viem `WalletClient`** keeps its original `chain`. After a switch, viem refuses to send ("current chain
  … does not match the target chain"). Recreate the client on `chainChanged`, or pass the EIP-1193 `provider`
  instead.
- **Bridge hosts:** after a successful switch, send a new `wallet` message with the new `chainId`.

## wagmi `walletClient` is `undefined`

- That's normal until the user connects, and briefly on page load while wagmi reconnects. The widget is read-only
  meanwhile.
- If it stays undefined while connected: the current chain is missing from the wagmi config (see above), or the
  component is outside `WagmiProvider`, or there are two wagmi configs / providers.
- Don't cache the client in state. Pass `useWalletClient().data` straight through.

## "Connect wallet" opens the wrong thing, or nothing

- If the app has a connect modal, handle `connect-request` (the wrapper's `onConnectRequest`, `@connect-request`,
  `(connectRequest)`) and open it.
- On the raw element, call `e.preventDefault()` too, or set `el.onConnectRequest`. Otherwise the widget also calls
  `eth_requestAccounts` on the provider.
- Pass `null` as the provider while disconnected. Don't pass `window.ethereum` to an app that connects through
  WalletConnect or an embedded wallet.
- RainbowKit's `openConnectModal` is `undefined` while connected, so call `openConnectModal?.()`.

## CSP blocks something

| Blocked | Add |
|---|---|
| The CDN script | `script-src https://cdn.jsdelivr.net` (or `https://flipper.family`), or install from npm |
| The manifest | `connect-src https://flipper.family` |
| The RPC | `connect-src https://rpc.mainnet.chain.robinhood.com` (or your `rpcUrl`) |
| The token list / logos | `connect-src https://api.flipper.family`, `img-src https://api.flipper.family data:` |
| Brand / coin images | `img-src <their host>` |
| The iframe embed | `frame-src https://flipper.family` |
| Inline styles on very old browsers | set `window.litNonce` to the page's style nonce |

## Angular: handlers run twice

The component's outputs (`flipSettled`, `connectRequest`, `flipperError`, …) and the DOM events (`flip-settled`,
`connect-request`, `error`, …) are separate. Binding both on the same tag runs the handler twice, once with the
detail and once with the `CustomEvent`. Keep the outputs. Don't add `CUSTOM_ELEMENTS_SCHEMA`.

## `flip-settled` counted twice

This is expected for `WinPending` flips: first `pending: true` (the stake is back, the winnings are still owed and
the widget offers Retry payout), then the final event with the same `flipId` once they're paid, alongside a single
`payout-resolved`. De-duplicate by `flipId` and act on `pending: false`. In React StrictMode dev, make sure the handler
isn't also attached manually with `addEventListener`.

## iframe not resizing / no events

- **No `resize` handling.** The helper sizes the iframe unless `autoHeight: false`; a custom host must set
  `iframe.style.height` itself.
- **Origin checks.** Messages must come from `iframe.contentWindow` with `event.origin` equal to the embed's
  origin. A hand-set `hostOrigin` must exactly match the parent's origin, or the embed drops the host's messages.
  Local dev changes both origins.
- **Sandbox.** A `sandbox` attribute without `allow-same-origin allow-scripts` breaks the bridge.
- **CSS.** Nothing that styles the parent page reaches inside the frame.

## WebView bridge not receiving

- `window.FlipperHost` must exist **before the content loads**: a document-start user script (iOS), a JS channel
  (Flutter), `addJavascriptInterface` (Android), or `injectedJavaScriptBeforeContentLoaded` (React Native).
- Send `wallet` **after** `ready`, and again after every reload.
- Native transports carry JSON **strings**. Deliver them with `window.FlipperBridge.receive(json)`, as a string
  literal or an object.
- Every RPC must be answered, with `4001` on cancel. A missing answer leaves the widget waiting.
- Android React Native WebViews dispatch `message` on `document`. The embed listens there too.

## Approvals

- `approval="max"` (the default) approves the maximum once, so later flips of that token skip the approval
  prompt. `approval="exact"` approves each flip's amount.
- Tokens that reject max approvals fall back to exact automatically.
- MetaMask lets users edit the spend cap. If they approve less than the stake, the flip stops with a plain-English
  message asking them to allow at least the amount.
- Only one approval prompt per token is expected, the first time. Repeated prompts with `"max"` mean the allowance
  was reset or lowered.

## ETH vs WETH

- Native ETH is wrapped into WETH and the house flips WETH. **Winnings arrive as WETH.** The widget then shows
  "You have N WETH" with an "Unwrap to ETH" button. The headless equivalent is `client.unwrapWeth(amount)`.
- With EIP-5792 wallets, wrap + approve + flip is a single confirmation; other wallets see two or three prompts.
- `eth={false}` hides the ETH option.
- If WETH isn't listed on a deployment, ETH flips fail with `WethNotListed`. Anyone can list it.
- The randomness fee is always paid in native ETH, with the flip transaction: Dice Protocol's DiceEntropy charges a
  flat 0.000025 ETH per flip (about $0.07). With gas, a flip costs about $0.10 for $FLIPPER and about $0.12 for
  other tokens. A wallet with tokens but no ETH sees "Need ETH for the randomness fee".

## Token API rate limits

- Public reads from `api.flipper.family` are limited per end-user IP: 20/s, burst 120 (logos are exempt).
- In a custom picker, debounce search (about 250 ms) and abort stale requests (the `signal` option).
- On errors, keep the last results. The widget's own picker already debounces its searches.

## Multiple React (or Lit / viem) copies

- **"Invalid hook call"** or a null context from `@flipperdotfamily/react` means two Reacts. Check `pnpm why react` /
  `npm ls react`, then align the versions, dedupe (`pnpm dedupe`; Vite `resolve.dedupe: ["react", "react-dom"]`),
  and don't `npm link` a package that brings its own React.
- **"Multiple versions of Lit loaded"** (a dev warning): the CDN build and the npm package are both on the page,
  or two `@flipperdotfamily/widget` versions are installed. Load one, and align the versions.
- **TypeScript rejects `walletClient`**: two viem copies. Align the versions and dedupe.

## "Flips are paused" / "Settling after pause"

- The drawdown circuit breaker locked the protocol (the bankroll fell below half its high); only its unlocker reopens
  it. Nothing is wrong with the integration: the widget shows the paused state by itself, and `client.locked()` says so.
- A flip whose coin landed while locked settles after the unlock. The widget offers **Settle now** once it can go
  through; anyone can settle it (`settleDeferred(flipId)`).

## Coin keeps spinning ("Still drawing…")

- Randomness is late. The flip is safe and settles when the randomness arrives, or is refunded if it never does.
- **Local fork:** the keeper must be running (`./dev.sh` without `--no-keeper`), because it fulfils randomness on
  the fork.

## Layout

- **The widget is too wide or too narrow.** It fills its container's width up to 1120 px (`theme.maxWidth`; `"none"`
  fills), and switches to a side-by-side layout from 640 px. For a narrower card, give the parent a width.
- **`fit="fill"` collapses or looks cut off.** Fill takes the element's height: give it one (`height: 100%` of a sized
  parent, or a fixed height). Without one, it falls back to a 300 px minimum.
- **"No token configured".** `mode="single"` needs `token` (an address or `ETH`). Set it, or use `mode="picker"`.
- **Layout shift on SSR pages:** `flipper-widget:not(:defined) { display: block; min-height: 560px; }`.
- **The widget is cramped at 320 px:** check for parent padding. The widget itself works down to about 240 px.
- **Wrong colours in dark mode:** `theme="auto"` follows the OS, not the app's toggle. Pass the mode explicitly.
