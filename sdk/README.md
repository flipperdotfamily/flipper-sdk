# @flipperdotfamily/sdk

The headless TypeScript SDK for [flipper.family](https://flipper.family): coin flips on whitelisted tokens (the majors,
Robinhood stock tokens and curated launchpad tokens; Uniswap v4 and v3 routes, native ETH via WETH), settled by
verifiable randomness against a $FLIPPER house bankroll. Built on viem (≥ 2.21.56); framework-agnostic; no React in
the default entry. Robinhood Chain (4663) is the launch chain and the default; local forks (31337) are supported too.

For a drop-in UI, use [`@flipperdotfamily/widget`](../widget) (web component) or its wrappers
([React](../react), [Vue](../vue), [Svelte](../svelte), [Angular](../angular)).

```sh
npm i @flipperdotfamily/sdk viem
```

| Entry | What |
|---|---|
| `@flipperdotfamily/sdk` | viem client, deployments, API client, listing by venue, native ETH helpers, odds / reject / settlement helpers, token discovery, holder rewards, formatting |
| `@flipperdotfamily/sdk/abis` | typed `as const` ABIs (FlipperHouse, FlipperLens, HolderRewards, V4RouteAdapter, V3RouteAdapter, TreasuryVault, ERC20, WETH) |
| `@flipperdotfamily/sdk/avatar` | deterministic default profile pictures (an SVG string or a data URI); dependency-free, no viem |
| `@flipperdotfamily/sdk/react` | **legacy**: the older wagmi-based `<FlipWidget />`, kept for compatibility. New integrations should use [`@flipperdotfamily/react`](../react). |

Peer dependency: `viem@^2`.

## Quick start (headless)

```ts
import { createFlipperClient, flipperChain, resolveDeployment, walletClientFromProvider } from "@flipperdotfamily/sdk";
import { createPublicClient, http, parseUnits } from "viem";

const deployment = await resolveDeployment({ chainId: 4663 });   // Robinhood Chain: live addresses, RPC, API
const chain = flipperChain(deployment);
const publicClient = createPublicClient({ chain, transport: http(deployment.rpcUrl) });
const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
const walletClient = walletClientFromProvider(window.ethereum, chain, account);

const flipper = createFlipperClient({ publicClient, walletClient, addresses: deployment.addresses });
const house = await flipper.house();
const { flipId, receipt } = await flipper.flip({ token: house.flipper, amount: parseUnits("100", 18), approve: "max" });
const settled = await flipper.waitForSettlement(flipId, { fromBlock: receipt.blockNumber });
console.log(settled.won ? "won" : "lost");
```

## Deployments and chains

- `resolveDeployment({ chainId?, rpcUrl?, apiUrl?, addresses?, deploymentUrl? })` → `FlipperDeployment`
  `{ chainId, liveChainId, name, rpcUrl, apiUrl, explorerUrl, nativeSymbol, blockTimeMs, addresses }`.
  - Explicit `addresses` (with `house` and `lens`) win and nothing is fetched.
  - Next come the default addresses for the chain (`FLIPPER_ADDRESSES`: Robinhood Chain's ship with the SDK) or ones
    registered with `registerFlipperAddresses(chainId, …)`; nothing is fetched unless you pass `deploymentUrl`.
  - Otherwise the live manifest is fetched from `https://flipper.family/embed/deployment.json` (`DEFAULT_DEPLOYMENT_URL`;
    pass `deploymentUrl: null` to forbid fetching). It throws `DeploymentError` for a chain without a deployment.
  - A fetched manifest must match `CANONICAL_DEPLOYMENTS[chainId]` (flipper's house and lens, baked into the SDK), or
    `resolveDeployment` throws `DeploymentError`. Pass `allowUnpinnedDeployment: true` only for your own deployment of
    the contracts. Chains without an entry (31337, and every chain until mainnet launch) aren't pinned.
  - The manifest's `rpcUrl`, `apiUrl` and `explorerUrl` must pass `safeHttpUrl` (`https:`, or `http:` on localhost);
    others are dropped, and the chain's public RPC is used.
- `CANONICAL_DEPLOYMENTS`: flipper's `{ house, lens }` per production chain. Written into `src/deployments.ts` (and the
  full address set into `FLIPPER_ADDRESSES` in `src/addresses.ts`) from the deployment manifest by the launch script's
  `release` step (`contracts/script/pin-sdk.py`), before the SDK and widget are published.
- `safeHttpUrl(u)` → `u` when it's `https:` (or `http:` on localhost / 127.0.0.1 / [::1]), else undefined.
- `flipperChain(deployment)` → a viem `Chain` (it also supplies `wallet_addEthereumChain` params).
- `parseChainId("robinhood" | "local" | "4663" | 4663)`, `PUBLIC_RPC_URLS`, `DEFAULT_CHAIN_ID` (4663, Robinhood Chain),
  `LOCAL_CHAIN_ID` (31337), `WETH_ADDRESSES`.
- `deployment.addresses` (`FlipperAddresses`): `house`, `lens`, `flipper`, `rewards` (the $FLIPPER token itself: holder
  rewards are built in), `vault`, `router`, `weth`, `v4Adapter`, `v3Adapter`, `v3Bridge`, `partnerRegistry`,
  `houseModule`, `ponsVerifier`, `stockVerifier`, `auctionConverter`, `wethWrapperHook`, `principalLock`, `poolManager`,
  `multicall3`.

## Wallet helpers (EIP-1193)

- `walletClientFromProvider(provider, chain, account?)` → viem `WalletClient` over any EIP-1193 provider.
- `switchWalletChain(provider, chain)`: `wallet_switchEthereumChain`, adding the chain first on 4902. The add always uses
  flipper's hard-coded `PUBLIC_RPC_URLS[chain.id]` and explorer, never `chain`'s RPC, so an overridden read RPC is never
  saved into the user's wallet. A chain without a hard-coded RPC isn't added: it throws `FlipperError`, asking the
  user to add it themselves.
- `isEip1193Provider(x)`, `rpcErrorCode(err)`, type `Eip1193Provider`.

## flipper API (token index)

```ts
import { createFlipperApi, listingTargetFromApi } from "@flipperdotfamily/sdk";
const api = createFlipperApi({ url: deployment.apiUrl!, partner: "acme" }); // partner → X-Flipper-Partner header (unauthenticated attribution)
const page = await api.tokens({ q: "tsla", limit: 40, offset: 0 });       // { tokens, sections, total, next }
const { token, pools } = await api.token("0x…");                          // one token, every eligible pool
```

Only public, CORS-open reads are used, with no credentials. `tokenSection(t)` gives the picker group: `listed`
(flippable), `eligible` (listable) or `unsupported`. Reads are rate-limited per end-user IP (20/s): debounce searches.

## Listing by venue (permissionless)

Anyone can list an eligible token. Each venue has its own route adapter:

| Venue | Adapter | Call |
|---|---|---|
| `v4` | V4RouteAdapter | `registerAndList(token, poolKey)` |
| `v3` | V3RouteAdapter (bridged into v4 by the V3BridgeHook) | `registerAndListV3(token, v3Pool)` |

```ts
const target = listingTargetFromApi(token);        // from the API's best pool: { venue: "v4", token, key } | { venue: "v3", token, pool } | …
const check = await flipper.checkListing(target);  // adapter check() then a dry run; never throws
if (check.ok) await flipper.list(target, { onSent: (hash) => console.log("sent", hash) });
else console.log(check.reason, check.code, check.routeCostBps);
```

- `v4CheckReason(code)` and `v3CheckReason(code)` map the adapters' `check()` codes. The v3 adapter adds 9
  NOT_V3_POOL, 10 LISTED_ELSEWHERE and 11 IS_WETH.
- `isV3Hop(poolKey, addresses)` says whether a route hop is a Uniswap v3 pool (its `hooks` is the `v3Bridge`).
- Addresses: `v4Adapter`, `v3Adapter`, `v3Bridge`.

## Native ETH

The house flips WETH. `flipEth` wraps and flips in one call:

```ts
const res = await flipper.flipEth({ amount: parseEther("0.01"), approve: "max", onStep: (s) => console.log(s.step) });
// steps: previewing → (batch-signing → batch-sent) | (wrapping → wrap-sent → approving → approve-sent → signing → flip-sent) → requested
await flipper.waitForSettlement(res.flipId, { fromBlock: res.receipt.blockNumber });
await flipper.unwrapWeth(winnings);                // winnings arrive as WETH
```

- **Batching.** When the wallet reports atomic batching (EIP-5792 `wallet_getCapabilities`), wrap + approve + flip
  go out as one `wallet_sendCalls` (one confirmation, `res.batched === true`). Otherwise they are sequential
  transactions. `batch: "never"` forces the sequential path.
- **WETH must be listed.** If it isn't, the call throws a `FlipperError` with `details.errorName === "WethNotListed"`;
  list it with `checkListing` / `list` (anyone can).
- Helpers: `weth()`, `wrapEth(amount)`, `unwrapWeth(amount)`, `supportsAtomicBatch()`.

## Core client

```ts
import { createFlipperClient, oddsShift, rejectReason, describeSettlement } from "@flipperdotfamily/sdk";
import { createPublicClient, createWalletClient, custom, http, parseUnits } from "viem";

const flipper = createFlipperClient({
  publicClient,                      // any viem PublicClient (e.g. wagmi's usePublicClient())
  walletClient,                      // optional; needed for flip / claim / listToken
  addresses: { house, lens, rewards, v4Adapter },
});

const amount = parseUnits("100", 18);
const pv = await flipper.preview(token, amount);          // eth_call (previewFlip isn't a view)
if (pv.code !== 0) console.log(rejectReason(pv.code, { symbol: "WETH" })?.message);

const { terms } = await flipper.house();
// The house sponsors route costs (LP/hook fees + price impact) out of its edge. The odds only move once the house's
// expected profit would drop below minHouseEdgeBps (2%): winChance = min(base, (1 − routeCost − minHouseEdge) / 2),
// i.e. from about an 8% route cost at the launch base of 45%. `terms` is the base now (see "Edge schedule").
const shift = oddsShift(pv, terms);
if (shift.shifted) console.log(shift.message);           // "The odds for this flip are shifted 1.25% due to token fees"
const { amount: fullOdds } = await flipper.maxStake(token, balance, true); // largest stake at base odds

const { flipId, receipt } = await flipper.flip({ token, amount, onStep: (s) => console.log(s.step) });
const settled = await flipper.waitForSettlement(flipId, { fromBlock: receipt.blockNumber });
console.log(describeSettlement(settled, { symbol: "WETH", decimals: 18 }).headline);
```

`flip()` does the following, in order:
1. Takes a fresh preview and throws `FlipperError` (kind `rejected`) when the house would reject.
2. Approves exactly `amount` if the allowance is short, and waits for that approval.
3. Simulates and sends `flip(token, amount, minWinChanceBps = preview.winChanceBps, deadline = now + 5 min)`. `msg.value` is `randomnessFeeToSend(token, fee)`: the per-token randomness fee exactly when the adapter's fee is flat (Dice, Pyth Entropy), or × 1.2 (`paddedRandomnessFee`) when it's gas-priced (Chainlink VRF-style, priced at tx.gasprice; the house refunds the excess). Show users the unpadded fee.
4. Returns the `flipId` from the `FlipRequested` log.

`onStep` reports `previewing → approving → approve-sent → signing → flip-sent → requested`.

**Gas-price-aware fees.** With a Chainlink VRF v2.5-style wrapper, the randomness fee is
`gasPrice × (callbackGas + overhead) × premium + L1 cost`, evaluated at the transaction's gas price. An eth_call
without a gas price therefore quotes ~0. To handle that:
- **Reads:** every fee-bearing read (`preview`, `previews`, `maxStake`, `randomnessFeeFor`, `house`) is evaluated at an explicit `gasPrice`, with explicit gas and a balance-overridden sender (`SIMULATION_ACCOUNT`).
- **Gas pricing:** `gasFees()` is the quote: 5/3 × base fee + tip (never below `eth_gasPrice`), with the tip forced to 0
  on Arbitrum-family chains such as Robinhood Chain. Fee-bearing reads are evaluated at its `maxFeePerGas`.
  Writes are sent with `txFees(quote)` (`client.sendFees()`), a cap of 1.2 × the quote = 2 × base, so a base fee
  that doubles before inclusion still clears. You pay the effective price, never the cap.
- **Displayed fee:** `displayRandomnessFee(token)` evaluates the fee at `expectedGasPrice()` (base fee + tip).
- **Sent fee:** `flip()` sends `randomnessFeeToSend(token, fee)`. `randomnessFeeIsGasPriced(token)` probes once per
  client, quoting `randomnessFeeFor` at two gas prices:
  - A flat fee (Dice, Pyth Entropy) is sent exactly. Padding it would buy nothing, and the house's refund of the
    excess fails for a contract wallet without `receive()`.
  - A gas-priced fee (Chainlink VRF) is sent × 1.2 (`paddedRandomnessFee`) of the fee quoted at `maxFeePerGas`, which
    covers any price up to the transaction's cap. The house charges at `tx.gasprice` and refunds the excess.
  - If the probe fails, the fee is padded, and the probe runs again next time.

Entropy-style providers don't price by gas: on Robinhood Chain, flips draw from Dice Protocol's `DiceEntropy`, whose fee
is a flat 0.000025 ETH per flip (about $0.07) whatever the gas price and callback budget. The same code handles both
kinds; the gas-priced path matters for VRF-style adapters such as the dev forks' stand-in.

**Lifecycle**
- `waitForSettlement(flipId)` resolves once the flip leaves Pending. It returns a `Settlement` with the status and the `FlipSettled`, `PendingWinResolved` and `FlipCancelled` logs.
- `waitForResolution(flipId)` follows a `WinPending` flip until upkeep (or anyone, `resolvePendingWin(flipId)`) pays it.
- `settlement.resolved` / `getFlipEvents().resolved` / `resolvePendingWin()` report what the player received:
  `tokenPaid` (the winnings, status `Won`) or `flipperPaid` (the $FLIPPER fallback, status `WonFallback`), and
  `flipperSpent`, what the house spent buying the winnings. The raw `PendingWinResolved` event's `flipperPaid` is
  that spend on a `Won` resolution, not a payment; `normalizePendingWinResolution(raw, status)` does the mapping.
- Pending wins: `pendingWins(player)`, `canResolvePendingWin(flipId)`, `resolvePendingWin(flipId)`, `resolveAt(flip)`.
- `describeSettlement()` returns player-facing copy for every status: Won, WonFallback, WinPending, Lost, LostInventory, Refunded, and safe-mode credits.
- Deferred flips (drawdown circuit breaker, below): `waitForSettlement(flipId, { onDeferred })` calls `onDeferred` once
  when the flip's randomness arrived while the protocol was locked, and keeps waiting (without timing out) until it
  settles. Without `onDeferred`, the timeout throws a `FlipperError` whose `details.errorName` is `"SettlementDeferred"`.
  `settlement.deferred` / `getFlipEvents().deferred` hold the `SettlementDeferred` log, and `settlement.partner` /
  `getFlipEvents().partner` the flip's `FlipPartner` terms.

| Method | Notes |
|---|---|
| `house()`, `params()`, `randomnessFeeFor(token)` | lens `HouseView` plus `terms`, the base terms now (show those, not `params`' launch values); the fee is per-token (FLIPPER flips are cheaper) |
| `baseTerms()`, `edgeProgress()` | the base win chance, $FLIPPER payout and Kelly multiplier now; the edge schedule's progress (see "Edge schedule") |
| `preview(token, amount)`, `previews(token, amounts)` | eth_call with explicit gas |
| `maxStake(token, hi, baseOdds?)` | the largest stake the house accepts for this flip (with `baseOdds`: at the base win chance). Each flip's max is sized to its own edge (see "Max bet"), so it's found by previewing: `FlipperLens.maxStake` for $FLIPPER, a client-side preview search otherwise; with a `partner`, every preview carries the partner suffix |
| `flip(opts)`, `waitForSettlement`, `waitForResolution`, `getFlips(ids)`, `getSettlement`, `getFlipEvents`, `findFlipIds(player, fromBlock)` | |
| `claimables(user, tokens, { eth? })`, `claim(token)`, `claimableEth(user)` | payments credited instead of pushed (safe mode, failed transfer). The list ends with native ETH (`token: zeroAddress`, `native: true`): a randomness-fee excess the house couldn't refund, e.g. to a contract wallet without `receive()`; `claim(zeroAddress)` withdraws it. `{ eth: false }` leaves it out |
| `flipLimits()`, `openFlips(player)`, `minStake(token)` | per-player limits: `{ maxOpenPerPlayer, minLiability }` (see "Flip limits") |
| `surplus(token)` | `lens.surplus`: the house's balance of `token` (`zeroAddress`: ETH) less what it owes in it. Should read 0; negative means a claim could fail |
| `v4Check(token, key)`, `canRegisterAndList(token, key)`, `registerAndList(token, key)` | listing a Uniswap v4 pool through the V4RouteAdapter (whitelisted tokens and pools, or launchpad tokens a verifier vouches for) |
| `discoverV4Tokens(opts?)` | resumable PoolManager `Initialize` scan + `adapter.check` via multicall → deepest valid pool per token |
| `holderRewards(user?)`, `claimHolderRewards()`, `claimStakingRewards()` | $FLIPPER holder rewards, built into the token: the stream (rate, `periodFinish`, totals) and `user`'s claimable (wallet and staking), lifetime and estimated per-day earnings; `token.claim()` / `vault.claimRewards()` |
| `harvest()`, `revenueRouter()` | `RevenueRouter.harvest()` (anyone): streams the holders' share to the token. The API's upkeep worker runs it; useful in dev tools |

Errors: every write rethrows a `FlipperError` whose message is plain English. `describeError(err)` does the same for any viem error. It matches errors by name, so it works across viem copies.

## Partners (ERC-8021)

A partner code approved in the `PartnerRegistry` earns a share of each flip it brings (on losing flips, a cut of the
house's expected profit, by tier) and can hand part of it back to its players as better odds.

```ts
const flipper = createFlipperClient({ publicClient, walletClient, addresses, partner: "acme" });
const pv = await flipper.preview(token, amount);   // the partner's odds (the call carries the suffix, from the player)
await flipper.flip({ token, amount });              // the flip calldata ends in the suffix: attributed onchain
```

- `partner` is a code of 1–32 `[a-z0-9_-]` (`isPartnerCode`). The client reads `registry.suffixOf(code)` once, the
  first time it needs it (the registry from `addresses.partnerRegistry`, else `house.partnerRegistry()`), and appends
  it as viem's `dataSuffix` to `flip`, `flipEth` (the batched flip call too) and `preview`. `previews` goes through the lens
  and stays at base odds; `maxStake` previews with the suffix. No registry, or an invalid code: nothing is appended.
- `partnerSuffix()` → the suffix (or undefined); `partnerRegistry()` → its address (or null).
- House: `flipPartner(flipId)` → `{ partnerId, shareBps }` (0n: none), `partnerAccrued(id)`, `partnerAccruedTotal()`,
  `claimPartner(id)` → `{ receipt, amount }` (anyone may call; it pays the partner's current payout address).
- Registry: `partnerInfo(id)` → `{ id, code, controller, payout, discountBps, tier, status, allowSelf }` (status 1
  pending, 2 approved, 3 suspended), `partnerIdOfCode(code)`, `partnerTierCutBps(tier)`, `registerPartner({ code, payout,
  discountBps })` → `{ receipt, id }`, and, for the partner's controller, `updatePartner(id, { payout } | { discountBps }
  | { controller })`. Approval, tiers and suspension are the registry owner's (`partnerRegistryAbi`).
- A player can't attribute their own flips (player = the partner's payout or controller) unless the owner allows it.

## Drawdown circuit breaker

If the bankroll's NAV per unit (in $FLIPPER) falls below half its all-time high, the protocol locks until the
unlocker reopens it.
- `locked()`; `breaker()` → `{ locked, navUnits, navAth, lockMinTreasury, unlocker, pendingUnlocker }`;
  `checkDrawdown()` runs the check (anyone may).
- While locked, `preview().code` is `RejectCode.LOCKED` (8) and flips, claims (house, partner, holder rewards on the
  token), listings, vault actions and harvests revert with `ProtocolLocked`. Both read as `PROTOCOL_LOCKED_MESSAGE`:
  "Flips are paused while the treasury is protected. In-flight flips settle after it reopens."
- In-flight flips aren't lost: randomness delivered while locked is recorded (`SettlementDeferred`), and after the unlock
  anyone settles it, market-free: `isDeferred(flipId)`, `canSettleDeferred(flipId)` (dry run: `{ ok }` or `{ ok: false,
  reason, locked?, notDeferred? }`), `settleDeferred(flipId)` → `{ receipt, settlement? }`.
- `InsufficientGas` (a transaction sent with too little gas for a gas-floored step) has its own message too.
- `HouseParams.maxReservedBps`: the cap on all pending liabilities, as a share of the treasury.
- The unlocker's tools: `unlock(resetAth)` (`true` re-bases the high to today's NAV), and `resetNavAth(newAth)` (`0n` =
  today's NAV; an out-of-range value reverts `AthOutOfBounds`, which has its own message).

## Edge schedule

The base terms step down as the house's own net buybacks grow, and never step back up: 45% at 2× (2.05× on $FLIPPER)
below 10 ETH, 47.5% at 2× on both at 350 ETH and above, linear in between and rounded in the house's favour. That is a
10% edge on token flips and 7.75% on $FLIPPER at launch, 5% on both at the end. Net buybacks are the real ETH the
house's settlement swaps move into the $FLIPPER/ETH pool (+ lost token stakes sold, − wins bought); the edge keys on
their ratcheted high, so only real losses paid into the house move it. Route costs, partner discounts and the 2%
minimum edge still apply per flip, and a flip keeps the terms it was made at.
- `house().terms` / `baseTerms()` → `{ baseWinChanceBps, flipperPayoutBps, kellyBps, scheduled }`: the house's
  `currentBaseWinChanceBps()`, `currentFlipperPayoutBps()` and `currentKellyBps()`. Field names match `HouseParams`, so
  `oddsShift(preview, terms)` and `payoutBps(token, flipper, terms)` take it directly. A house from before the schedule
  answers from `params()` (`scheduled: false`).
- `edgeProgress()` → `{ netBuybackEth, buybackHigh, fromEth, toEth, winStartBps, winEndBps, payoutStartBps,
  payoutEndBps, baseWinChanceBps, flipperPayoutBps, progress, tokenEdgeBps, flipperEdgeBps }` (`progress` 0–1), or
  null when the house has no schedule.
- `formatWinChance(bps)` ("45%", "46.25%") and `formatMultiple(bps)` ("2.025×") never round above what the house
  gives; `houseEdgeBps(winChanceBps, payoutBps)` is the house's expected profit at those terms.

## Max bet: each flip's max is sized to its own edge

The house caps a flip's liability at min(`maxBetBps`, k × f*) of the unreserved treasury, where f* is the flip's
Kelly fraction at its final odds and partner share, and k is the Kelly multiplier now: half Kelly at the bankroll's
NAV-per-unit high, sliding linearly to quarter Kelly at a 50% drawdown (where the breaker locks), so bets shrink as a
losing streak deepens. A flip with a thin edge (expensive routes, a big partner cut) gets a smaller max than a flip
with a fat one.
- `preview().maxLiability` is that flip's own cap. `house().maxLiability` is only the 5% ceiling: don't size a "max"
  from it. `maxStake()` searches previews, so it's Kelly-aware (and partner-aware with a `partner`).
- Above the cap, previews and flips reject with `RejectCode.BET_SIZE` (7).
- `HouseParams.kellyBps` is the maximum (0 on a house from before the cap); `terms.kellyBps` is the multiplier in force.

## Flip limits

The randomness adapter caps open requests globally, so the house keeps one player from holding that capacity with dust:
- **Too many open flips:** a player may have at most `maxOpenPerPlayer` flips waiting for randomness (4 by default:
  `DEFAULT_MAX_OPEN_PER_PLAYER`). Beyond it, previews and flips reject with `RejectCode.TOO_MANY_OPEN` (9), which reads
  as `TOO_MANY_OPEN_MESSAGE`: "You have too many flips in progress. Wait for one to land." `openFlips(player)` counts
  them. Previews run from the connected account, so code 9 shows before the flip.
- **Minimum size:** a flip's liability must reach `minLiability` $FLIPPER (50,000 at launch). Below it, previews and
  flips reject with `RejectCode.AMOUNT` (2), which now reads as `BELOW_MIN_SIZE_MESSAGE`: "This flip is below the
  minimum size." (`key: "BELOW_MIN"`; a zero stake, `rejectReason(2, { amount: 0n })`, still reads "Enter an
  amount"). `minStake(token)` gives the smallest stake that clears it: exact for $FLIPPER (the liability is 1.05 × the
  stake), found from a few previews for other tokens (a hair above the true minimum), 0n with no floor, null when
  the token can't be priced. Pass it to `rejectReason(2, { symbol, amount, minStake, decimals })` to name it.
  `estimateMinStake(amount, liability, minLiability)` extrapolates from a preview you already have.
- `flipLimits()` → `{ maxOpenPerPlayer, minLiability }`. A house from before the limits reads as the default cap and no
  floor.

## Team stake (`PrincipalLock`)

The team's 12.5% of vault shares, locked for good: the principal can never be withdrawn; only the value above it can,
to an immutable dev address, where the stake's rewards are swept too.
- `teamStake()` → `{ lock, principal, value, withdrawableExcess, pendingVaultRewards, pendingHolderRewards, devAddress,
  pendingRequest: { shares, assets, readyAt } | null, requestableExcess }` (from `pendingWithdrawal`), or null without
  `addresses.principalLock`. `withdrawableExcess` is capped at the vault's free bankroll. `requestableExcess` is what
  a MAX request asks for: show it as the "MAX".
- `sweepTeamRewards("all" | "vault" | "holder")` → `{ receipt, vaultRewards, holderRewards }` (anyone may).
- The dev address only (checked before sending, with a plain-English error otherwise): `requestTeamExcess(amount |
  "max", { cushionBps? })` ($FLIPPER; it also sweeps), then `withdrawTeamExcess()` → `{ receipt, amount }` after the
  vault's cooldown (pays the dev address and sweeps both reward sources), or `cancelTeamExcess()`.
- **MAX leaves a cushion.** `"max"` (or `maxUint256`) requests the unqueued excess less 1% of the principal
  (`TEAM_EXCESS_CUSHION_BPS`; `teamExcessMax(principal, withdrawableExcess, queued, cushionBps)`), never negative.
  Requesting all of it often ends in `PrincipalBreach` at low volume, when the stake's value dips before the
  withdrawal completes. `{ cushionBps: 0n }` with `maxUint256` sends the contract's own "everything". Nothing above
  the cushion: a plain-English error before anything is sent.
- The lock's reverts (`ExceedsExcess`, `PrincipalBreach`, `AlreadyStaked`, and the vault's `ProtocolLocked`, …) read as
  plain English.

## Any Uniswap v4 token (V4RouteAdapter)

```ts
const flipper = createFlipperClient({ publicClient, walletClient, addresses: { house, lens, v4Adapter } });
const { tokens, progress } = await flipper.discoverV4Tokens({ store: indexedDbStore, maxChunks: 120 });
// call again until progress.done: each call scans ≤ maxChunks more 10k-block ranges (newest first) and resumes
// from the store; tokens are sorted by pool depth, each with `v4: { key, depthWei, quote }`
await flipper.registerAndList(tokens[0].address, tokens[0].v4!.key);
```

The scan starts at the PoolManager's first `Initialize` (Robinhood Chain block 9,505; `KNOWN_POOL_MANAGERS` holds the
start blocks by chain id). On Robinhood Chain (~200k pools) you need a server index instead: pass `pools` (for example from
`parseV4PoolIndex(await (await fetch(url)).json())`) to `discoverV4Tokens` and it skips the scan. Pools are
pre-filtered locally before `check()`:
- the other side of the pool must be native ETH or one of `quoteCurrencies()`
- the hook must be zero or `isHookAllowed`

Other behaviour:
- **Excluded tokens:** quote currencies, stablecoins and WETH are never offered as tokens (`QUOTES_AND_STABLES` per chain, plus the adapter's `quoteCurrencies()`).
- **Labels:** pons v2 graduations, whose pools use the meme hook, get `kind: "pons"`.
- **Batching:** checks run in sequential multicall groups, which keeps rate-limited RPCs (Robinhood: ~3 req/s) happy.
- **Caching:** `check()` results are cached for 5 minutes, and ERC-20 metadata is cached per address.
- **Reason codes:** `v4CheckReason(code)` maps the adapter's reason codes to plain English.
- **JSON transport:** `encodeDiscovered` / `decodeDiscovered` carry results through JSON, for example a server route.

## Default avatars (`@flipperdotfamily/sdk/avatar`)

Every address gets a default profile picture in the flipper.family icon's format: a flippered animal's silhouette on a
deep-ocean gradient disc. There are 25 animals, including orca, narwhal, walrus, sea turtle, puffin, manta ray and
plesiosaur. The dolphin is left out because it's the brand mark. The same address gives the same avatar everywhere, so a
partner app, the mobile SDKs and flipper.family all show a user the same one. The subpath is dependency-free and
separate from the main entry, so importing it adds nothing else to your bundle.

```ts
import { avatarDataUri, avatarSpec, avatarSvg } from "@flipperdotfamily/sdk/avatar";

avatarSvg("0x5aAe…eAed", { size: 32 });             // "<svg …>": inline it, or hand it to react-native-svg's <SvgXml>
avatarSvg(address, { size: 64, title: "alice.eth" }); // labelled image (role="img" + <title>); decorative by default
img.src = avatarDataUri(address, { size: 40 });      // "data:image/svg+xml,…" for <img>, CSS or a native image view
avatarSpec(address);                                 // { animal, disc, tint, angle, highlight, seed, … }
```

- **Case and whitespace don't matter.** Checksummed and lowercase addresses give the same avatar. Any string works as
  the input, an ENS name for example.
- **`size`** sets `width` and `height`. The `viewBox` is always the icon's `0 0 64 64`, and the rim never drops below 0.75px.
  The default is 64.
- **`idPrefix`** scopes the SVG's internal gradient ids. The default comes from the address, so two different avatars
  inlined on one page never collide. Pass your own prefix (React's `useId()`, for example) when you inline the same
  address twice. A data URI doesn't need this, because its ids are private to the image.
- **Combinations.** Version 2 has 33,600: 25 animals × 14 discs × 6 tints per disc × 4 gradient angles × 4 highlight
  positions. Every tint pairs only with discs it has at least 4.5:1 contrast against.
- **Raw data.** For native renderers, `AVATAR_SILHOUETTES` holds each animal's path data (64 × 64 frame, evenodd) and
  `AVATAR_DISCS` / `AVATAR_TINTS` hold the gradients. [`src/avatar/SOURCES.md`](src/avatar/SOURCES.md) records where
  every shape came from (CC0 / public-domain PhyloPic silhouettes, or hand-built). Standalone icon files are in
  `assets/avatars/`.
- **Porting.** The algorithm is version 2 of `AVATAR_VERSION`:
  - the seed is FNV-1a 32 over the UTF-8 bytes of `address.trim().toLowerCase()`;
  - a SplitMix32 stream picks, in order, the animal, disc, tint slot, angle and highlight, each as `next() % size`.

  The test suite's golden vectors pin the output, and a port must reproduce them.
- **The tables are append-only.** An avatar is a set of indices into `AVATAR_SILHOUETTES`, `AVATAR_DISCS`,
  `AVATAR_TINTS`, `AVATAR_ANGLES` and `AVATAR_HIGHLIGHTS`. Reordering, removing or editing an entry reshuffles every
  user's avatar. New entries go at the end, and are used only after `AVATAR_VERSION` and `AVATAR_TABLE_SIZES` are
  bumped, which is a deliberate, announced reshuffle.

## Legacy: `<FlipWidget />` (`@flipperdotfamily/sdk/react`)

Superseded by [`@flipperdotfamily/react`](../react), which wraps the framework-agnostic `<flipper-widget>` and takes any
EIP-1193 provider. This entry stays for existing wagmi integrations.

```tsx
"use client";
import { FlipWidget } from "@flipperdotfamily/sdk/react";

// inside your existing <WagmiProvider> + <QueryClientProvider>, with Robinhood Chain (4663) in the wagmi config
<FlipWidget
  token="0x…"                                               // the token to flip (listed, or $FLIPPER)
  addresses={{ house: "0x…", lens: "0x…" }}                 // or registerFlipperAddresses(4663, {...}) once
  theme="dark"                                              // "dark" | "light"
  onSettled={(s) => console.log(s.won, s.status)}
  onConnect={() => openYourConnectModal()}                  // called when a disconnected user presses the button
/>
```

**What the widget includes**
- a mini CSS-3D coin that floats, spins while randomness is pending and lands on the drawn face
- an amount input with MAX
- win chance, payout multiple and potential payout, the randomness fee, and the odds-shift note with a "flip X or less" suggestion
- plain-English reject reasons
- the flip button with approve → flip states and network switching
- the result, including WinPending → resolved, and a claim link for safe-mode credits

**Styling**
- Styles are self-contained. There is one scoped stylesheet (`.flw` / `.flw-*`), injected through React 19's `<style href precedence>`, so it is deduplicated and works with SSR.
- The host doesn't need Tailwind or a CSS pipeline.
- Fonts use the same tokens as flipper.family (Satoshi for display, Manrope for UI, JetBrains Mono for numbers) when the host loads them, and fall back to the system stack otherwise.

## ABIs

The files in `src/abis/*.ts` are generated from the Foundry artifacts and committed, so builds don't need Foundry.

```sh
cd contracts && forge build
pnpm --filter @flipperdotfamily/sdk gen:abis     # FOUNDRY_OUT=/path/to/out to point elsewhere
pnpm --filter @flipperdotfamily/sdk build        # tsup → dist (esm + d.ts)
```
