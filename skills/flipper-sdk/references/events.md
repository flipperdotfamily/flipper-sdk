# Events

The widget reports what happens through eight events:
- On the web component they are `CustomEvent`s dispatched **on the element**. They **don't bubble**, so listen on
  the element itself.
- The wrappers expose them as callbacks or outputs that receive the detail.
- The iframe / WebView embed sends the same payloads as `event` messages ([iframe-bridge.md](iframe-bridge.md)).

Every payload is JSON-safe. Amounts are **wei as decimal strings**, addresses are EIP-55 strings, and every payload
except `resize` carries `partner` (`string | null`), the widget's `partner` option. The onchain attribution (the ERC-8021
suffix a registered partner code adds to each flip) isn't in the events: read it with the SDK's `flipPartner(flipId)`.

## Where to listen

| Host | `flip-settled` handler |
|---|---|
| Element | `el.addEventListener("flip-settled", (e) => e.detail)` |
| React | `onFlipSettled={(d) => …}` |
| Vue | `@flip-settled="(d) => …"` |
| Svelte 5 | `onFlipSettled={(d) => …}` |
| Angular | `(flipSettled)="on($event)"`; the raw `(flip-settled)` gives `$event.detail` |
| iframe host | `mountFlipperIframe({ onEvent: (name, data) => … })` |

The other events follow the same naming. React: `onReady`, `onConnectRequest`, `onFlipRequested`,
`onPayoutResolved`, `onListing`, `onError`, `onResize`. Angular: `flipperReady`, `connectRequest`, `flipRequested`,
`payoutResolved`, `flipperListing`, `flipperError`, `flipperResize`.

## Payloads

Import the types with `import type { FlipperEventMap } from "@flipperdotfamily/widget"`, e.g.
`FlipperEventMap["flip-settled"]`.

**`ready`**: `{ version, chainId, account, token, variant, partner }`
- Sent once, after the first configuration attempt, whether or not it succeeded.
- `account` is null without a wallet. `token` is the selected token address, or `"ETH"`.

**`connect-request`**: `{ reason: "connect" | "flip" | "list", partner }`
- Sent when a disconnected user presses Connect, Flip or List. Open the app's connect UI.
- It is cancelable. On the raw element, call `e.preventDefault()` when you handle it, or set
  `el.onConnectRequest = fn`. Otherwise the widget asks the provider for `eth_requestAccounts` itself, if it has a
  provider.

**`flip-requested`**: `{ flipId, account, token, symbol, decimals, amount, winChanceBps, randomnessFee, txHash, approveTxHash, native, partner }`
- The flip transaction is mined and randomness was requested. The coin now spins for about 2–5 s.
- `approveTxHash` is null when no approval was needed.
- `native` is true for an ETH flip. The ETH was wrapped, so `token` is the WETH address while `symbol` reads
  `"ETH"`.

**`flip-settled`**: `{ flipId, account, token, symbol, decimals, amount, outcome, status, won, pending, payout, payoutToken, flipperPaid, txHash, requestTxHash, native, partner }`

| Field | Meaning |
|---|---|
| `outcome` | `"won"`, `"lost"` or `"refunded"` |
| `status` | `Won`; `WonFallback` (winnings paid in $FLIPPER); `WinPending` (stake back, winnings still owed); `Lost`; `LostInventory`; `Refunded` |
| `pending` | true for `WinPending`. A **second** `flip-settled` with the same `flipId` follows when the winnings are paid, alongside `payout-resolved` |
| `payout` | received in `payoutToken` (the flipped token), **stake included**; `"0"` on a loss |
| `flipperPaid` | $FLIPPER paid on top (18 decimals) |
| `txHash` | the settlement transaction (null if it couldn't be looked up) |
| `requestTxHash` | the flip transaction |

A `WinPending` flip settled with the stake returned, but the winnings couldn't be bought at that moment and are
still owed. The widget shows "Payout being settled · X owed" with a **Retry payout** button (anyone may pay it out).
flipper's payout worker usually pays within about a second; after a timeout the payout is made in $FLIPPER instead.

**`payout-resolved`**: `{ flipId, account, token, symbol, decimals, tokenPaid, flipperPaid, by: "self" | "other", native, txHash, partner }`
- Sent **once** per flip, when a pending win's winnings are paid, alongside the final `flip-settled` for that
  `flipId`.
- `tokenPaid` is the winnings in `token`. The stake already came back at settlement.
- `flipperPaid` is $FLIPPER paid instead (18 decimals): `"0"` unless the token still couldn't be bought after the
  pending timeout.
- `by` is `"self"` when this widget's Retry payout paid it, and `"other"` when someone else did (usually flipper's
  payout worker).
- `native` is true when the stake was native ETH, as on `flip-settled`: `token` is the WETH address (the winnings are
  paid in WETH) while `symbol` reads `"ETH"`. A pending win the widget only learned about from an earlier session
  can't be told apart from a plain WETH flip, so it reports `native: false` and `"WETH"`.
- `txHash` is the `PendingWinResolved` transaction (null if it couldn't be looked up).

**`listing`**: `{ stage: "started" | "submitted" | "listed" | "failed", token, symbol, venue, txHash, error, partner }`
- Someone listed a qualifying token (a whitelisted token, or one covered by an attached launchpad integration) from the
  widget's picker. Anyone can do it.
- `venue` names the route adapter that lists it (`"v4"`, `"v3"`, …), or null.

**`error`**: `{ code, message, context, partner }`
- `code` is one of `user-rejected`, `rejected`, `insufficient-funds`, `revert`, `timeout`, `config`, `network`,
  `wallet` or `unknown`.
- `context` is one of `config`, `wallet`, `preview`, `flip` or `listing`. A failed Retry payout reports `flip`.
- `message` is plain English and safe to show. The widget already shows errors inline, so use this event for
  logging.

**`resize`**: `{ width, height }`
- CSS pixels of the widget's box. It matters for iframes and WebViews. On a normal page, ignore it.

## Recipes

**De-duplicate settlements** (handle the final result once):

```ts
const finals = new Set<string>();
function onFlipSettled(d: FlipperEventMap["flip-settled"]) {
  if (d.pending) {
    toast("Stake returned. Your winnings are on the way.");
    return;                                   // the final flip-settled (and payout-resolved) comes later
  }
  if (finals.has(d.flipId)) return;
  finals.add(d.flipId);
  // …final handling
}
```

**Format amounts:**

```ts
import { formatUnits } from "viem";                // or formatTokenAmount from "@flipperdotfamily/sdk"
const stake = formatUnits(BigInt(d.amount), d.decimals);
const payout = formatUnits(BigInt(d.payout), d.decimals); // payoutToken === token
const bonus = formatUnits(BigInt(d.flipperPaid), 18);     // $FLIPPER
const payoutSymbol = d.native ? "WETH" : d.symbol;        // native flips: symbol is "ETH", winnings arrive as WETH
```

**Toasts:**

```ts
if (d.outcome === "won") toast.success(`Won ${payout} ${payoutSymbol}`);
else if (d.outcome === "refunded") toast(`Refunded ${stake} ${d.symbol}`);
else toast(`Lost ${stake} ${d.symbol}`);
```

The widget already shows the result on the card, so toasts are optional. They are useful for the `button`
variant after the dialog closes.

**Refetch the app's balances** after a final settlement, and after `flip-requested` (the stake has left the
wallet):
- wagmi: `refetch()` from `useBalance` / `useReadContract`, or `queryClient.invalidateQueries()`.
- Next.js App Router: `router.refresh()`.
- SvelteKit: `invalidate("app:balances")`.
- To make the widget itself re-read balances after the app moved funds: `el.refresh()`, or through the wrapper's
  ref.

**Analytics:**

```ts
track("flip_settled", {
  flip_id: d.flipId, outcome: d.outcome, status: d.status, token: d.token, symbol: d.symbol,
  amount_wei: d.amount, payout_wei: d.payout, native: d.native, chain_id: chainId, partner: d.partner,
});
```

- Send wei strings, and convert on the backend.
- Widget events are client hints: users close tabs before a `WinPending` resolves. For accounting or rewards,
  index the house contract's `FlipSettled` / `PendingWinResolved` / `FlipCancelled` logs server-side. The headless
  SDK has `getFlipEvents`, `getSettlement` and `findFlipIds` ([headless-sdk.md](headless-sdk.md)).

**Explorer links:**

```ts
const EXPLORER: Record<number, string> = { 4663: "https://robinhoodchain.blockscout.com" };
const url = d.txHash && chainId in EXPLORER ? `${EXPLORER[chainId]}/tx/${d.txHash}` : null;
```

Take `chainId` from the `ready` event.

**Errors:**

```ts
function onError(e: FlipperEventMap["error"]) {
  if (e.code === "user-rejected") return;               // the user closed the wallet prompt
  if (e.context === "config") reportToSentry(e);        // the deployment / RPC / API couldn't load
  logger.warn("flipper", e.code, e.context, e.message);
}
```

**Listings:** when `d.stage === "listed"`, refresh any token lists the app shows (the token is now flippable for
everyone).

## Typing on the raw element

`HTMLElementEventMap` is augmented for `connect-request`, `flip-requested`, `flip-settled`, `payout-resolved` and
`listing`. The names `ready`, `error` and `resize` collide with standard DOM events, so cast them:

```ts
el.addEventListener("error", (e: Event) => {  // annotate as Event: TS types "error" as ErrorEvent
  const d = (e as CustomEvent<FlipperEventMap["error"]>).detail;
});
```
