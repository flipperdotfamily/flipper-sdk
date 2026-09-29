import type { Address, Hash, Hex, TransactionReceipt } from "viem";

/** Deployed protocol addresses. Only `house` and `lens` are required for flipping. */
export interface FlipperAddresses {
  house: Address;
  lens: Address;
  /** where holder rewards live: the $FLIPPER token itself (it streams $FLIPPER to holders); defaults to `flipper` */
  rewards?: Address;
  hookitAdapter?: Address;
  /** V4RouteAdapter: permissionless listing of any Uniswap v4 token (unvetted) */
  v4Adapter?: Address;
  /** V3RouteAdapter: permissionless listing of tokens whose best pool is a Uniswap v3 pool */
  v3Adapter?: Address;
  /** V3BridgeHook: a route hop whose PoolKey `hooks` is this address is a Uniswap v3 hop */
  v3Bridge?: Address;
  /** wrapped native token (flipping "ETH" wraps it and flips WETH); defaults per chain (`WETH_ADDRESSES`) */
  weth?: Address;
  /** Uniswap v4 PoolManager for the pool scan (default: the v4 adapter's, else KNOWN_POOL_MANAGERS[chainId]) */
  poolManager?: Address;
  /** $FLIPPER; read from the house when omitted */
  flipper?: Address;
  /** @deprecated holder rewards are paid in $FLIPPER itself; kept only for older address sets (e.g. a dev starter token) */
  rewardToken?: Address;
  /** RevenueRouter (`harvest()`); read from `house.revenueRouter()` when omitted */
  router?: Address;
  /** TreasuryVault (stake $FLIPPER into the bankroll for sFLIPPER); read from `house.vault()` when omitted */
  vault?: Address;
  /** PartnerRegistry (ERC-8021 flip attribution); read from `house.partnerRegistry()` when omitted */
  partnerRegistry?: Address;
  /** HouseModule: the house's cold paths, reached through the house (never called directly) */
  houseModule?: Address;
  /** ListingPolicy verifiers: pons launches, and Robinhood stock tokens */
  ponsVerifier?: Address;
  stockVerifier?: Address;
  /** DutchAuctionConverter: sells swept inventory for $FLIPPER */
  auctionConverter?: Address;
  /** WethWrapperHook: the WETH ⇄ ETH hook a route can end in */
  wethWrapperHook?: Address;
  /** PrincipalLock: the team's stake of vault shares, locked for good (only the excess over the principal is withdrawable) */
  principalLock?: Address;
}

/** FlipperHouseBase.Params */
export interface HouseParams {
  baseWinChanceBps: number;
  minWinChanceBps: number;
  flipperPayoutBps: number;
  /** guaranteed expected house profit per flip after route costs (2%); the house sponsors route costs above it */
  minHouseEdgeBps: number;
  maxRouteCostBps: number;
  lossSlippageBps: number;
  maxBetBps: number;
  /** share of each flip's expected profit paid to $FLIPPER holders */
  rewardsShareBps: number;
  /** permissionless listing: a probe-sized round trip must cost at most this */
  listingMaxRouteCostBps: number;
  listingProbeBps: number;
  callbackGasLimit: number;
  swapGasLimit: number;
  guardianCancelDelay: number;
  playerCancelDelay: number;
  minListingProbe: bigint;
  /** callback gas for $FLIPPER flips (no swaps), so their randomness fee is much lower */
  flipperCallbackGasLimit: number;
  /**
   * Seconds after a flip's `createdAt` from which its pending win (WinPending) can always be resolved: `resolvePendingWin`
   * then pays the reserved liability in $FLIPPER if the token still can't be bought. Before that it only succeeds when
   * the buy executes (anyone may call it).
   */
  pendingTimeout: number;
  /** cap on all pending flips' liabilities as a share of the treasury (0 = off) */
  maxReservedBps: number;
  /**
   * Edge-scaled half-Kelly cap: a flip's liability is at most min(`maxBetBps`, `kellyBps` × its Kelly fraction) of the
   * unreserved treasury, at its final odds and partner share (5000 = half Kelly; 0 on a house from before the cap).
   * This is the schedule's maximum: the multiplier in force backs off with the drawdown (`BaseTerms.kellyBps`).
   */
  kellyBps: number;
}

/**
 * The house's base terms now. With an edge schedule these step down from the launch terms as the house's own net
 * buybacks grow, so they can differ from `HouseParams.baseWinChanceBps` / `flipperPayoutBps` (which apply only when the
 * schedule is off). Field names match `HouseParams`, so a `BaseTerms` works wherever `oddsShift` / `payoutBps` take
 * params. A flip keeps the terms it was made at.
 */
export interface BaseTerms {
  /** win chance before route costs and partner discounts (4500 = 45%): `currentBaseWinChanceBps()` */
  baseWinChanceBps: number;
  /** payout on $FLIPPER flips (20500 = 2.05×; token flips pay 2×): `currentFlipperPayoutBps()` */
  flipperPayoutBps: number;
  /** the Kelly multiplier now (5000 = half Kelly), backed off with the drawdown: `currentKellyBps()` */
  kellyBps: number;
  /** false on a house from before the edge schedule: the win chance and payout are `params()`'s */
  scheduled: boolean;
}

/**
 * How the edge comes down as the protocol grows (`edgeProgress()` + `edgeSchedule()`). The base terms slide linearly
 * from the launch terms to the end terms as `buybackHigh` goes from `fromEth` to `toEth`, rounded in the house's favour.
 */
export interface EdgeProgress {
  /** net ETH (wei) the house's settlement swaps have moved into the $FLIPPER/ETH pool: + lost token stakes sold, − wins bought */
  netBuybackEth: bigint;
  /** the ratcheted high of `netBuybackEth`: the edge keys on this, so it only ever steps down */
  buybackHigh: bigint;
  /** where the edge starts coming down, and where it reaches its end (ETH wei) */
  fromEth: bigint;
  toEth: bigint;
  winStartBps: number;
  winEndBps: number;
  payoutStartBps: number;
  payoutEndBps: number;
  /** the base terms at `buybackHigh` now */
  baseWinChanceBps: number;
  flipperPayoutBps: number;
  /** 0 below `fromEth`, 1 at or past `toEth` */
  progress: number;
  /** the house's expected profit at the base terms (bps of the stake): token flips on a free route, and $FLIPPER flips */
  tokenEdgeBps: number;
  flipperEdgeBps: number;
}

/** FlipperHouseBase.Preview (all amounts in token / $FLIPPER wei, chances in bps) */
export interface Preview {
  code: number;
  sellQuote: bigint;
  buyQuote: bigint;
  routeCostBps: bigint;
  winChanceBps: bigint;
  liability: bigint;
  maxLiability: bigint;
  randomnessFee: bigint;
}

/** FlipperLens.HouseView */
export interface HouseView {
  flipper: Address;
  treasury: bigint;
  reserved: bigint;
  maxLiability: bigint;
  rewardsAccrued: bigint;
  randomnessFee: bigint;
  paused: boolean;
  listedTokens: bigint;
  nextFlipId: bigint;
  params: HouseParams;
  /** added by the client (not in the lens view): the base terms now, which is what to show as the odds and payout */
  terms: BaseTerms;
}

/** FlipperLens.TokenView */
export interface TokenView {
  token: Address;
  name: string;
  symbol: string;
  decimals: number;
  enabled: boolean;
  blocked: boolean;
  adapter: Address;
  hops: bigint;
}

/** FlipperLens.FlipView */
export interface FlipView {
  id: bigint;
  player: Address;
  createdAt: number;
  winChanceBps: number;
  roll: number;
  status: number;
  token: Address;
  amount: bigint;
  liability: bigint;
  sellQuote: bigint;
  buyQuote: bigint;
  requestId: bigint;
  /** $FLIPPER payout multiple (and token-flip fallback bonus = payoutBps/2), fixed at flip time */
  payoutBps: number;
}

export interface FlipRequestedEvent {
  flipId: bigint;
  player: Address;
  token: Address;
  amount: bigint;
  winChanceBps: bigint;
  sellQuote: bigint;
  buyQuote: bigint;
  liability: bigint;
  requestId: bigint;
  randomnessFee: bigint;
}

export interface FlipSettledEvent {
  flipId: bigint;
  player: Address;
  token: Address;
  won: boolean;
  roll: bigint;
  status: number;
  tokenPaid: bigint;
  flipperPaid: bigint;
  flipperReceived: bigint;
  safeMode: boolean;
}

export type FlipStep =
  | { step: "previewing" }
  | { step: "approving" }
  | { step: "approve-sent"; hash: Hash }
  | { step: "signing" }
  | { step: "flip-sent"; hash: Hash }
  | { step: "requested"; hash: Hash; flipId: bigint };

export interface FlipResult {
  flipId: bigint;
  hash: Hash;
  receipt: TransactionReceipt;
  preview: Preview;
  requested: FlipRequestedEvent;
}

export interface Settlement {
  flipId: bigint;
  /** current onchain status (a WinPending flip later becomes Won / WonFallback) */
  status: number;
  won: boolean;
  roll: number;
  flip: FlipView;
  /** the FlipSettled log, when it could be fetched */
  event?: FlipSettledEvent;
  txHash?: Hash;
  /** settled market-free: payouts were credited to `claimable` instead of pushed */
  safeMode: boolean;
  /**
   * PendingWinResolved, normalised to what the player received. `Won` (the winnings were bought): `tokenPaid` = the
   * winnings, `flipperPaid` = 0, `flipperSpent` = the $FLIPPER the house spent buying them. `WonFallback` (paid after
   * the timeout): `tokenPaid` = 0, `flipperPaid` = the $FLIPPER paid instead, `flipperSpent` = 0. (The raw event's
   * `flipperPaid` is the house's spend on a Won resolution, not a payment.)
   */
  resolved?: PendingWinResolution;
  /** FlipCancelled: randomness never arrived and the flip was refunded */
  cancelled?: { by: Address; txHash: Hash };
  /**
   * SettlementDeferred: the randomness arrived while the protocol was locked (drawdown circuit breaker). The flip
   * stays Pending until someone calls `settleDeferred(flipId)` after the unlock; it then settles market-free (safe
   * mode). Set on the settled flip too.
   */
  deferred?: { txHash: Hash };
  /** FlipPartner: the partner this flip was attributed to (ERC-8021 suffix), and its terms */
  partner?: FlipPartnerTerms;
}

/** FlipPartner(flipId, partnerId, cutBps, discountBps, winChanceBonusBps, partnerShareBps): fixed at flip time */
export interface FlipPartnerTerms {
  partnerId: bigint;
  /** the partner tier's cut of the flip's expected house profit, bps of the flip's value */
  cutBps: bigint;
  /** the part of the cut handed back to the player as win chance, bps of value */
  discountBps: bigint;
  /** the player's extra win chance, bps */
  winChanceBonusBps: bigint;
  /** what the partner accrues (on a loss), bps of value */
  partnerShareBps: bigint;
}

/** PartnerRegistry.Partner. `status`: 0 none, 1 pending approval, 2 approved, 3 suspended */
export interface PartnerInfo {
  id: bigint;
  code: string;
  controller: Address;
  payout: Address;
  discountBps: number;
  tier: number;
  status: number;
  allowSelf: boolean;
}

/**
 * The team's stake (PrincipalLock): vault shares locked for good. The principal can never leave; only the value above
 * it can, to the immutable `devAddress`, and the stake's rewards are swept there too.
 */
export interface TeamStake {
  /** the lock's address */
  lock: Address;
  /** the locked principal, which can never be withdrawn */
  principal: bigint;
  /** what the locked shares are worth now */
  value: bigint;
  /** the part of `value` above the principal, which the dev address may withdraw */
  withdrawableExcess: bigint;
  /** unswept rewards: the vault's staking rewards, and $FLIPPER holder rewards */
  pendingVaultRewards: bigint;
  pendingHolderRewards: bigint;
  /** where payouts go (immutable) */
  devAddress: Address;
  /** an excess withdrawal waiting out the vault's cooldown (`pendingWithdrawal`), or null */
  pendingRequest: { shares: bigint; assets: bigint; readyAt: bigint } | null;
  /**
   * What `requestTeamExcess("max")` requests: the withdrawable excess, less what's already queued and a cushion of
   * 1% of the principal (`TEAM_EXCESS_CUSHION_BPS`); never negative. Show this as the "MAX".
   */
  requestableExcess: bigint;
}

/** The house's per-player flip limits (`setFlipLimits`). */
export interface FlipLimits {
  /** most flips one player may have waiting for randomness at once (reject code 9 beyond it) */
  maxOpenPerPlayer: number;
  /** the smallest liability a flip may carry, in $FLIPPER (reject code 2 below it); 0n = no floor */
  minLiability: bigint;
}

/** The drawdown circuit breaker: the bankroll's NAV per unit, in $FLIPPER, and the lock. */
export interface BreakerState {
  /** the protocol is locked: flips, claims, vault actions and harvests revert (`ProtocolLocked`) */
  locked: boolean;
  /** treasury / navUnits is the NAV per unit; it locks strictly below half of `navAth` */
  navUnits: bigint;
  navAth: bigint;
  /** the check doesn't run while the treasury is below this */
  lockMinTreasury: bigint;
  unlocker: Address;
  pendingUnlocker: Address;
}

export interface OddsShift {
  shifted: boolean;
  /** baseWinChanceBps − winChanceBps (percentage points × 100) */
  shiftBps: number;
  baseWinChanceBps: number;
  winChanceBps: number;
  /** e.g. "1.25%" */
  label: string;
  /** "The odds for this flip are shifted 1.25% due to token fees" (empty when not shifted) */
  message: string;
}

export interface RejectReason {
  code: number;
  /** `AMOUNT`: code 2 for a zero stake; `BELOW_MIN`: code 2 for a stake under the minimum size */
  key: "PAUSED" | "AMOUNT" | "BELOW_MIN" | "TOKEN" | "QUOTE" | "ROUTE_COST" | "WIN_CHANCE" | "BET_SIZE" | "LOCKED" | "TOO_MANY_OPEN" | "UNKNOWN";
  title: string;
  message: string;
}

/**
 * $FLIPPER holder rewards: the token itself streams the $FLIPPER sent to `distribute` over the next `STREAM` (7 days)
 * to every eligible balance, pro rata to balance × time; accounts pull theirs with `claim()`. The staking vault earns
 * on its depositors' assets and passes that on (`pendingRewards` / `claimRewards`).
 */
export interface HolderRewardsSummary {
  /** $FLIPPER, the token that both pays and earns */
  token: Address;
  symbol: string;
  decimals: number;
  /** "now" the estimates use (unix seconds): the later of the latest block's timestamp and the wall clock */
  now: number;
  /** the stream length (`STREAM`, seconds) */
  stream: number;
  /** current rate, $FLIPPER wei per second (0 once the stream has ended) */
  ratePerSecond: bigint;
  /** unix seconds the current stream ends (`periodFinish`) */
  periodFinish: number;
  /** $FLIPPER of the current distribution still to stream */
  pendingStream: bigint;
  totalDistributed: bigint;
  totalClaimed: bigint;
  /** sum of the balances that earn (the vault's depositor assets included) */
  eligibleSupply: bigint;
  /** the account's part (when one was given) */
  account?: HolderRewardsAccount;
}

export interface HolderRewardsAccount {
  address: Address;
  /** excluded addresses (the protocol's contracts, the pool manager) earn nothing */
  excluded: boolean;
  balance: bigint;
  /** the balance it earns on */
  eligibleBalance: bigint;
  /** claimable from the token now (`claimable`) */
  claimable: bigint;
  /** lifetime earnings from the token, claimed included (`accrued`) */
  accrued: bigint;
  claimed: bigint;
  /** estimated $FLIPPER per day at the current rate, from the wallet balance */
  perDay: bigint;
  /** the staking vault's rewards for this account (absent without a vault) */
  staking?: { vault: Address; pending: bigint; stakedAssets: bigint; perDay: bigint };
  /** wallet + staking */
  totalClaimable: bigint;
}

/** A pending win's payout (`resolvePendingWin`), normalised from PendingWinResolved: see `Settlement.resolved`. */
export interface PendingWinResolution {
  /** the token the player received (the winnings; 0 on a $FLIPPER fallback) */
  tokenPaid: bigint;
  /** $FLIPPER the player received (the fallback payout; 0 when the winnings were bought) */
  flipperPaid: bigint;
  /** $FLIPPER the house spent buying the winnings (0 on a fallback): not paid to the player */
  flipperSpent: bigint;
  /** the flip's final status: Won or WonFallback */
  status: number;
  txHash: Hash;
}

/** TreasuryVault totals, as `FlipperLens.vault` reports them (post-crystallization views). */
export interface VaultInfo {
  vault: Address;
  /** the whole bankroll (house.treasury(), pending flips' reserve included) */
  totalAssets: bigint;
  /** treasury − reserved: withdrawals are paid only from this */
  freeAssets: bigint;
  /** sFLIPPER supply (stakers) */
  depositorShares: bigint;
  /** protocol-owned shares (POL, not an ERC-20 balance) */
  protocolShares: bigint;
  /** $FLIPPER per share, scaled by PPS_SCALE (1e27) */
  pricePerShare: bigint;
  highWaterMark: bigint;
  protocolOwnedAssets: bigint;
  depositorAssets: bigint;
  /** share of stakers' gains above the high-water mark that becomes protocol-owned (8000 = 80%) */
  performanceFeeBps: number;
  /** seconds */
  lockDuration: number;
  /** seconds */
  withdrawCooldown: number;
}

export interface VaultPosition {
  /** sFLIPPER held (pending shares included) */
  shares: bigint;
  /** their $FLIPPER value now */
  assets: bigint;
  /** unix seconds; 0 = never deposited */
  unlockAt: bigint;
  /** shares queued by requestWithdraw */
  pendingShares: bigint;
  /** unix seconds the queued shares can be withdrawn; 0 = nothing queued */
  readyAt: bigint;
  /** $FLIPPER `withdraw` would pay now (0 while locked, cooling down or the free bankroll is short) */
  maxWithdrawable: bigint;
  flipperBalance: bigint;
  /** $FLIPPER allowance to the vault */
  flipperAllowance: bigint;
}

export interface VaultState {
  info: VaultInfo;
  /** null without a user */
  position: VaultPosition | null;
  /** latest block timestamp (a dev chain can be time-travelled past the wall clock) */
  chainTime: bigint;
}

export type TokenStatus = "listed" | "eligible" | "ineligible" | "disabled";

/** Uniswap v4 PoolKey (currencies sorted; address(0) = native ETH). */
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

/**
 * Where a token comes from: `pons` = a pons v2 graduation (its pool uses pons' meme hook); `v4` = any other Uniswap v4
 * token found by the pool scan (the token contract is NOT vetted); `other` = listed by the house owner; `flipper` =
 * $FLIPPER.
 */
export type TokenKind = "flipper" | "hookit" | "pons" | "v4" | "other";

export interface TokenMarket {
  quote: Address;
  quoteSymbol: string;
  quoteDecimals: number;
  /** price in quote units per whole token */
  price: number | null;
  /** price × supply, in quote units */
  marketCap: number | null;
  /** quote reserve where the indexer exposes it (bonding-curve launches), in quote units */
  liquidity: number | null;
  volume24h: number | null;
  change24h: number | null;
}

export interface DiscoveredToken {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  status: TokenStatus;
  /** plain-English reason when not listed/eligible */
  reason?: string;
  kind: TokenKind;
  /** for eligible tokens: which adapter lists it */
  listVia?: "hookit" | "v4";
  isFlipper: boolean;
  /** house listing details (listed/disabled tokens) */
  listing?: { enabled: boolean; blocked: boolean; adapter: Address; hops: number };
  /** @internal */
  hookit?: {
    launchId?: number;
    rail?: string;
    poolId?: string;
    creator?: Address;
    launchedAt?: number;
    marketCount?: number;
    factory?: Address;
  };
  market?: TokenMarket;
  /** deepest valid Uniswap v4 pool per the V4RouteAdapter (v4 tokens) */
  v4?: { key: PoolKey; poolId?: Hex; quote: Address; depthWei: bigint; registered: boolean };
  sources: Array<"house" | "indexer" | "chain" | "flipper" | "v4">;
}

export interface DiscoveryResult {
  tokens: DiscoveredToken[];
  /** @internal */
  source: "indexer" | "chain" | "none";
  /** true when the onchain scan stopped early (it resumes from the cache next time) */
  partial: boolean;
  errors: string[];
}

/** Minimal async-or-sync key/value store (e.g. localStorage) used to resume the onchain log scan. */
export interface KeyValueStore {
  get(key: string): string | null | undefined | Promise<string | null | undefined>;
  set(key: string, value: string): void | Promise<void>;
}
