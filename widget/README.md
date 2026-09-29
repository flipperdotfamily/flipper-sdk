# @flipperdotfamily/widget

Drop-in coin flips for any site or app: `<flipper-widget>` is a framework-agnostic web component (Lit, Shadow DOM)
with the complete [flipper.family](https://flipper.family) flip UI: token picker, amount, the 3D coin, results,
listing, and native ETH.

- **Bring your own wallet.** Pass any EIP-1193 provider or a viem `WalletClient`. The widget never ships a wallet
  modal: when the user needs to connect, it tells you (`connect-request`) and you open yours.
- **White-label.** Typed theme object and CSS custom properties, `::part()` hooks, a string table, your logo and name,
  your coin faces, and `branding={false}`.
- **Every framework.** Use the element directly (plain HTML, Solid, Preact, Lit, Qwik…) or the typed wrappers:
  [`@flipperdotfamily/react`](../react), [`@flipperdotfamily/vue`](../vue), [`@flipperdotfamily/svelte`](../svelte),
  [`@flipperdotfamily/angular`](../angular). Native apps embed the hosted page over the [bridge](./BRIDGE.md).

```html
<script src="https://cdn.jsdelivr.net/npm/@flipperdotfamily/widget@0/dist/cdn/flipper-widget.js"></script>
<flipper-widget theme="dark" partner="acme"></flipper-widget>
<script>
  const w = document.querySelector("flipper-widget");
  w.provider = window.ethereum; // any EIP-1193 provider
  w.addEventListener("connect-request", () => w.provider?.request({ method: "eth_requestAccounts" }));
  w.addEventListener("flip-settled", (e) => console.log(e.detail.outcome, e.detail.payout));
</script>
```

## Install

```sh
npm i @flipperdotfamily/widget        # the element (ESM; lit, viem and @flipperdotfamily/sdk are dependencies)
```

```ts
import "@flipperdotfamily/widget";                        // registers <flipper-widget> (no-op on the server)
import { FlipperWidget } from "@flipperdotfamily/widget/element"; // the class only, for a custom tag name
import { mountFlipperIframe } from "@flipperdotfamily/widget/host"; // iframe embedding with the postMessage bridge
```

CDN builds (single file, everything bundled):

| File | Use |
|---|---|
| `dist/cdn/flipper-widget.js` | `<script src>`: registers the element; global `FlipperWidget` |
| `dist/cdn/flipper-widget.esm.js` | `<script type="module">` / `import()` from a URL |
| `dist/cdn/flipper-host.js` | iframe host helper, global `FlipperEmbedHost.mountFlipperIframe` |

Sizes (0.1.0, minified):
- `flipper-widget.js` (CDN): 374 KB, **110 KB gzipped**, 93 KB brotli, with viem, lit and the SDK included.
- ESM build through your bundler:
  - the widget's own code is 32 KB gzipped;
  - with lit, 38 KB;
  - with `@flipperdotfamily/sdk`, 59 KB;
  - viem is shared with your app. Framework wrappers load the element lazily, in its own chunk.

## Wallet

The widget reads chain state through its own RPC and only uses the wallet to sign. Set one of:

| Property | Type | Notes |
|---|---|---|
| `provider` | EIP-1193 provider | `window.ethereum`, a wagmi connector's `getProvider()`, WalletConnect, Reown AppKit, Privy, Dynamic, Coinbase… The widget listens to `accountsChanged`, `chainChanged` and `disconnect`. |
| `walletClient` | viem `WalletClient` | e.g. wagmi's `useWalletClient().data`. Replace it when the account changes (wagmi does). |
| `onConnectRequest` | `(detail) => void` | Called when a disconnected user presses Connect or Flip. Open your wallet UI. |

No wallet: the widget runs read-only (prices, odds, token list) and the button reads "Connect wallet". Pressing it
dispatches a cancelable `connect-request` event. If nothing calls `preventDefault()` and there's no
`onConnectRequest`, a provider without accounts is asked for `eth_requestAccounts`.

Wrong chain: the button reads "Switch to <chain>" (e.g. "Switch to Robinhood Chain") and calls `wallet_switchEthereumChain` (adding the chain
with `wallet_addEthereumChain` on error 4902).

## Configuration

Attributes are kebab-case strings; properties take typed values. Every option is optional.

| Property / attribute | Type | Default | |
|---|---|---|---|
| `chainId` / `chain-id` | number (attr also `robinhood`, `local`) | the manifest's default (4663, Robinhood Chain, on flipper.family) | the chain to flip on |
| `rpcUrl` / `rpc-url` | string | the chain's public RPC | reads only |
| `apiUrl` / `api-url` | string \| `null` | the deployment's | flipper API (token list, logos). `null` / `"none"`: onchain list only |
| `deploymentUrl` / `deployment-url` | string \| `null` | `https://flipper.family/embed/deployment.json` | live addresses; not fetched when `addresses` has `house` + `lens` |
| `addresses` | object (attr: JSON) | from the manifest | `{ house, lens, flipper, v4Adapter, v3Adapter, weth, … }` |
| `allowUnpinnedDeployment` | boolean (property only) | `false` | accept a fetched manifest whose house or lens isn't flipper's canonical one (only for your own deployment of the contracts; see [Security](#security)) |
| `token` | address \| `"ETH"` | $FLIPPER | selected at start |
| `mode` | `"picker"` \| `"single"` | `"picker"` | `picker`: the user chooses the token. `single`: one fixed token (`token` required, else a configuration error shows); the picker isn't rendered and the amount row shows the token as a quiet label |
| `tokens` | string[] (attr: comma list) | all | allowlist for the picker; one entry (and no `mode`) = single |
| `hidePicker` / `hide-picker` | boolean | false | **deprecated**: use `mode="single"` (same, but falls back to $FLIPPER without `token`) |
| `eth` | boolean | true | offer native ETH (wrapped to WETH) |
| `listing` | boolean | true | listing of qualifying tokens (whitelisted pools and tokens, and launchpad tokens a verifier vouches for) |
| `minAmount` / `min-amount`, `maxAmount` / `max-amount` | decimal string | none | stake bounds in token units |
| `approval` | `"max"` \| `"exact"` | `"max"` | allowance requested when short |
| `variant` | `"card"` \| `"compact"` \| `"button"` | `"card"` | `button`: a trigger that opens the card in a modal (`el.open()`, `el.close()`) |
| `fit` | `"auto"` \| `"fill"` | `"auto"` | `auto`: width from the container, height from the content. `fill`: fill the element's width and height (give it a height) |
| `size` | `"sm"` \| `"md"` \| `"lg"` \| `"auto"` | `"auto"` | scale on top of the fluid layout (0.88×, 1×, 1.14×) |
| `details` | boolean | false | show the win chance, payout and randomness fee under the button. Off, the widget only flags odds that fees trim below the usual ("↓ Odds 0.9 pts below usual") |
| `tagline` | string \| boolean (attr: bare = `true`) | none | a headline under the coin while idle. `true`: the built-in one ("Double or nothing" and its payout line, from `strings.tagline` / `strings.taglineSub`); a string: your own line |
| `theme` | `"light"` \| `"dark"` \| `"auto"` \| `FlipperTheme` (attr: mode or JSON) | `"auto"` | see [Theming](#theming) |
| `accent` | colour | flipper sky blue | shorthand for `theme.accent` |
| `radius` | px | 24 | shorthand for `theme.radius` |
| `branding` | boolean | true | `false` removes flipper marks (header dolphin, coin faces, footer) |
| `brandName` / `brand-name` | string | "flipper" | header name |
| `brandLogo` / `brand-logo` | image URL | dolphin | header logo (and the heads face with `branding=false`) |
| `coinImage` / `coin-image`, `coinImageTails` / `coin-image-tails` | image URL | dolphin / fluke | coin faces |
| `buttonLabel` / `button-label` | string | "Flip FLIPPER" | trigger label (`variant="button"`) |
| `locale` | `"en"` \| `"es"` | `"en"` | built-in strings |
| `strings` | `Partial<FlipperStrings>` | | override any string ([keys](./src/strings.ts)) |
| `reducedMotion` / `reduced-motion` | boolean | OS setting | force reduced motion on or off |
| `partner` | `[A-Za-z0-9._:-]{1,64}` | | attribution: echoed in every event and sent as `X-Flipper-Partner` on API calls. A registered partner code (1–32 of `a-z 0-9 _ -`) also goes onchain: see [Partners](#partners) |

Methods: `open()` / `close()` (button variant), `refresh()` (re-read the wallet's accounts and chain, and balances: call it after your app connects the provider). `el.client` is the underlying
[`@flipperdotfamily/sdk`](../sdk) client.

## Events

`CustomEvent`s dispatched on the element. They don't bubble, so listen on the element itself. Every `detail` is
JSON-safe: amounts are wei as decimal strings, and every payload includes `partner`. The same payloads cross the
[embed bridge](./BRIDGE.md#5-events).

For typed listeners (`ready`, `error` and `resize` share their names with DOM events), use the helper:

```ts
import { onFlipperEvent } from "@flipperdotfamily/widget";
const off = onFlipperEvent(el, "error", (detail) => toast(detail.message)); // detail is typed; returns an unsubscribe
```

| Event | `detail` |
|---|---|
| `ready` | `{ version, chainId, account, token, variant, partner }` |
| `connect-request` | `{ reason: "connect" \| "flip" \| "list", partner }`. Cancelable: call `preventDefault()` when you handle it. |
| `flip-requested` | `{ flipId, account, token, symbol, decimals, amount, winChanceBps, randomnessFee, txHash, approveTxHash, native, partner }` |
| `flip-settled` | `{ flipId, account, token, symbol, decimals, amount, outcome: "won" \| "lost" \| "refunded", status, won, pending, payout, payoutToken, flipperPaid, txHash, requestTxHash, native, partner }` |
| `payout-resolved` | `{ flipId, account, token, symbol, decimals, tokenPaid, flipperPaid, by: "self" \| "other", native, txHash, partner }`: a pending win was paid out, once per flip |
| `listing` | `{ stage: "started" \| "submitted" \| "listed" \| "failed", token, symbol, venue, txHash, error, partner }` |
| `error` | `{ code, message, context: "config" \| "wallet" \| "preview" \| "flip" \| "listing", partner }`. `message` is plain English. |
| `resize` | `{ width, height }` |

### Pending wins

A win can settle as `WinPending`: the stake came back, but the winnings couldn't be bought at that moment, so
they're owed. flipper's payout worker usually pays them within a second or two. Anyone can also call
`resolvePendingWin`, and after the house's pending timeout the payout is made in $FLIPPER if the token still can't
be bought.

- **In the result:** the widget shows "Payout being settled · X owed" and a **Retry payout** button. The button is
  enabled while a dry run of the payout passes (re-checked every 10 s). Otherwise it's disabled, and the widget says
  why and when the automatic payout is due. It polls every 2 s and switches to the paid result as soon as the
  winnings land. A retry that finds the win already paid says "Already paid out", never an error.
- **Earlier pending wins** of the connected wallet (other flips, other sessions) show as a small banner above the
  button, each with its own Retry payout and countdown, and the button variant's trigger gets a dot. Both are hidden
  when there are none.
- **Events:** `flip-settled` with `pending: true` is followed by a second `flip-settled` for the same `flipId` once
  the winnings arrive; de-duplicate by `flipId`, the last one is final. `payout-resolved` fires once per flip with
  what was paid. `by` is `"self"` when this widget's Retry payout paid it, `"other"` when someone else did (usually
  the payout worker). `tokenPaid` is the winnings in `token`, since the stake already came back at settlement;
  `flipperPaid` is the $FLIPPER paid instead after the timeout; `txHash` is the payout transaction (null if it
  couldn't be looked up). For a native-ETH flip, `native` is true and `symbol` is "ETH", as in `flip-settled`, while
  `token` is WETH, which the winnings are paid in. A pending win from an earlier session can't be told apart from a
  WETH flip, so it reports `native: false` and "WETH".

### Partners

A partner code approved in the house's `PartnerRegistry` earns a share of each flip it brings, and can hand part of
it back to its players as better odds. Set `partner="your-code"` and the widget attributes every flip onchain: it
appends the code's ERC-8021 data suffix (`registry.suffixOf(code)`, fetched once) to the flip transaction, and to
the preview, so the odds the player sees already include your discount. The same attribute keeps its offchain role
(the `partner` field of every event, and the `X-Flipper-Partner` header, which is unauthenticated attribution: anyone
can send any value, so it's a hint, never proof). A value that isn't a valid code
(uppercase, dots, colons, over 32 characters) stays offchain only. Your share accrues on attributed losing flips;
anyone can pay it out to your payout address (`claimPartner(id)`, e.g. from `@flipperdotfamily/sdk`).

### Paused (drawdown circuit breaker)

If the house bankroll's value per unit falls below half its all-time high, the protocol locks until its unlocker
reopens it. The widget checks the lock with the house and every 12 s:
- **While locked**, the button reads "Flips are paused" and a note explains that flips are paused while the treasury
  is protected. A flip that was already under way isn't lost.
- **A flip whose coin landed during the lock** shows "Settling after pause" instead of a result (its randomness is
  recorded, and the flip settles market-free after the unlock). A **Settle now** button, enabled once a dry run of
  `settleDeferred` passes (re-checked every 10 s), settles it; anyone can, so it may also settle on its own. The
  result then shows as usual, with its `flip-settled` event.

## Theming

Three layers; later ones win:
1. **CSS custom properties**, from your stylesheet: `flipper-widget { --flipper-accent: #ff5a1f; --flipper-radius: 12px; }`.
2. **The theme object** (property `theme`), typed as `FlipperTheme`:

```ts
el.theme = {
  mode: "auto",                  // "light" | "dark" | "auto"
  accent: "#ff5a1f",             // text on it is picked for contrast (or set accentText)
  background: "#fff8f2", surface: "#fff", field: "#fbefe6", border: "#0000001a",
  text: "#1b1109", textMuted: "#1b110999", textSubtle: "#1b110966",
  win: "#c77700", loss: "#d23a2e",
  radius: 16,                    // px or CSS length; inner controls scale from it
  fontFamily: "inherit",         // use the host page's font
  displayFontFamily: "Georgia, serif", monoFontFamily: "ui-monospace, monospace",
  density: "compact",            // "compact" | "comfortable" | "spacious"
  coinSize: 96, shadow: "none", borderWidth: 0, maxWidth: "none",
  dark: { background: "#140c06" },   // per-mode overrides
};
```

3. **`::part()`** for anything else: `root`, `card`, `header`, `brand`, `account`, `coin`, `status`, `result`,
   `payout` (a pending win's Retry payout block, and the pending-wins banner), `field`, `token-button`, `token` (the single-mode label), `amount-input`, `max-button`, `balance`, `odds`, `note`, `cta`, `details`, `footer`,
   `picker`, `picker-search`, `picker-row`, `check` (a picker row's checkmark; `check-launchpad` too for a launch
   its launchpad vouches for), `trigger`, `modal`.

```css
flipper-widget::part(cta) { text-transform: uppercase; letter-spacing: 0.04em; }
flipper-widget::part(card) { border: 2px solid #1b1109; box-shadow: 6px 6px 0 #1b1109; }
```

| Custom property | Theme key |
|---|---|
| `--flipper-accent`, `--flipper-accent-text` | `accent`, `accentText` |
| `--flipper-bg`, `--flipper-surface`, `--flipper-field`, `--flipper-border` | `background`, `surface`, `field`, `border` |
| `--flipper-text`, `--flipper-text-muted`, `--flipper-text-subtle` | `text`, `textMuted`, `textSubtle` |
| `--flipper-win`, `--flipper-loss` | `win`, `loss` |
| `--flipper-check`, `--flipper-check-launchpad` | (CSS only) the picker's checkmarks: whitelisted (default the accent) and launches a launchpad vouches for (#d4fc50 dark, #6b8a00 light) |
| `--flipper-radius`, `--flipper-border-width`, `--flipper-shadow`, `--flipper-max-width` | `radius`, `borderWidth`, `shadow`, `maxWidth` |
| `--flipper-backdrop` | (CSS only) the default look's faint top light; off once `--flipper-bg` is set, `none` drops it |
| `--flipper-font`, `--flipper-font-display`, `--flipper-font-mono` | `fontFamily`, `displayFontFamily`, `monoFontFamily` |
| `--flipper-coin-size` | `coinSize` |

White-label checklist: `branding={false}`, `brandName`, `brandLogo`, `coinImage` / `coinImageTails`, `accent`, and
`strings` for copy, and `tagline="Double or nothing on Acme"` if you want a headline under the coin.

## Frameworks without a wrapper

The element works anywhere custom elements do. Set objects (provider, theme) as **properties**, not attributes.

- **Solid**: `<flipper-widget prop:provider={provider()} attr:theme="dark" on:flip-settled={(e) => …} />`.
  Declare the element in `solid-js` JSX `IntrinsicElements`.
- **Preact**: `<flipper-widget provider={provider} theme="dark" onflip-settled={(e) => …} />`. Preact sets
  properties when the element has them; import `@flipperdotfamily/widget` first.
- **Plain JS / jQuery / Alpine**: `el.provider = …; el.addEventListener("flip-settled", …)`.

## Layout and sizing

By default the widget is just the coin, the amount (with the balance, small), and the button. There's no headline and no
odds/fee line: a quiet "↓ Odds 0.9 pts below usual" (narrow: "Odds −0.9 pts") appears next to the balance only
when a token's swap fees trim this flip's odds below the house's usual, and never the odds themselves. Opt back in
with `tagline` (a headline under the coin) and `details` (win chance, payout and fee under the button).

The widget lays itself out from its own box (container queries), never the viewport. Put it in a 240 px sidebar,
a phone screen, a modal or a 1400 px hero, and it adapts:
- **Below ~300 px:** tighter spacing. In picker mode the token button takes its own row. The account chip shrinks
  to a dot.
- **300–640 px:** a single column: the coin and result on top, the form below.
- **640 px and wider:** the coin and result sit beside the form (the `compact` variant becomes a one-line bar
  from 960 px).
- **Type, spacing and the coin** scale fluidly with `clamp()` over container units.
- **`fit="fill"`:** the widget takes the element's height as well: a fixed-size card, a full-bleed panel, or a
  fixed-height iframe (`/embed?fit=fill`). Height queries then kick in:
  - the coin grows or shrinks with the height;
  - on short boxes, the extras go first (the opt-in tagline's second line, details, footer);
  - it lays out down to about 240×360.
- **Otherwise** the height follows the content, and `resize` events report it.
- **The token picker** is a sheet inside the widget, never a floating dropdown. It covers the card when narrow and
  the form column when wide, so it always fits. An auto-height card grows while the picker is open.

```html
<!-- a fixed-size card -->
<flipper-widget fit="fill" style="width: 320px; height: 520px"></flipper-widget>
<!-- fill a sidebar or panel -->
<aside style="height: 100vh"><flipper-widget fit="fill" mode="single" token="ETH"></flipper-widget></aside>
```

## Accessibility

- Every control is keyboard-reachable. The token picker is a combobox and listbox (arrow keys, Enter, Escape).
  The button variant uses a native `<dialog>`.
- Status and results are announced through a live region. The coin has a text label for each state.
- `prefers-reduced-motion` turns the toss into a fade (override with `reduced-motion`).

## Security

- The widget never asks for signatures and never holds keys. Every transaction is simulated first and shown in your
  wallet.
- Reads use the deployment's public RPC. Addresses come from `addresses`, or from `deploymentUrl` over HTTPS. A
  fetched manifest must match flipper's canonical house and lens for the chain (`CANONICAL_DEPLOYMENTS` in
  `@flipperdotfamily/sdk`), or the widget refuses it. Set the `allowUnpinnedDeployment` property only for your own deployment
  of the contracts. Pin `addresses` if you'd rather not fetch at runtime.
- Explorer, RPC and API URLs must be `https:` (`http:` only for localhost); others are ignored, so a tampered manifest
  can't turn a transaction link into `javascript:`.
- Adding the chain to a wallet always uses flipper's hard-coded public RPC, never `rpcUrl`.
- Max approvals are the default (`approval="exact"` to opt out); the spender is always the deployment's house.
- API calls send no credentials, only `X-Flipper-Partner`, which is unauthenticated attribution.
- The hosted embed (`/embed`) takes no addresses, RPC or API from its URL, and ignores URL branding when opened
  directly. `@flipperdotfamily/widget/host` sandboxes its iframe. Details: [BRIDGE.md](./BRIDGE.md#6-security).

See also: [BRIDGE.md](./BRIDGE.md) (iframes and native WebViews), [@flipperdotfamily/sdk](../sdk) (headless).
