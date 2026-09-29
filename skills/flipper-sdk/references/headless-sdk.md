# Headless: `@flipperdotfamily/sdk`

Use the SDK when the user wants their **own UI** (not the widget), or needs server-side reads such as verifying
flips, indexing results, or showing house stats. It is built on viem and has no framework dependency. The widget
uses this same client internally (`el.client`).

```sh
pnpm add @flipperdotfamily/sdk viem     # viem ^2 is a peer dependency
```

- In React, `useFlipperClient({ provider?, walletClient?, chainId?, rpcUrl?, addresses?, deploymentUrl? })` from
  `@flipperdotfamily/react` builds the same client and returns `{ client, deployment, chain, loading, error }`.
- `@flipperdotfamily/sdk/react` (`<FlipWidget />`) is **legacy**. Don't use it for new integrations.

## 1. Deployment, clients, wallet

```ts
import { createFlipperClient, flipperChain, resolveDeployment, walletClientFromProvider, switchWalletChain } from "@flipperdotfamily/sdk";
import { createPublicClient, http, type Address } from "viem";

// live addresses, RPC and API from https://flipper.family/embed/deployment.json
const deployment = await resolveDeployment({ chainId: 4663 }); // Robinhood Chain (the default)
const chain = flipperChain(deployment);  // a viem Chain with the deployment's RPC and explorer (also the wallet_addEthereumChain params)
const publicClient = createPublicClient({ chain, transport: http(deployment.rpcUrl, { batch: true }) });

// the app's connected EIP-1193 provider; get the account from the app's wallet state
const provider = connectedProvider;
const account = connectedAddress as Address;
await switchWalletChain(provider, chain);  // wallet_switchEthereumChain, adding the chain on 4902
const walletClient = walletClientFromProvider(provider, chain, account);

export const flipper = createFlipperClient({
  publicClient,
  walletClient,                                   // omit for read-only use
  addresses: deployment.addresses,
  partner: "acme",                                // optional: a registered partner code, attributed onchain
});
```

**Partners.** With `partner` set to a code approved in the PartnerRegistry (1–32 of `a-z 0-9 _ -`), the client fetches
the code's ERC-8021 suffix once (`registry.suffixOf`) and appends it to `flip`, `flipEth` and `preview`, so previews
show the partner's odds and each flip is attributed onchain. Partner accounting: `flipPartner(flipId)`,
`partnerAccrued(id)`, `claimPartner(id)` (anyone; pays the partner's payout address), `partnerInfo(id)`,
`registerPartner({ code, payout, discountBps })`, `updatePartner(id, …)`.

**`resolveDeployment({ chainId?, rpcUrl?, apiUrl?, addresses?, deploymentUrl? })`**
- It returns `{ chainId, liveChainId, name, rpcUrl, apiUrl, explorerUrl, nativeSymbol, blockTimeMs, addresses }`.
- Explicit `addresses` with `house` + `lens` win, and nothing is fetched.
- Next come addresses from `registerFlipperAddresses(chainId, …)`.
- Otherwise it fetches the manifest. `deploymentUrl: null` forbids fetching.
- A chain with no deployment throws `DeploymentError` ("flipper isn't live on chain X yet").
- Local fork: `resolveDeployment({ chainId: 31337, deploymentUrl: "http://localhost:3000/embed/deployment.json" })`.

**With wagmi:**
- Pass `usePublicClient()` and `useWalletClient().data` to `createFlipperClient`. The wagmi config must include the
  flipper chain.
- Or use `useFlipperClient` from `@flipperdotfamily/react`.

## 2. Flip a token

```ts
import { FlipStatus, FlipperError, describeSettlement, oddsShift, parseAmount, rejectReason } from "@flipperdotfamily/sdk";

const house = await flipper.house();                     // { flipper, paused, params, terms, … }
if (house.paused) throw new Error("Flipping is paused");
const token = house.flipper;                             // $FLIPPER; any listed token works
const { symbol, decimals } = await flipper.tokenMeta(token);
const amount = parseAmount("100", decimals);             // bigint | null (null = invalid input)
if (amount === null) throw new Error("Enter an amount");

const pv = await flipper.preview(token, amount);         // eth_call; code 0 = OK
if (pv.code !== 0) throw new Error(rejectReason(pv.code, { symbol })?.message ?? "Flip rejected");
const shift = oddsShift(pv, house.terms);                // terms: the base odds and payout now (they improve as the protocol grows)
const fee = await flipper.displayRandomnessFee(token);   // wei of native ETH: show this (unpadded)

try {
  const res = await flipper.flip({
    token, amount, symbol, decimals,
    approve: "max",                                      // default "exact"; "max" skips later approvals
    onStep: (s) => setStep(s.step),                      // previewing → approving → approve-sent → signing → flip-sent → requested
  });
  let settled = await flipper.waitForSettlement(res.flipId, { fromBlock: res.receipt.blockNumber }); // default timeout 180 s
  if (settled.status === FlipStatus.WinPending) {
    // stake is back; upkeep pays the winnings shortly
    settled = await flipper.waitForResolution(res.flipId, { fromBlock: res.receipt.blockNumber });
  }
  const copy = describeSettlement(settled, { symbol, decimals, isFlipper: true }); // { headline, detail, fairness, tone, face, … }
  show(copy.headline, copy.detail);
} catch (err) {
  // every write throws a FlipperError with a plain-English message
  if (err instanceof FlipperError && err.kind === "user-rejected") return;
  showError((err as Error).message);
}
```

What `flip()` does:
1. Takes a fresh preview (it throws `FlipperError` kind `rejected` if the house would refuse).
2. Approves if the allowance is short.
3. Simulates, then sends `flip` with the randomness fee: exact for a flat-fee adapter (Dice, Pyth), padded ×1.2
   for a gas-priced one (Chainlink VRF; the house refunds the excess). `randomnessFeeToSend(token, fee)` gives the
   value.
4. Returns `{ flipId, hash, receipt, preview }`.

Other useful calls:
- `maxStake(token, balance, true)`: the largest stake at the base odds. Each flip's max is sized to its own edge (the
  house caps its liability at a half-Kelly share of the free bankroll, at the flip's odds and partner share), so size a
  "max" button with `maxStake` or `preview().maxLiability`, never with `house().maxLiability` (only the 5% ceiling).
- `previews(token, amounts)`
- `randomnessFeeFor(token)`
- `balanceOf(token, owner)`, `allowance(token, owner)`
- `getSettlement(flipId)`, `getFlipEvents(flipId)`, `findFlipIds(player, fromBlock)`
- `claimables(user, tokens)` / `claim(token)`, for payments credited in safe mode. The list ends with native ETH
  (`token: zeroAddress`, `native: true`), a fee refund the house couldn't push; `claim(zeroAddress)` withdraws it.

## 3. Native ETH

```ts
import { parseEther } from "viem";

try {
  const res = await flipper.flipEth({
    amount: parseEther("0.01"),
    approve: "max",
    batch: "auto",            // one wallet_sendCalls confirmation when the wallet supports EIP-5792; "never" = sequential
    onStep: (s) => setStep(s.step),
  });
  const settled = await flipper.waitForSettlement(res.flipId, { fromBlock: res.receipt.blockNumber });
  if (settled.won) {
    const weth = await flipper.weth();                  // winnings arrive as WETH
    const bal = await flipper.balanceOf(weth, account);
    if (bal > 0n) await flipper.unwrapWeth(bal);        // back to ETH (asks the user to sign)
  }
} catch (err) {
  if (err instanceof FlipperError && err.details.errorName === "WethNotListed") {
    // WETH isn't listed on this deployment yet: anyone can list it (see Listing)
  }
}
```

The sequential path runs wrap, then approve, then flip. The steps are `previewing`, then `batch-signing` →
`batch-sent`, or `wrapping` → `wrap-sent` → the flip steps, and finally `requested`.

## 4. Token list (the flipper API)

```ts
import { createFlipperApi, tokenSection, type ApiTokenPage } from "@flipperdotfamily/sdk";

if (!deployment.apiUrl) throw new Error("No flipper API on this deployment"); // fall back to flipper.listedTokens()
const api = createFlipperApi({ url: deployment.apiUrl, partner: "acme" });     // partner → X-Flipper-Partner

// debounce searches: public reads are rate-limited per end-user IP (20/s, burst 120)
let timer: ReturnType<typeof setTimeout> | undefined;
let inflight: AbortController | undefined;
export function search(q: string, render: (page: ApiTokenPage) => void) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    inflight?.abort();
    inflight = new AbortController();
    try {
      render(await api.tokens({ q, limit: 30, signal: inflight.signal })); // { tokens, sections, total, next }
    } catch {
      /* aborted, offline or rate-limited: keep the last results */
    }
  }, 250);
}
// tokenSection(t): "listed" (flippable) | "eligible" (listable) | "unsupported"; logos: t.logo
```

## 5. Listing (qualifying tokens: whitelisted tokens, and tokens covered by attached launchpad integrations)

```ts
import { listingTargetFromApi } from "@flipperdotfamily/sdk";

const { token } = await api.token(tokenAddress);         // tokenAddress: Address; 404 → FlipperApiError (status 404)
const target = listingTargetFromApi(token);              // { venue: "v4" | "v3" | …, … } | null
if (target) {
  const check = await flipper.checkListing(target);      // never throws
  if (check.ok) await flipper.list(target, { onSent: (hash) => console.log("listing sent", hash) });
  else console.log(check.reason, check.code, check.routeCostBps);
}
```

## 6. Server-side reads (no wallet)

```ts
const deployment = await resolveDeployment({ chainId: 4663 });
const publicClient = createPublicClient({ chain: flipperChain(deployment), transport: http(deployment.rpcUrl) });
const flipper = createFlipperClient({ publicClient, addresses: deployment.addresses });

const s = await flipper.getSettlement(123n);             // status, won, roll, flip, txHash…
const ids = await flipper.findFlipIds(player, 1_000_000n); // player: Address; from a block near the first flip
```

- Use a dedicated RPC for server work: public RPCs are rate-limited.
- Don't write code that handles private keys. If the user wants automated flips, they wire in their own signer, and
  you never see, store or log it.

## 7. Helpers

- **Formatting:** `formatTokenAmount(wei, decimals)`, `parseAmount(input, decimals)`, `formatBps(bps)`,
  `formatMultiple(payoutBps)`, `shortAddress(a)`.
- **Errors:** `describeError(err)` turns any viem error into plain English. `rpcErrorCode(err)` digs out the
  EIP-1193 code.
- **Chains:** `parseChainId("robinhood" | "local")`, `PUBLIC_RPC_URLS`, `DEFAULT_CHAIN_ID` (4663, Robinhood Chain),
  `LOCAL_CHAIN_ID` (31337), `WETH_ADDRESSES`.
- **Statuses:** `isWinStatus(status)`, and `FlipStatus.{Won, WonFallback, WinPending, Lost, LostInventory, Refunded}`.
- **Paused (drawdown circuit breaker):** `locked()` / `breaker()`. While locked, previews return `RejectCode.LOCKED`
  (8) and writes revert with `ProtocolLocked`; both read as `PROTOCOL_LOCKED_MESSAGE`. A flip whose randomness arrived
  meanwhile stays Pending: pass `onDeferred` to `waitForSettlement` to show "settling after pause", and settle it after
  the unlock with `canSettleDeferred(flipId)` / `settleDeferred(flipId)` (anyone may).
- **Flip limits:** at most `flipLimits().maxOpenPerPlayer` (default 4) flips per player waiting for randomness; beyond
  it, `RejectCode.TOO_MANY_OPEN` (9): "You have too many flips in progress. Wait for one to land." A flip's liability
  must reach `minLiability` (50,000 $FLIPPER at launch); below it, `RejectCode.AMOUNT` (2): "This flip is below the
  minimum size." `minStake(token)` gives the smallest accepted stake; pass it to `rejectReason(2, { symbol, amount,
  minStake, decimals })` to name it.

## Gotchas

- Amounts are `bigint` in token units (wei). Never use `Number` for them.
- `flipId` is a `bigint`. Convert with `.toString()` for JSON or keys.
- `displayRandomnessFee` is what to show (Dice Protocol's DiceEntropy: a flat 0.000025 ETH per flip, about $0.07).
  A flat fee like this is sent exactly (`randomnessFeeToSend`); only a gas-priced fee is padded, with the excess
  refunded.
- Pass `fromBlock: receipt.blockNumber` to `waitForSettlement`, or the log search scans far more blocks.
- A `WalletClient` without `account` throws "Connect a wallet first." on writes.
