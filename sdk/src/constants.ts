import type { Address } from "viem";

export const INK_CHAIN_ID = 57073;
/** Robinhood Chain (Arbitrum Nitro, ~100 ms blocks) */
export const ROBINHOOD_CHAIN_ID = 4663;
export const BPS = 10_000n;
/** TreasuryVault price-per-share scale */
export const PPS_SCALE = 10n ** 27n;

/** `Preview.code` / `FlipRejected(code)` values (FlipperHouseBase.REJECT_*). */
export const RejectCode = {
  OK: 0,
  PAUSED: 1,
  /** zero, or below the house's minimum size (`minLiability`, in $FLIPPER of liability): see `minStake` */
  AMOUNT: 2,
  TOKEN: 3,
  QUOTE: 4,
  ROUTE_COST: 5,
  WIN_CHANCE: 6,
  BET_SIZE: 7,
  /** the drawdown circuit breaker has locked the protocol (`locked()`) */
  LOCKED: 8,
  /** this player already has `maxOpenPerPlayer` flips waiting for randomness (`openFlips(player)`) */
  TOO_MANY_OPEN: 9,
} as const;
export type RejectCode = (typeof RejectCode)[keyof typeof RejectCode];

/**
 * What a `ProtocolLocked` revert (or FlipRejected code 8) means for a player: the drawdown circuit breaker locked the
 * protocol. Flips already requested aren't lost: their randomness is recorded and they settle after the unlock.
 */
export const PROTOCOL_LOCKED_MESSAGE = "Flips are paused while the treasury is protected. In-flight flips settle after it reopens.";

/** What reject code 9 means for a player: too many of their flips are still waiting for randomness. */
export const TOO_MANY_OPEN_MESSAGE = "You have too many flips in progress. Wait for one to land.";
/** What reject code 2 means for a stake above zero: below the house's minimum size (`minLiability`). */
export const BELOW_MIN_SIZE_MESSAGE = "This flip is below the minimum size.";
/** The house's per-player cap on flips waiting for randomness when `maxOpenPerPlayer()` reads 0. */
export const DEFAULT_MAX_OPEN_PER_PLAYER = 4;
/**
 * The cushion `requestTeamExcess("max")` leaves: 1% of the principal (in bps). Requesting the whole excess often
 * reverts with `PrincipalBreach` at low volume, since the stake's value can dip below principal + request before the
 * withdrawal completes.
 */
export const TEAM_EXCESS_CUSHION_BPS = 100n;

/** FlipperHouseBase.Status */
export const FlipStatus = {
  None: 0,
  Pending: 1,
  /** paid 2x in the flipped token ($FLIPPER flips: the flip's own `payoutBps`, 2.05x at launch) */
  Won: 2,
  /** stake returned + winnings paid in $FLIPPER because buying the token failed at settlement */
  WonFallback: 3,
  /** stake returned; winnings are being settled (upkeep pays them) */
  WinPending: 4,
  Lost: 5,
  /** lost; the house kept the stake as inventory (identical to Lost for the player) */
  LostInventory: 6,
  /** cancelled before randomness arrived; stake returned */
  Refunded: 7,
} as const;
export type FlipStatus = (typeof FlipStatus)[keyof typeof FlipStatus];

export const isWinStatus = (s: number) => s === FlipStatus.Won || s === FlipStatus.WonFallback || s === FlipStatus.WinPending;
export const isLossStatus = (s: number) => s === FlipStatus.Lost || s === FlipStatus.LostInventory;
export const isFinalStatus = (s: number) => s !== FlipStatus.None && s !== FlipStatus.Pending;

/** Deadline applied to `flip()` transactions (seconds from now). */
export const FLIP_DEADLINE_SECONDS = 300;

/** @internal */
export const HOOKIT = {
  indexerUrl: "https://indexer.hookit.fun",
  /** Master-rail LaunchFactory versions and their deploy blocks (start of the TokenLaunched log scan). */
  factories: [
    { address: "0xAB6eaE3092AE574BEF0A16505FDf137072DCafdd" as Address, fromBlock: 56_517_962n, version: "v1" },
    { address: "0x2851Cb70a6784ae69B45E6b7065908A00176322F" as Address, fromBlock: 56_618_519n, version: "v2" },
  ],
  /** TokenLaunched(uint256 indexed,address indexed,address indexed,bytes32,address,bool,int24,int24,uint128) */
  tokenLaunchedTopic: "0x8f24f35f942374b51fbf3f59c02f60582a39d7754248887424b770d0113ce716" as const,
  /** @internal */
  hkt: "0xcf010BA185Fd6ee6027b141e2C32614D673f8258" as Address,
  /** @internal */
  hiddenTokens: ["0xce80704ae4ed26a93735e5489f086737f43f97f8"] as string[],
  /** Public RPCs cap eth_getLogs at 10k blocks. */
  maxLogRange: 10_000n,
} as const;

/** @internal */
export const HOOKIT_QUOTE_SYMBOLS: Record<string, string> = {
  "0x0000000000000000000000000000000000000000": "ETH",
  "0x943bf64d566c32a2bcd41ac92fb63c111cc9de8f": "wAAPLx",
  "0xa8ddb5cd96b5222afe198316e9a57caa642850d5": "wNVDAx",
  "0xc3fdbe3a68ee5de461d30415a8165cf9aefe1171": "wTSLAx",
  "0x910cabde3eba7fc1ce64fd14bd680b9f60fa0f90": "wAMZNx",
  "0xe7e553cd128f0011777323a0b44a7b96ea1cb540": "wSPYx",
  "0x30987adf0b11dc698438a99ba04ec3a1ab2c7eab": "wMSTRx",
  "0xe343167631d89b6ffc58b88d6b7fb0228795491d": "USDG",
  "0xf8c5308f80e459bb53d9ebe689854d9cbb2caa6f": "wGOOGLx",
};

/** @internal */
export const INK_ETH_USD_FEED = "0x963d5d3aD2Dfd3fe759d376fF62A0963176DBdF5" as Address;
/** Multicall3 lives at the same address on essentially every EVM chain (Robinhood Chain included). */
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address;
/** @deprecated use MULTICALL3 */
export const INK_MULTICALL3 = MULTICALL3;

/** @internal */
export const UNISWAP_V4_INK = {
  poolManager: "0x360E68faCcca8cA495c1B759Fd9EEe466db9FB32" as Address,
  deployBlock: 4_580_556n,
  firstInitializeBlock: 6_391_727n,
  /** keccak256("Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)") */
  initializeTopic: "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438" as const,
} as const;
/** @deprecated use UNISWAP_V4_INK or `knownPoolManager(chainId)` */
export const UNISWAP_V4 = UNISWAP_V4_INK;

/** Known Uniswap v4 PoolManagers by chain id (pass them explicitly for other chains). */
export const KNOWN_POOL_MANAGERS: Record<number, { poolManager: Address; firstInitializeBlock: bigint }> = {
  [INK_CHAIN_ID]: { poolManager: UNISWAP_V4_INK.poolManager, firstInitializeBlock: UNISWAP_V4_INK.firstInitializeBlock },
  [ROBINHOOD_CHAIN_ID]: { poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951" as Address, firstInitializeBlock: 9_505n },
};

/** Per-chain defaults (apps can override every field through config / env). */
export interface ChainDefaults {
  name: string;
  explorerUrl: string;
  nativeSymbol: string;
  /** Chainlink-style ETH/USD feed (8 decimals), for USD display */
  ethUsdFeed?: Address;
  multicall3: Address;
  /** Arbitrum Nitro ignores priority fees: send maxPriorityFeePerGas = 0 */
  zeroTip: boolean;
  /** the client-side Initialize scan is viable (not on chains with ~200k pools; use a server index there) */
  clientV4Scan: boolean;
  /** live block time (ms): sets receipt/block polling so confirmations aren't held to viem's 4s default */
  blockTimeMs: number;
}
export const CHAIN_DEFAULTS: Record<number, ChainDefaults> = {
  [INK_CHAIN_ID]: {
    name: "Ink",
    explorerUrl: "https://explorer.inkonchain.com",
    nativeSymbol: "ETH",
    ethUsdFeed: "0x963d5d3aD2Dfd3fe759d376fF62A0963176DBdF5" as Address,
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
    zeroTip: false,
    clientV4Scan: true,
    blockTimeMs: 1_000, // OP stack
  },
  [ROBINHOOD_CHAIN_ID]: {
    name: "Robinhood Chain",
    explorerUrl: "https://robinhoodchain.blockscout.com",
    nativeSymbol: "ETH",
    ethUsdFeed: "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9" as Address,
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
    zeroTip: true,
    clientV4Scan: false,
    blockTimeMs: 100, // Arbitrum Nitro, ~10 blocks/s
  },
};
/** Polling interval for a chain's block time: half a block, clamped to [100ms, 4s]. */
export const pollingIntervalFor = (blockTimeMs: number | undefined): number =>
  Math.min(4_000, Math.max(100, Math.floor((blockTimeMs ?? 8_000) / 2)));
export const chainDefaults = (chainId: number | undefined): ChainDefaults | undefined =>
  chainId === undefined ? undefined : CHAIN_DEFAULTS[chainId];
/** Arbitrum family chain ids that ignore tips (plus Robinhood Chain) */
export const ZERO_TIP_CHAIN_IDS = new Set<number>([ROBINHOOD_CHAIN_ID, 42161, 42170, 421614]);

/** pons v2 launchpad (Robinhood Chain): graduated pools are (ETH, token, fee 0, tickSpacing 200, meme hook). */
export const PONS: Record<number, { factory: Address; memeHook: Address }> = {
  [ROBINHOOD_CHAIN_ID]: {
    factory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as Address,
    memeHook: "0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044" as Address,
  },
};

/**
 * Quote currencies and stablecoins per chain: never offered as flippable "tokens" by discovery (the adapter's
 * `quoteCurrencies()` are excluded too). Wrapped ETH is included.
 */
export const QUOTES_AND_STABLES: Record<number, Address[]> = {
  [INK_CHAIN_ID]: [
    "0x4200000000000000000000000000000000000006", // WETH
    "0x2D270e6886d130D724215A266106e6832161EAEd", // USDC
    "0x0200C29006150606B650577BBE7B6248F58470c1", // USD₮0
    "0xF1815bd50389c46847f0Bda824eC8da914045D14", // USDC.e
    "0xe343167631d89B6Ffc58B88d6b7fB0228795491D", // USDG
  ] as Address[],
  [ROBINHOOD_CHAIN_ID]: [
    "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", // WETH
    "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", // USDG (6 dp)
  ] as Address[],
};
export const knownPoolManager = (chainId: number | undefined) => (chainId === undefined ? undefined : KNOWN_POOL_MANAGERS[chainId]);

/** Wrapped native ETH per chain: flipping "ETH" wraps it into this token and flips that. */
export const WETH_ADDRESSES: Record<number, Address> = {
  [INK_CHAIN_ID]: "0x4200000000000000000000000000000000000006" as Address,
  [ROBINHOOD_CHAIN_ID]: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address, // aeWETH
};
