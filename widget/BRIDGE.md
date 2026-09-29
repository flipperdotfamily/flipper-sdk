# flipper embed bridge, protocol v1

The hosted embed (`https://flipper.family/embed`) is the `<flipper-widget>` web component on a full-bleed page. It
has no wallet of its own. Wherever it runs (an `<iframe>` on a web page, a React Native / Flutter / iOS / Android
WebView), it borrows the host's wallet over this bridge, and reports what happens (flips, listings, errors, its
height) back to the host.

This document is the contract between the embed page and every host SDK. The widget side lives in
`packages/widget/src/embed/` (served at `/embed`), the web host side in `packages/widget/src/host/`
(`@flipperdotfamily/widget/host`). Mobile packages implement the host side natively.

- [1. Loading the embed](#1-loading-the-embed)
- [2. Transport](#2-transport)
- [3. Messages](#3-messages)
- [4. Lifecycle](#4-lifecycle)
- [5. Events](#5-events)
- [6. Security](#6-security)
- [7. Reference host (pseudo-code)](#7-reference-host-pseudo-code)

## 1. Loading the embed

```
https://flipper.family/embed?chain=4663&theme=dark&accent=4cc2ff&partner=acme
```

Every parameter is optional.

| Param | Values | Default | Meaning |
|---|---|---|---|
| `chain` | chain id (`4663`, `31337`) or `robinhood`, `local` | the site's deployment | Chain to flip on. The embed only knows chains flipper is deployed on; anything else shows "not live on this chain". |
| `token` | token address | $FLIPPER | Token selected at start. |
| `tokens` | comma-separated addresses | every token | Allowlist: the picker only offers these. One address means no picker. |
| `mode` | `picker`, `single` | `picker` | `picker`: the user chooses the token (`tokens` narrows the list). `single`: one fixed token, and `token` is required (without it the widget shows a configuration error). The picker isn't rendered at all. |
| `hidePicker` (or `hide-picker`) | `1` / `true` | off | **Deprecated**, use `mode=single`. Same effect; without `token` it falls back to $FLIPPER. |
| `theme` | `light`, `dark`, `auto` | `auto` | Colour mode. `auto` follows `prefers-color-scheme`. |
| `accent` | hex colour, `#` optional (`4cc2ff`, `%23ff5a1f`) | flipper sky blue | Accent (CTA, focus, links). Text on the accent is picked for contrast. |
| `radius` | px, `0`–`40` | `24` | Card corner radius; inner controls scale from it. |
| `branding` | `0` / `false` | on | Removes flipper.family marks (footer link, dolphin coin faces). |
| `partner` | `[A-Za-z0-9._:-]{1,64}` | none | Attribution id: echoed in every event and sent as the `X-Flipper-Partner` header on flipper API calls (unauthenticated: anyone can send any value, so treat it as a hint, never as proof). A registered partner code (1–32 of `a-z 0-9 _ -`) is also attributed onchain: the embed appends its ERC-8021 suffix to every flip, so the partner earns its share and its players get its odds. |
| `locale` | BCP 47 tag (`en`, `es`) | `en` | Built-in strings. Unknown locales fall back to English. |
| `compact` | `1` / `true` | off | Compact layout: small inline coin, denser spacing. |
| `fit` | `auto`, `fill` | `auto` | `auto`: the embed reports its height (`resize` events) and the host sizes the frame to it. `fill`: the widget fills a frame of fixed size (any width and height, from about 240×360), and the host ignores `resize`. |
| `size` | `sm`, `md`, `lg`, `auto` | `auto` | A scale on top of the fluid layout (0.88×, 1×, 1.14×). |
| `details` | `1` / `true` | off | Shows the win chance, payout and randomness fee under the button. Off, only an odds deviation shows, and only when fees trim the odds below the usual. |
| `tagline` | `1` / `true`, or text (URL-encoded, ≤ 120 chars) | none | A headline under the coin while idle. `true`: the built-in one ("Double or nothing" and its payout line); text: your own line. |
| `approval` | `max`, `exact` | `max` | Allowance to request when it's short (`max`: later flips of the token skip the approval). |
| `connect` | `event`, `request` | `event` | What the Connect button does. `event`: emit `connect-request` and wait for the host's `wallet` message. `request`: also send an `eth_requestAccounts` RPC (for hosts that simply forward every RPC to an EIP-1193 provider). |
| `hostOrigin` | origin, e.g. `https://app.example.com` | none | Iframes only: pins the parent's origin. Messages from any other origin are dropped, and the embed posts to that origin instead of `*`. |
| `config` | base64url (or base64) of a JSON object | none | Full configuration (below). Applied after the individual params, so it wins. |

### `config` JSON

The same object is accepted live through the `config` message (section 3.2). Every field is optional.

```ts
interface FlipperEmbedConfig {
  chainId?: number;
  token?: string;                    // address
  tokens?: string[];                 // allowlist
  mode?: "picker" | "single";        // single requires `token`
  hidePicker?: boolean;              // deprecated: mode "single"
  variant?: "card" | "compact";
  fit?: "auto" | "fill";             // fill: the widget fills a fixed-size frame
  size?: "sm" | "md" | "lg" | "auto";
  details?: boolean;                 // win chance / payout / fee line (default off)
  tagline?: string | boolean;        // idle headline: true = built-in, string = yours (default none)
  theme?: "light" | "dark" | "auto" | FlipperTheme;   // FlipperTheme: see the widget README
  accent?: string;                   // "#ff5a1f"
  radius?: number;                   // px
  branding?: boolean;
  brandName?: string;                // replaces "flipper" in the header
  brandLogo?: string;                // image URL (square, ≥ 64 px); the page's CSP allows data: URIs and its own origin
  coinImage?: string;                // image URL: heads face of the coin (same)
  coinImageTails?: string;           // https URL: tails face
  locale?: string;
  strings?: Record<string, string>;  // string-table overrides (keys in the widget README)
  partner?: string;
  minAmount?: string;                // decimal, in token units ("10")
  maxAmount?: string;
  approval?: "max" | "exact";        // allowance to request (default "max")
  listing?: boolean;                 // allow listing qualifying tokens: whitelisted pools and tokens, verified launchpad tokens (default true)
  eth?: boolean;                     // offer native ETH, flipped as WETH (default true)
  rpcUrl?: string;                   // read RPC (host `config` message only; ignored in the URL)
  apiUrl?: string;                   // flipper API (host `config` message only; ignored in the URL)
  addresses?: Record<string, string>;  // contract overrides (host `config` message only; ignored in the URL)
}
```

Encode it with `btoa(JSON.stringify(config))` (URL-encode it, or replace `+/` with `-_` and drop the `=` padding).

**What a URL may set.** Anyone can craft an `/embed` link and open it under flipper.family's origin, so:
- The URL (params and `config`) never decides where funds or approvals go: `addresses`, `rpcUrl` and `apiUrl` in it are
  ignored, and the page's own deployment manifest decides them. A host that needs them sends a `config` message after
  `ready` (`@flipperdotfamily/widget/host` does this for you). Even then, the page's CSP only connects to flipper's own RPC and
  API origins.
- A **standalone** embed (opened directly: no iframe parent, no native bridge) also ignores the URL's `strings`,
  `brandName`, `brandLogo`, `coinImage`, `coinImageTails` and custom `tagline` text, and takes only the theme mode and
  plain colour tokens (no `url(`, `var(`, `expression`, `@import`, quotes or `;`) from `theme` and `accent`.
- Max approvals stay the default (`approval`): with the addresses locked, the spender is always the genuine house.

## 2. Transport

All payloads are JSON objects.

### Embed to host

The embed picks the first transport available when it sends each message (checked every time, so a bridge injected
late still works):

1. `window.FlipperHost.postMessage(json: string)`: the normative native transport. The host injects `FlipperHost`
   into the page. Webview JavaScript channels can provide it directly:
   - Flutter `webview_flutter`: `addJavaScriptChannel('FlipperHost', …)`.
   - Android: `addJavascriptInterface(obj, "FlipperHost")`, where `obj` has a `@JavascriptInterface postMessage(String)`.
   - React Native: inject `window.FlipperHost = { postMessage: (s) => window.ReactNativeWebView.postMessage(s) }` before content loads.
   - iOS: inject `window.FlipperHost = { postMessage: (s) => webkit.messageHandlers.FlipperHost.postMessage(s) }` as a `WKUserScript` at document start.
2. Conveniences for hosts that skip step 1, used only when `FlipperHost` is absent:
   - `window.webkit.messageHandlers.FlipperHost.postMessage(json: string)` (iOS script message handler named `FlipperHost`);
   - `window.ReactNativeWebView.postMessage(json: string)`.
3. In an iframe (`window.parent !== window`): `window.parent.postMessage(object, hostOrigin ?? "*")`. The embed posts
   the object itself, not a string.
4. Otherwise the embed is standalone: there's no host. It uses `window.ethereum` if a wallet injected one (a wallet's
   in-app browser), and events stay on the page.

Native transports always carry a string (`JSON.stringify(message)`); `postMessage` to a parent window carries the
object.

### Host to embed

Either path is accepted:

- `window.FlipperBridge.receive(message)`: the embed defines it before mounting the widget. `message` is a JSON
  string or an object. From native: `evaluateJavascript("window.FlipperBridge.receive(" + jsonStringLiteral + ")")`.
  React Native: `webViewRef.current.injectJavaScript(...)`.
- A `message` event on `window` (or `document`, where Android React Native WebViews dispatch it), with `data` as the
  object or its JSON string: `iframe.contentWindow.postMessage(message, embedOrigin)` from a parent page, or
  `window.postMessage(json)` injected natively.

`window.FlipperBridge` also exposes `version: 1`. Hosts can poll for it to learn that the embed has loaded, but the
`ready` event (section 4) is the usual signal.

## 3. Messages

Every message has `v: 1` and a `source`: `"flipper"` from the embed, `"flipper-host"` from the host. Receivers
ignore anything else, as well as unknown `type`s and unknown fields, so later versions can add them.

### 3.1 Embed to host

**RPC request.** These are wallet methods only; reads go to the embed's own RPC.

```json
{ "v": 1, "source": "flipper", "type": "rpc", "id": "f7", "method": "eth_sendTransaction", "params": [{ "from": "0x…", "to": "0x…", "data": "0x…", "value": "0x…", "gas": "0x…", "maxFeePerGas": "0x…", "maxPriorityFeePerGas": "0x…" }] }
```

- `id` is a string, unique per request. Answer it exactly once.
- Answer RPCs whenever they arrive. Don't wait for `ready`: after a reload or a live `config` change, requests can
  come before or around it.
- `params` is always an array (EIP-1193 shape), and `[]` for methods without params.
- Methods the embed sends:

| Method | When | Result |
|---|---|---|
| `eth_accounts` | only if no `wallet` message has arrived 1.5 s after `ready` (the embed answers these two itself until then) | `string[]` |
| `eth_chainId` | same | hex string (`"0x1237"`) |
| `eth_requestAccounts` | the Connect button, with `connect=request` | `string[]` |
| `eth_sendTransaction` | approvals, flips, listings | tx hash |
| `wallet_switchEthereumChain` | the wallet is on another chain and the user taps "Switch" | `null` |
| `wallet_addEthereumChain` | after a switch fails with `4902` | `null` |
| `wallet_watchAsset` | "Add to wallet" after a win | `boolean` |
| `wallet_getCapabilities` | before flipping native ETH (optional: EIP-5792) | capabilities object |
| `wallet_sendCalls` | flipping native ETH when the wallet reports atomic batching (wrap + approve + flip in one confirmation) | `{ id }` |
| `wallet_getCallsStatus` | polling a `wallet_sendCalls` batch | status object |

The three EIP-5792 methods are optional. A host that doesn't support them answers `4200`, and the widget falls back
to sequential `eth_sendTransaction` calls: wrap, then approve, then flip.

Transactions are fully specified by the embed (`gas`, EIP-1559 fees) and simulated first. Hosts must forward them
unchanged, apart from what their wallet normally adds, such as the nonce.

**Event.**

```json
{ "v": 1, "source": "flipper", "type": "event", "name": "flip-settled", "data": { … } }
```

`name` is one of `ready`, `connect-request`, `flip-requested`, `flip-settled`, `payout-resolved`, `listing`, `error`,
`resize`. Hosts must ignore names they don't know, since later widget versions can add events.
Section 5 lists each `data` payload.

### 3.2 Host to embed

**RPC answers.**

```json
{ "v": 1, "source": "flipper-host", "type": "rpc-result", "id": "f7", "result": "0xabc…" }
{ "v": 1, "source": "flipper-host", "type": "rpc-error", "id": "f7", "error": { "code": 4001, "message": "User rejected the request." } }
```

`error.data` is optional. Use EIP-1193 / EIP-1474 codes, which the widget turns into plain-English messages:

| Code | Meaning |
|---|---|
| `4001` | user rejected the request |
| `4100` | not authorized (no account connected) |
| `4200` | method not supported by this host |
| `4900` / `4901` | wallet disconnected / not connected to the requested chain |
| `4902` | unrecognised chain (answer to `wallet_switchEthereumChain`; the embed then sends `wallet_addEthereumChain`) |
| `-32602` / `-32603` | invalid params / internal error |

**Wallet state.** Send this after `ready`, and again on every change: connect, disconnect, account switch, chain
switch.

```json
{ "v": 1, "source": "flipper-host", "type": "wallet", "accounts": ["0xAbC…"], "chainId": "0x1237" }
```

- `accounts`: the connected accounts, with the active account first; `[]` when disconnected.
- `chainId`: hex string of the wallet's current chain. With no wallet, send the chain you'd connect on, or `"0x0"`.

**Live config.**

```json
{ "v": 1, "source": "flipper-host", "type": "config", "theme": "light", "accent": "#ff5a1f", "token": "0x…" }
```

Any subset of the `FlipperEmbedConfig` fields, at the top level of the message. It is merged into the current
config. For example, sync the host app's dark mode, or preselect a token from a host screen.

## 4. Lifecycle

```
host                                   embed
 │  load /embed?… (inject FlipperHost)   │
 │ ─────────────────────────────────────▶│  defines window.FlipperBridge, listens, mounts <flipper-widget>
 │◀──────────── event ready ─────────────│  (read-only: prices and balances need no wallet)
 │──── wallet {accounts, chainId} ──────▶│  now "connected": balances, Flip button
 │◀──────────── event resize ────────────│  (whenever its height changes: size the iframe / view)
 │                                       │
 │    user taps "Connect wallet" while accounts = []
 │◀──────── event connect-request ───────│
 │  (open your wallet UI)                │
 │──── wallet {accounts, chainId} ──────▶│
 │                                       │
 │    user taps "Flip 100 FLIPPER"
 │◀── rpc eth_sendTransaction (approve)──│  only if the allowance is short (max approval by default)
 │──── rpc-result "0xhash" ─────────────▶│
 │◀── rpc eth_sendTransaction (flip) ────│
 │──── rpc-result "0xhash" ─────────────▶│
 │◀────── event flip-requested ──────────│  coin spins while randomness is drawn (~2–5 s)
 │◀────── event flip-settled ────────────│  coin lands; balances refresh
```

- The embed never opens wallet UI itself. Everything wallet-related is either an RPC (for the host to prompt) or
  `connect-request` (for the host to open its connect flow).
- With the wallet on another chain, the Flip button reads "Switch to <chain>" (e.g. "Switch to Robinhood Chain"). It sends
  `wallet_switchEthereumChain` with `[{ "chainId": "0x1237" }]`, then `wallet_addEthereumChain` if that fails with
  `4902`. After a successful switch, send a `wallet` message with the new `chainId`.
- If the host never answers an RPC, the widget waits: users may take minutes to confirm in a wallet. Hosts should
  always answer, with `4001` when the user closes the prompt.
- Reloading the WebView or iframe resets the embed. Send `wallet` again after the new `ready`.

## 5. Events

`data` payloads. Amounts are decimal strings in the token's smallest unit (wei), addresses are EIP-55 strings, and
every payload includes `partner` (`string | null`). The same payloads are the `detail` of the web component's DOM
events.

| `name` | `data` |
|---|---|
| `ready` | `{ version, chainId, account, token, variant, partner }`: `account` is null without a wallet; `version` is the widget's semver. |
| `connect-request` | `{ reason: "connect" \| "flip" \| "list", partner }` |
| `flip-requested` | `{ flipId, account, token, symbol, decimals, amount, winChanceBps, randomnessFee, txHash, approveTxHash, native, partner }`: the flip transaction is mined and randomness has been requested. `approveTxHash` is null when no approval was needed. With `native: true`, the stake was ETH, wrapped into WETH (`token`). |
| `flip-settled` | `{ flipId, account, token, symbol, decimals, amount, outcome, status, won, pending, payout, payoutToken, flipperPaid, txHash, requestTxHash, native, partner }` |
| `payout-resolved` | `{ flipId, account, token, symbol, decimals, tokenPaid, flipperPaid, by: "self" \| "other", native, txHash, partner }`: a pending win (`WinPending`) was paid out. Emitted once per flip. |
| `listing` | `{ stage: "started" \| "submitted" \| "listed" \| "failed", token, symbol, venue: "v4" \| "v3" \| null, txHash, error, partner }` |
| `error` | `{ code, message, context, partner }`: `code` is `user-rejected`, `rejected`, `insufficient-funds`, `revert`, `timeout`, `config`, `network`, `wallet` or `unknown`; `context` is `config`, `wallet`, `preview`, `flip` or `listing`. `message` is plain English, safe to show. |
| `resize` | `{ width, height }`: CSS pixels of the widget's border box. For iframes, set `iframe.style.height = height + "px"`. |

`flip-settled` fields:
- `outcome`: `"won"`, `"lost"` or `"refunded"`.
- `status`: `Won`, `WonFallback` (winnings paid in $FLIPPER), `WinPending` (stake back, winnings on the way), `Lost`,
  `LostInventory` or `Refunded`.
- `pending`: true for `WinPending`. A second `flip-settled` for the same `flipId` follows when the winnings are paid,
  together with `payout-resolved`. De-duplicate by `flipId`; the last one is final.
- `payout`: what the player received in `payoutToken`, stake included (`"0"` on a loss); `flipperPaid` is any
  $FLIPPER paid on top.
- `txHash`: the settlement transaction (null if it couldn't be looked up); `requestTxHash` is the flip transaction.

`payout-resolved` fields: a `WinPending` flip's stake came back at settlement, and its winnings were owed until now.
The widget shows a Retry payout button meanwhile, which sends `resolvePendingWin` through the usual
`eth_sendTransaction`; anyone may call it. It also lists the wallet's earlier pending wins.
- `by`: `"self"` when this widget's Retry payout paid it, `"other"` when someone else did (usually flipper's payout
  worker, within seconds).
- `tokenPaid`: the winnings paid in `token`, not counting the stake. `flipperPaid`: $FLIPPER paid instead, when the
  token still couldn't be bought after the house's pending timeout (`"0"` otherwise).
- `native`: true when the stake was native ETH, as in `flip-settled`. `symbol` is then "ETH", and `token` is WETH,
  which the winnings are paid in. A pending win the embed only learns about from an earlier session can't be told
  apart from a WETH flip, so it reports `false` and "WETH".
- `txHash`: the payout transaction (null if it couldn't be looked up).

## 6. Security

- **Source check.** The embed ignores every message whose `source` isn't `"flipper-host"` or whose `v` isn't `1`.
  Hosts must ignore everything whose `source` isn't `"flipper"`.
- **Iframes.** The embed only accepts `message` events whose `event.source === window.parent`. With `hostOrigin`, it
  also requires `event.origin === hostOrigin` and posts to that origin only. Hosts should check
  `event.source === iframe.contentWindow` and `event.origin === "https://flipper.family"`.
- **Native WebViews.** When not framed, the embed accepts `message` events only from its own window (`event.source === window`)
  or with no source (native dispatch). A window that opened the embed (`window.opener`) can't talk to it.
- **Wallet surface.** The embed only requests the methods in 3.1 (the embed's bridge refuses anything else with
  `4200` before it reaches the host). Hosts should refuse anything else with `4200`,
  and never sign on the embed's behalf without the user's wallet prompt.
- **No secrets.** Nothing secret crosses the bridge in either direction: no keys, sessions, cookies or tokens. Events
  carry public onchain data and the `partner` id. The embed stores nothing but UI preferences.
- **Framing and CSP.** `/embed` is served with `frame-ancestors *`, so any site or app can embed it. The rest of its
  CSP: `script-src 'self'` (no CDN fallback: a missing widget build is a 503), `connect-src` its own origin plus the
  deployment's RPC and API origins, and `img-src` its own origin, `data:` and the API's logo proxy. So a host's
  `brandLogo` / `coinImage` must be a `data:` URI to show in the embed, and host `rpcUrl` / `apiUrl` overrides to
  other origins are blocked.
- **URL config.** Anyone can craft an `/embed` link, so the URL never sets `addresses`, `rpcUrl` or `apiUrl`, and a
  standalone embed also drops URL branding and copy and takes only plain colour tokens (see "What a URL may set" in 1).
- **Pinned deployments.** The SDK refuses a deployment manifest whose house or lens isn't flipper's canonical one for
  that chain (`CANONICAL_DEPLOYMENTS` in `@flipperdotfamily/sdk`). Only an integrator's own code can opt out, with
  `allowUnpinnedDeployment: true` (never a URL param). Chain 31337 (local) isn't pinned.
- **Adding a chain.** `wallet_addEthereumChain` always carries flipper's hard-coded public RPC and explorer for the
  chain, never an overridden read RPC, so a crafted config can't save its RPC into the user's wallet.
- **Links.** Explorer, RPC and API URLs must be `https:` (`http:` only for localhost); anything else is dropped before
  a link is built.
- **Partner header.** `X-Flipper-Partner` is attribution only and unauthenticated. The API may count it, but must not
  grant anything on it. Onchain attribution comes from the registered partner code, not the header.
- **Host iframe.** `@flipperdotfamily/widget/host` sandboxes its iframe
  (`allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox`): no top navigation, forms or modals.
- **Navigation.** Native hosts should keep the WebView on `https://flipper.family/embed` and open other links in the
  system browser (the embed opens explorer links with `target="_blank"`).

## 7. Reference host (pseudo-code)

```js
// web: prefer @flipperdotfamily/widget/host (mountFlipperIframe), which implements all of this.
const EMBED = "https://flipper.family";
const iframe = document.querySelector("iframe#flipper");
const provider = window.ethereum; // any EIP-1193 provider: wagmi connector, AppKit, Privy, …
const send = (m) => iframe.contentWindow.postMessage({ v: 1, source: "flipper-host", ...m }, EMBED);
const pushWallet = async () =>
  send({ type: "wallet", accounts: await provider.request({ method: "eth_accounts" }), chainId: await provider.request({ method: "eth_chainId" }) });

window.addEventListener("message", async (e) => {
  if (e.source !== iframe.contentWindow || e.origin !== EMBED) return;
  const m = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
  if (m?.v !== 1 || m.source !== "flipper") return;
  if (m.type === "rpc") {
    try { send({ type: "rpc-result", id: m.id, result: await provider.request({ method: m.method, params: m.params }) }); }
    catch (err) { send({ type: "rpc-error", id: m.id, error: { code: err.code ?? -32603, message: err.message ?? "Request failed" } }); }
  } else if (m.type === "event") {
    if (m.name === "ready") pushWallet();
    if (m.name === "connect-request") openYourConnectModal(); // then pushWallet() once connected
    if (m.name === "resize") iframe.style.height = `${m.data.height}px`;
  }
});
provider.on("accountsChanged", pushWallet);
provider.on("chainChanged", pushWallet);
```

Native (Kotlin, sketch):

```kotlin
webView.addJavascriptInterface(object {
  @JavascriptInterface fun postMessage(json: String) = handleFlipperMessage(JSONObject(json)) // rpc / event
}, "FlipperHost")
fun sendToEmbed(msg: JSONObject) {
  msg.put("v", 1); msg.put("source", "flipper-host")
  webView.post { webView.evaluateJavascript("window.FlipperBridge && window.FlipperBridge.receive(${JSONObject.quote(msg.toString())})", null) }
}
```

## Changelog

- **v1, widget 0.1.x (security):** the URL no longer sets `addresses`, `rpcUrl` or `apiUrl` (a host sends them in a
  `config` message; `@flipperdotfamily/widget/host` does). A standalone embed ignores URL branding and copy and takes only plain
  colour tokens. `personal_sign` and `eth_signTypedData_v4` are no longer forwarded (nothing used them).
  `wallet_addEthereumChain` uses flipper's hard-coded RPC. The embed's CSP is tightened, and `/embed/*` serves a 503
  rather than redirecting to a CDN. Still protocol version 1.
- **v1, widget 0.1.x:** `partner` is also attributed onchain (an ERC-8021 suffix on the flip's calldata, inside the
  same `eth_sendTransaction`), and the embed shows the drawdown circuit breaker's paused state and a Settle now action
  for flips deferred by it. No new messages or RPC methods.
- **v1, widget 0.1.x:** adds the `payout-resolved` event and the Retry payout flow for pending wins. The flow uses
  `eth_sendTransaction` only, so there are no new RPC methods and the protocol version stays 1.

- **v1** (widget 0.1): initial protocol. It adds the optional EIP-5792 methods (`wallet_getCapabilities`,
  `wallet_sendCalls`, `wallet_getCallsStatus`) to the base method list, for one-confirmation ETH flips, and sends
  `partner` as the `X-Flipper-Partner` header. It also adds `mode` (picker / single; `hidePicker` is deprecated),
  `fit` (auto / fill, for fixed-size frames) and `size`, as URL params and `config` fields, and the opt-in `details`
  and `tagline` (both off by default: the widget no longer shows a headline or the odds/fee line unless asked).
