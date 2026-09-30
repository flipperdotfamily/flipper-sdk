import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  InvalidBytesBooleanError,
  concat,
  decodeFunctionResult,
  encodeFunctionData,
  isAddressEqual,
  keccak256,
  maxUint256,
  stringToHex,
  parseEventLogs,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Hash,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from "viem";
import { getCapabilities, sendCalls, waitForCallsStatus } from "viem/actions";
import {
  erc20Abi,
  flipperHouseAbi,
  flipperLensAbi,
  flipperRewardTokenAbi,
  revenueRouterAbi,
  hookitRouteAdapterAbi,
  partnerRegistryAbi,
  principalLockAbi,
  treasuryVaultAbi,
  v3RouteAdapterAbi,
  v4RouteAdapterAbi,
  wethAbi,
} from "./abis/slim";
import {
  BPS,
  DEFAULT_MAX_OPEN_PER_PLAYER,
  FLIP_DEADLINE_SECONDS,
  FlipStatus,
  RejectCode,
  TEAM_EXCESS_CUSHION_BPS,
  WETH_ADDRESSES,
  ZERO_TIP_CHAIN_IDS,
  isFinalStatus,
  isWinStatus,
} from "./constants";
import { v3CheckReason, type ListingCheck, type ListingTarget } from "./listing";
import { v4CheckReason } from "./v4";
import { discoverHookitTokens, type DiscoverOptions } from "./discovery";
import { discoverV4Tokens, type V4ScanOptions } from "./v4";
import { FlipperError, erc20ErrorsAbi, toFlipperError } from "./errors";
import { formatTokenAmount } from "./format";
import { houseEdgeBps, rejectReason } from "./odds";
import type {
  BaseTerms,
  BreakerState,
  EdgeProgress,
  FlipperAddresses,
  FlipLimits,
  FlipPartnerTerms,
  FlipResult,
  FlipSettledEvent,
  FlipStep,
  FlipView,
  HouseParams,
  PendingWinResolution,
  HouseView,
  PoolKey,
  HolderRewardsSummary,
  PartnerInfo,
  Preview,
  TeamStake,
  Settlement,
  TokenView,
  VaultState,
} from "./types";

// Error ABIs merged in so viem can decode reverts that bubble up from the house or the token.
const houseAbi = [...flipperHouseAbi, ...erc20ErrorsAbi] as const;
const houseErrors = flipperHouseAbi.filter((x) => x.type === "error");
const lensAbi = [...flipperLensAbi, ...houseErrors] as const;
const tokenAbi = [...erc20Abi, ...erc20ErrorsAbi] as const;
// the lock stakes into the vault: its reverts (ProtocolLocked, …) bubble up through the lock
const lockAbi = [...principalLockAbi, ...treasuryVaultAbi.filter((x) => x.type === "error")] as const;
// HookitRouteAdapter.registerAndList (vetted by the ListingPolicy) calls house.listToken: decode the house's errors too
const hookitListingAbi = [...hookitRouteAdapterAbi, ...houseErrors] as const;
// registerAndList calls house.listToken: include the house's errors so ListingProbeFailed decodes
const v4ListingAbi = [...v4RouteAdapterAbi, ...houseErrors] as const;
const v3ListingAbi = [...v3RouteAdapterAbi, ...houseErrors] as const;

/**
 * Explicit eth_call gas (so viem doesn't estimate) for calls that simulate route swaps: a preview or a flip through
 * hooked pools can take several million gas.
 */
export const SIMULATION_GAS = 12_000_000n;
/** FlipperRewardToken's fixed-point scale for `rewardRate` / `rewardPerToken` (2^96) */
export const REWARD_MAGNITUDE = 2n ** 96n;

/**
 * PendingWinResolved's raw `(tokenPaid, flipperPaid)` as the player sees them. On a Won resolution the event's
 * `flipperPaid` is what the house spent buying the winnings; only on WonFallback is it paid to the player. The case
 * comes from the flip's final `status` when given, else from the amounts (a bought payout always carries tokens).
 */
export function normalizePendingWinResolution(
  raw: { tokenPaid: bigint; flipperPaid: bigint; txHash: Hash },
  status?: number,
): PendingWinResolution {
  const won = status === FlipStatus.Won || (status !== FlipStatus.WonFallback && raw.tokenPaid > 0n);
  return won
    ? { tokenPaid: raw.tokenPaid, flipperPaid: 0n, flipperSpent: raw.flipperPaid, status: FlipStatus.Won, txHash: raw.txHash }
    : { tokenPaid: 0n, flipperPaid: raw.flipperPaid, flipperSpent: 0n, status: FlipStatus.WonFallback, txHash: raw.txHash };
}

/** When a pending win (WinPending) can always be resolved, in unix seconds: `createdAt + params.pendingTimeout`. */
export const pendingWinResolveAt = (flip: Pick<FlipView, "createdAt">, params: Pick<HouseParams, "pendingTimeout">): number =>
  Number(flip.createdAt) + Number(params.pendingTimeout);
/** Gas for plain fee-bearing view reads (randomnessFeeFor, lens.house) evaluated at an explicit gas price. */
export const FEE_READ_GAS = 3_000_000n;
/**
 * eth_calls that carry a gasPrice use this sender with a balance override, so nodes that check
 * balance ≥ gas × gasPrice accept them even when nobody is connected.
 */
export const SIMULATION_ACCOUNT = "0x000000000000000000000000000000000000F11B" as Address;

/** Gas for a batch of ≤5 previews (lens.previews) in one eth_call. */
export const BATCH_SIMULATION_GAS = 30_000_000n;
/** @internal */
export const HOOKIT_TX_GAS_FLOOR = 8_000_000n;
/**
 * With a gas-priced randomness adapter (Chainlink VRF prices the fee at tx.gasprice), `msg.value` sent with a flip =
 * the quoted fee × 1.2, since the quote can move before inclusion and the house refunds any excess. A flat fee (Dice,
 * Pyth Entropy) is sent exactly: see `randomnessFeeToSend`. UIs should display the unpadded fee.
 */
export const RANDOMNESS_FEE_PAD_BPS = 12_000n;
export const paddedRandomnessFee = (fee: bigint) => (fee * RANDOMNESS_FEE_PAD_BPS + 9_999n) / 10_000n;
/**
 * The stake whose liability reaches `minLiability`, extrapolated linearly from a preview of `amount` that carried
 * `liability` (rounded up). For $FLIPPER it's exact; for route-priced tokens, check it with a preview (`minStake`).
 */
export const estimateMinStake = (amount: bigint, liability: bigint, minLiability: bigint): bigint =>
  liability === 0n ? 0n : (amount * minLiability + liability - 1n) / liability;
/**
 * What a MAX excess request of the team stake asks for: the withdrawable excess, less what's already queued and a
 * cushion of `cushionBps` of the principal; never negative (see `requestTeamExcess`).
 */
export function teamExcessMax(principal: bigint, withdrawableExcess: bigint, queued: bigint, cushionBps: bigint = TEAM_EXCESS_CUSHION_BPS): bigint {
  const keep = queued + (principal * cushionBps) / BPS;
  return withdrawableExcess > keep ? withdrawableExcess - keep : 0n;
}
/**
 * The EIP-1559 fields a transaction is sent with, from the quote fees (`gasFees()`): the cap is 1.2 × the quote
 * price, so a randomness fee quoted at `maxFeePerGas` and padded by `paddedRandomnessFee` covers every price the
 * transaction can be included at. You pay the effective price (base + tip), never the cap.
 */
export const txFees = (f: GasFees): GasFees => ({ maxFeePerGas: (f.maxFeePerGas * RANDOMNESS_FEE_PAD_BPS) / 10_000n, maxPriorityFeePerGas: f.maxPriorityFeePerGas });

/**
 * An ABI entry's outputs without the trailing `Params` fields in `drop`: decodes a house deployed before they existed
 * (its `params` tuple is shorter) until it's redeployed. Such a house reads them as 0 (off).
 */
function withoutParamsFields<T extends readonly unknown[]>(abi: T, functionName: string, drop: readonly string[]): T {
  type Param = { name?: string; components?: Param[] };
  const strip = (c: Param) => {
    if (!c.components) return;
    c.components = c.components.filter((k) => !drop.includes(k.name ?? ""));
    c.components.forEach(strip);
  };
  return abi.map((x) => {
    const e = x as { type?: string; name?: string; outputs?: unknown[] };
    if (e.type !== "function" || e.name !== functionName) return x;
    const clone = JSON.parse(JSON.stringify(e)) as { outputs: Param[] };
    clone.outputs.forEach(strip);
    return clone;
  }) as unknown as T;
}
const isShortData = (err: unknown) => /out of bounds|data size|too small/i.test(String((err as Error)?.message));
/** Params fields newer houses append, newest first: an older house is decoded without a growing tail of them. */
const LATER_PARAMS: readonly (readonly string[])[] = [["kellyBps"], ["kellyBps", "maxReservedBps"]];
const legacyParams = <P extends object>(p: P): P & { maxReservedBps: number; kellyBps: number } => ({ maxReservedBps: 0, kellyBps: 0, ...p });
/** Decode `data` with `abi`, falling back to an older house's shorter `Params` (see `withoutParamsFields`). */
function decodeWithLegacyParams<T>(abi: readonly unknown[], functionName: string, data: Hex): T {
  try {
    return decodeFunctionResult({ abi, functionName, data } as never) as T;
  } catch (err) {
    if (!isShortData(err)) throw err;
    for (const drop of LATER_PARAMS) {
      try {
        return decodeFunctionResult({ abi: withoutParamsFields(abi, functionName, drop), functionName, data } as never) as T;
      } catch (e) {
        if (!isShortData(e)) throw e;
      }
    }
    throw err;
  }
}

/** Max previews per eth_call when sizing a stake client-side (5 × ~4.4M stays under common RPC caps). */
const PREVIEW_BATCH = 5;

// Loose client types: accept clients from wagmi hooks (chain-specific generics) as well as plain viem clients.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlipperPublicClient = PublicClient<Transport, Chain | undefined, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FlipperWalletClient = WalletClient<Transport, Chain | undefined, Account | undefined, any>;

export interface CreateFlipperClientOptions {
  publicClient: FlipperPublicClient;
  walletClient?: FlipperWalletClient | null;
  addresses: FlipperAddresses;
  /** @deprecated unused: holder rewards are read from the $FLIPPER token itself (there are no Merkle proofs any more) */
  keeper?: { url: string; fetch?: typeof fetch };
  /** @internal */
  hookitRoutes?: boolean;
  /**
   * Your partner code (ERC-8021 attribution, 1–32 of [a-z0-9_-], registered in the PartnerRegistry). The client
   * appends its `registry.suffixOf(code)` to every `flip` (and to `preview`), so the house attributes the flip onchain:
   * your share of its expected profit accrues to you, and your discount shows up in the player's odds.
   */
  partner?: string | null;
}

/** A code the PartnerRegistry can hold: 1–32 of [a-z0-9_-]. */
export const isPartnerCode = (code: unknown): code is string => typeof code === "string" && /^[a-z0-9_-]{1,32}$/.test(code);

/**
 * Fee quote: fee-bearing reads (randomness fee, previews) are evaluated at `maxFeePerGas`, and transactions are sent
 * with `txFees(quote)` (the cap raised by the same 1.2 × the randomness fee is padded by).
 */
export interface GasFees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export interface FlipOptions {
  token: Address;
  amount: bigint;
  /** minimum acceptable win chance; defaults to the fresh preview's win chance (no worse odds than shown) */
  minWinChanceBps?: number;
  /** defaults to 300 s (5 min) from the later of wall-clock and chain time */
  deadlineSeconds?: number;
  onStep?: (step: FlipStep) => void;
  /** token symbol, for friendlier error copy */
  symbol?: string;
  /** token decimals, for amounts in error copy */
  decimals?: number;
  /**
   * When the house's allowance is short: "exact" (default) approves this flip's amount; "max" approves the maximum,
   * so later flips of the token skip the approval step (tokens that reject a max approval get the exact amount).
   */
  approve?: "exact" | "max";
}

/** Progress of `flipEth`: the wrap (or one EIP-5792 batch), then the usual flip steps. */
export type EthFlipStep =
  | FlipStep
  | { step: "wrapping" }
  | { step: "wrap-sent"; hash: Hash }
  | { step: "batch-signing" }
  | { step: "batch-sent"; id: string };

export interface FlipEthOptions {
  /** ETH to flip, in wei (it is wrapped into WETH, which is what the house flips) */
  amount: bigint;
  minWinChanceBps?: number;
  deadlineSeconds?: number;
  /** WETH allowance to grant when short: "exact" (default) or "max" */
  approve?: "exact" | "max";
  /**
   * "auto" (default): when the wallet reports atomic batching (EIP-5792 `wallet_getCapabilities`), wrap + approve +
   * flip go out as one `wallet_sendCalls` batch (one confirmation). Otherwise, and with "never": a wrap transaction,
   * then `flip()` (approve if needed, then flip).
   */
  batch?: "auto" | "never";
  onStep?: (step: EthFlipStep) => void;
}

/** The token contract itself can't answer (no such function, a revert, or undecodable return data). */
const isContractSideError = (err: unknown) =>
  err instanceof BaseError &&
  !!err.walk(
    (e) =>
      e instanceof ContractFunctionRevertedError ||
      e instanceof ContractFunctionZeroDataError ||
      e instanceof AbiDecodingZeroDataError ||
      e instanceof AbiDecodingDataSizeTooSmallError ||
      e instanceof InvalidBytesBooleanError,
  );

/**
 * A view the house can't answer: a deployment from before it (no such function) or a revert. Matched by error name, so
 * it holds whichever copy of viem threw it.
 */
const CONTRACT_SIDE_ERRORS = ["ContractFunctionRevertedError", "ContractFunctionZeroDataError", "AbiDecodingZeroDataError", "AbiDecodingDataSizeTooSmallError"];
const isMissingView = (err: unknown) => {
  const walk = (err as { walk?: (fn: (e: unknown) => boolean) => unknown } | null)?.walk;
  return typeof walk === "function" && !!walk.call(err, (e) => CONTRACT_SIDE_ERRORS.includes((e as { name?: string } | null)?.name ?? ""));
};

/** One ERC20 metadata read: `fallback` when the contract can't answer, 2 retries (300 ms, 900 ms) on anything else. */
async function readTokenField<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (err) {
      if (isContractSideError(err)) return fallback;
      if (attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 300 * 3 ** attempt));
    }
  }
}

/** Options for the listing writes (`list`, `registerAndList`, `registerAndListV3`, `listToken`). */
export interface ListingSendOptions {
  /** called with the transaction hash as soon as the wallet has sent it (before it is mined) */
  onSent?: (hash: Hash) => void;
}

export interface FlipEthResult extends FlipResult {
  /** the flip went out as one EIP-5792 batch */
  batched: boolean;
  /** the separate wrap transaction (sequential path) */
  wrapHash?: Hash;
  /** the WETH that was flipped */
  weth: Address;
}

export interface FlipEvents {
  settled?: { event: FlipSettledEvent; txHash: Hash };
  /** normalised (see `Settlement.resolved`): the case comes from the flip's status when known, else from the amounts */
  resolved?: PendingWinResolution;
  cancelled?: { by: Address; txHash: Hash };
  /** SettlementDeferred: randomness arrived while the protocol was locked; settles via `settleDeferred` after unlock */
  deferred?: { txHash: Hash };
  /** FlipPartner: the flip's partner attribution and terms */
  partner?: FlipPartnerTerms;
}

export interface WaitOptions {
  /** block to start the FlipSettled log search from (use the flip receipt's block) */
  fromBlock?: bigint;
  pollIntervalMs?: number;
  /** default 180 s; 0 = no timeout */
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Called once when the flip's randomness turns out to have arrived while the protocol was locked
   * (`SettlementDeferred`): it stays Pending until `settleDeferred(flipId)` after the unlock. Waiting goes on (and no
   * longer times out); `waitForSettlement` resolves once it's settled.
   */
  onDeferred?: () => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new FlipperError("Stopped waiting.", "timeout"));
      },
      { once: true },
    );
  });

/**
 * Viem-based client for FlipperHouse / FlipperLens / HolderRewards.
 *
 * ```ts
 * const flipper = createFlipperClient({ publicClient, walletClient, addresses: { house, lens, rewards } });
 * const pv = await flipper.preview(token, parseUnits("100", 18));
 * const { flipId, receipt } = await flipper.flip({ token, amount });
 * const settled = await flipper.waitForSettlement(flipId, { fromBlock: receipt.blockNumber });
 * ```
 */
export function createFlipperClient({ publicClient: pc, walletClient: wc, addresses, hookitRoutes = false, partner }: CreateFlipperClientOptions) {
  /** gas-limit floor for token flips and v4 listings, when enabled */
  const routeGasFloor = hookitRoutes ? HOOKIT_TX_GAS_FLOOR : 0n;
  const { house, lens } = addresses;
  let flipperAddress: Address | undefined = addresses.flipper;
  let rewardTokenAddress: Address | undefined = addresses.rewardToken;
  /** undefined = not read yet; null = the house has no staking vault */
  let vaultAddress: Address | null | undefined = addresses.vault;
  let wethAddress: Address | undefined = addresses.weth;
  const batchSupport = new Map<string, boolean>();

  // ── partners (ERC-8021): the flip calldata's suffix, fetched once from the registry (`suffixOf` is pure) ──────
  const partnerCode = isPartnerCode(partner) ? partner : undefined;
  /** undefined = not read yet; null = the house has no partner registry */
  let registryAddress: Address | null | undefined = addresses.partnerRegistry;
  let suffixCache: Promise<Hex | undefined> | undefined;
  async function partnerRegistryAddress(): Promise<Address | null> {
    if (registryAddress === undefined) {
      // not cached on failure: a transient RPC error mustn't switch attribution off for good
      const a = await pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "partnerRegistry" });
      registryAddress = isAddressEqual(a, zeroAddress) ? null : a;
    }
    return registryAddress;
  }
  function partnerSuffix(): Promise<Hex | undefined> {
    if (!partnerCode) return Promise.resolve(undefined);
    suffixCache ??= (async () => {
      const registry = await partnerRegistryAddress();
      if (!registry) return undefined;
      return pc.readContract({ address: registry, abi: partnerRegistryAbi, functionName: "suffixOf", args: [partnerCode] });
    })().catch(() => {
      suffixCache = undefined; // retried on the next flip or preview
      return undefined;
    });
    return suffixCache;
  }
  // ── PrincipalLock writes (the team stake) ─────────────────────────────────────────────────────────────
  async function needDevAddress(): Promise<void> {
    const lock = need(addresses.principalLock, "principal lock");
    const { account } = wallet();
    const dev = await pc.readContract({ address: lock, abi: principalLockAbi, functionName: "devAddress" });
    if (!isAddressEqual(dev, account.address)) throw new FlipperError("Only the team's dev address can withdraw the stake's excess.", "config");
  }
  async function lockWrite<R = unknown>(
    functionName: "sweepRewards" | "sweepVaultRewards" | "sweepHolderRewards" | "requestExcess" | "withdrawExcess" | "cancelExcess",
    args: readonly bigint[],
  ): Promise<{ receipt: TransactionReceipt; result: R }> {
    const lock = need(addresses.principalLock, "principal lock");
    const { wc, account, chain } = wallet();
    try {
      const { request, result } = await pc.simulateContract({ account, address: lock, abi: lockAbi, functionName, args } as never);
      const gas = await pc.estimateContractGas({ account, address: lock, abi: lockAbi, functionName, args } as never);
      // vault / $FLIPPER moves out of excluded addresses: see withRewardHeadroom
      const hash = await wc.writeContract({ ...(request as object), gas: withRewardHeadroom(gas), account, chain, ...(await sendFees()) } as never);
      return { receipt: await wait(hash, "team stake"), result: result as R };
    } catch (err) {
      const e = toFlipperError(err, { symbol: "$FLIPPER" });
      if (e.details.errorName === "Unauthorized") throw new FlipperError("Only the team's dev address can do that.", "rejected", e.details);
      throw e;
    }
  }

  /** the SettlementDeferred log of a flip, if any (searched from `fromBlock`, default the last 5k blocks) */
  async function deferredLog(flipId: bigint, fromBlock?: bigint): Promise<{ txHash: Hash } | undefined> {
    const latest = await pc.getBlockNumber({ cacheTime: 0 });
    const from = fromBlock ?? (latest > 5_000n ? latest - 5_000n : 0n);
    const logs = await pc.getContractEvents({ address: house, abi: flipperHouseAbi, eventName: "SettlementDeferred", args: { flipId }, fromBlock: from, toBlock: "latest" });
    const l = logs[logs.length - 1];
    return l ? { txHash: l.transactionHash } : undefined;
  }

  /** A listing error worded for its venue (the adapters share the `Rejected(uint8)` error). */
  function venueError(err: unknown, venue: "v4" | "v3" | "hookit"): FlipperError {
    const e = toFlipperError(err);
    if (e.details.errorName === "Rejected" && venue === "v3") {
      return new FlipperError(`The v3 adapter rejected this pool: ${v3CheckReason(Number(e.details.args?.[0] ?? 0)).toLowerCase()}.`, e.kind, e.details);
    }
    return e;
  }

  /** Simulate a listing call; a revert comes back as a plain-English reason (with the probe's route cost, if any). */
  async function dryRun(
    req: { address: Address; abi: readonly unknown[]; functionName: string; args: readonly unknown[] },
    venue: "v4" | "v3" | "hookit",
  ): Promise<{ ok: true } | { ok: false; reason: string; code?: number; routeCostBps?: bigint; alreadyListed?: boolean }> {
    try {
      await pc.simulateContract({ ...req, account: wc?.account ?? zeroAddress, gas: SIMULATION_GAS } as never);
      return { ok: true };
    } catch (err) {
      const e = venueError(err, venue);
      const name = e.details.errorName;
      return {
        ok: false,
        reason: e.message,
        code: name === "Rejected" || name === "NotVetted" ? Number(e.details.args?.[0]) : undefined,
        routeCostBps: name === "ListingProbeFailed" ? (e.details.args?.[0] as bigint) : undefined,
        alreadyListed: name === "AlreadyListed" || undefined,
      };
    }
  }

  function wallet() {
    if (!wc?.account) throw new FlipperError("Connect a wallet first.", "config");
    return { wc, account: wc.account, chain: wc.chain ?? pc.chain };
  }

  function need(addr: Address | undefined, what: string): Address {
    if (!addr) throw new FlipperError(`The ${what} address isn't configured.`, "config");
    return addr;
  }

  async function wait(hash: Hash, what: string): Promise<TransactionReceipt> {
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new FlipperError(`The ${what} transaction reverted.`, "revert");
    return receipt;
  }

  /** Gas estimate with headroom: hooked pool swaps can be gas-heavy and the house caps each quote attempt. */
  const withHeadroom = (gas: bigint) => (gas * 130n) / 100n;
  /**
   * Gas for calls that move $FLIPPER to or from an excluded address (claims, the vault, $FLIPPER flips): such a
   * transfer folds the reward stream into the accumulator, which writes storage only when a new second has passed
   * since the last update, so an estimate taken in the same second comes out ~6-9k low.
   */
  const withRewardHeadroom = (gas: bigint) => (gas * 125n) / 100n + 30_000n;
  const max = (a: bigint, b: bigint) => (a > b ? a : b);

  async function chainNow(): Promise<bigint> {
    const wall = BigInt(Math.floor(Date.now() / 1000));
    try {
      const block = await pc.getBlock({ blockTag: "latest" });
      return block.timestamp > wall ? block.timestamp : wall;
    } catch {
      return wall;
    }
  }

  async function waitUntil(flipId: bigint, done: (status: number) => boolean, opts: WaitOptions): Promise<Settlement> {
    const { pollIntervalMs = 1_000, timeoutMs = 180_000, signal, fromBlock, onDeferred } = opts;
    const started = Date.now();
    let polls = 0;
    let deferred = false;
    for (;;) {
      if (signal?.aborted) throw new FlipperError("Stopped waiting.", "timeout");
      const f = await client.getFlip(flipId).catch(() => undefined);
      if (f && done(f.status)) {
        const s = await client.getSettlement(flipId, fromBlock).catch(() => undefined);
        return (
          s ?? { flipId, status: f.status, won: isWinStatus(f.status), roll: f.roll, flip: f, safeMode: false }
        );
      }
      // still Pending after a few polls: did its randomness arrive while the protocol was locked? (every 5th poll)
      if (!deferred && f?.status === FlipStatus.Pending && polls % 5 === 2) {
        if (await deferredLog(flipId, fromBlock).catch(() => undefined)) {
          deferred = true;
          onDeferred?.();
        }
      }
      polls++;
      if (timeoutMs > 0 && Date.now() - started > timeoutMs && !(deferred && onDeferred)) {
        throw deferred
          ? new FlipperError(
              "This flip's randomness arrived while flips were paused. It's safe: it settles after the treasury reopens.",
              "timeout",
              { errorName: "SettlementDeferred" },
            )
          : new FlipperError("Randomness is taking longer than usual. Your flip is safe: it settles as soon as it arrives.", "timeout");
      }
      await sleep(pollIntervalMs, signal);
    }
  }

  // ── gas-price-aware reads ───────────────────────────────────────────────────────────────────────────
  // The randomness fee can depend on tx.gasprice (Chainlink VRF v2.5 wrapper: gasPrice × (callbackGas + overhead)
  // × premium + L1 cost). An eth_call without a gasPrice would quote ~0, so every fee-bearing read is evaluated at
  // the maxFeePerGas the flip will be sent with. Gas-price-independent providers (Pyth Entropy) are unaffected.
  let feesCache: { at: number; v: GasFees; expected: bigint } | undefined;
  async function gasFees(): Promise<GasFees> {
    return (await pricing()).v;
  }
  /** The fee cap a transaction is sent with: 1.2 × the quote price (see `pricing`). */
  async function sendFees(fees?: GasFees): Promise<GasFees> {
    return txFees(fees ?? (await gasFees()));
  }
  /** what a transaction is expected to actually pay per gas right now (base fee + tip) */
  async function expectedGasPrice(): Promise<bigint> {
    return (await pricing()).expected;
  }
  async function pricing(): Promise<{ v: GasFees; expected: bigint }> {
    if (feesCache && Date.now() - feesCache.at < 4_000) return feesCache;
    const chainId = pc.chain?.id ?? (await pc.getChainId());
    let v: GasFees;
    let expected: bigint;
    try {
      const block = await pc.getBlock({ blockTag: "latest" });
      if (block.baseFeePerGas === null || block.baseFeePerGas === undefined) throw new Error("legacy chain");
      // Arbitrum Nitro (Robinhood Chain) ignores tips: send 0 there
      const tip = ZERO_TIP_CHAIN_IDS.has(chainId) ? 0n : await pc.estimateMaxPriorityFeePerGas().catch(() => 0n);
      // Quote at 5/3 × the base fee. Transactions go out capped at 1.2 × the quote (`txFees`: 2 × base), and the
      // randomness fee sent is the quote's fee × 1.2, so it covers every price the tx can be included at, even after
      // the base fee doubles (Robinhood's can jump ~50% within seconds). The house charges at the effective price and
      // refunds the rest, so a high cap costs nothing. Never below the node's own eth_gasPrice.
      const quote = (block.baseFeePerGas * 5n) / 3n + tip;
      const floor = await pc.getGasPrice().catch(() => 0n);
      v = { maxFeePerGas: quote > floor ? quote : floor, maxPriorityFeePerGas: tip };
      expected = block.baseFeePerGas + tip;
    } catch {
      const gp = await pc.getGasPrice();
      v = { maxFeePerGas: gp, maxPriorityFeePerGas: ZERO_TIP_CHAIN_IDS.has(chainId) ? 0n : gp };
      expected = gp;
    }
    feesCache = { at: Date.now(), v, expected };
    return feesCache;
  }

  const overrideBalance = [{ address: SIMULATION_ACCOUNT, balance: 10n ** 24n }];
  /** true once the RPC rejected a state override (then we fall back to the connected account / no sender) */
  let noStateOverride = false;
  /** whether the house's randomness fee moves with the gas price: probed once (see `randomnessFeeIsGasPriced`) */
  let feeGasPriced: Promise<boolean> | undefined;
  /**
   * simulate a non-view call at an explicit gas price (see above); `from` replaces the simulation sender (with the same
   * balance override), for calls whose result depends on the caller
   */
  async function simulateAt<T>(req: Record<string, unknown>, fees?: GasFees, from?: Address): Promise<T> {
    const gasPrice = (fees ?? (await gasFees())).maxFeePerGas;
    const sim = pc.simulateContract as unknown as (a: Record<string, unknown>) => Promise<{ result: T }>;
    if (!noStateOverride) {
      try {
        const sender = from ?? SIMULATION_ACCOUNT;
        return (await sim({ ...req, gasPrice, account: sender, stateOverride: [{ address: sender, balance: 10n ** 24n }] })).result;
      } catch (err) {
        if (!/override|unsupported|not supported|invalid.*param/i.test(String((err as Error)?.message))) throw err;
        noStateOverride = true;
      }
    }
    return (await sim({ ...req, gasPrice, account: wc?.account })).result;
  }
  /** a view read evaluated at an explicit gas price */
  async function readAt<T>(req: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] }, fees?: GasFees): Promise<T> {
    const gasPrice = (fees ?? (await gasFees())).maxFeePerGas;
    const data = encodeFunctionData(req as never);
    const call = async (withOverride: boolean) =>
      pc.call({
        to: req.address,
        data,
        gas: FEE_READ_GAS,
        gasPrice,
        account: withOverride ? SIMULATION_ACCOUNT : wc?.account,
        ...(withOverride ? { stateOverride: overrideBalance } : {}),
      });
    let out: Awaited<ReturnType<typeof call>>;
    if (!noStateOverride) {
      try {
        out = await call(true);
      } catch (err) {
        if (!/override|unsupported|not supported|invalid.*param/i.test(String((err as Error)?.message))) throw err;
        noStateOverride = true;
        out = await call(false);
      }
    } else out = await call(false);
    if (req.functionName !== "house") return decodeFunctionResult({ abi: req.abi, functionName: req.functionName, data: out.data ?? "0x" } as never) as T;
    // an older house's HouseView has a shorter params tuple (until it's redeployed)
    const v = decodeWithLegacyParams<HouseView>(req.abi, "house", out.data ?? "0x");
    return { ...v, params: legacyParams(v.params) } as T;
  }

  /**
   * The base terms now (see `baseTerms`). A house from before the edge schedule has no `current…` views: its win chance
   * and payout are `params()`'s, and its Kelly multiplier `params().kellyBps` if it has no `currentKellyBps` either.
   */
  async function readTerms(paramsOf: () => Promise<HouseParams> = () => client.params()): Promise<BaseTerms> {
    const view = (functionName: "currentBaseWinChanceBps" | "currentFlipperPayoutBps" | "currentKellyBps") =>
      pc.readContract({ address: house, abi: flipperHouseAbi, functionName }).then(Number, (err: unknown) => {
        if (isMissingView(err)) return null;
        throw err;
      });
    const [win, payout, kelly] = await Promise.all([view("currentBaseWinChanceBps"), view("currentFlipperPayoutBps"), view("currentKellyBps")]);
    if (win !== null && payout !== null && kelly !== null) return { baseWinChanceBps: win, flipperPayoutBps: payout, kellyBps: kelly, scheduled: true };
    const p = await paramsOf();
    if (win !== null && payout !== null) return { baseWinChanceBps: win, flipperPayoutBps: payout, kellyBps: kelly ?? p.kellyBps, scheduled: true };
    return { baseWinChanceBps: p.baseWinChanceBps, flipperPayoutBps: p.flipperPayoutBps, kellyBps: kelly ?? p.kellyBps, scheduled: false };
  }

  const stakeCache = new Map<string, { amount: bigint; preview: Preview }>();

  /**
   * `previews`, or, with a partner, one partner-aware `preview` per amount (in parallel): the partner's share changes a
   * flip's edge, so its Kelly cap too, and only a `previewFlip` that carries the suffix sees it.
   */
  async function stakePreviews(token: Address, amounts: bigint[], partnered: boolean): Promise<readonly Preview[]> {
    if (!partnered) return client.previews(token, amounts);
    const fees = await gasFees();
    return Promise.all(amounts.map((a) => client.preview(token, a, fees)));
  }

  async function searchStake(token: Address, hi: bigint, baseOdds: boolean, partnered: boolean): Promise<{ amount: bigint; preview: Preview }> {
    const base = BigInt((await readTerms()).baseWinChanceBps);
    // with a partner, "base odds" means the partner's odds at (or above) the base win chance
    const ok = (p: Preview) => p.code === 0 && (!baseOdds || p.winChanceBps >= base);

    // 1) decades below hi: hi, hi/10 … hi/10^4
    let pts = [0n, 1n, 2n, 3n, 4n].map((k) => hi / 10n ** k).filter((a, i, arr) => a > 0n && arr.indexOf(a) === i);
    let pvs = await stakePreviews(token, pts, partnered);
    if (pvs[0] && ok(pvs[0])) return { amount: hi, preview: pvs[0] };
    let idx = pvs.findIndex(ok);
    if (idx < 0) return { amount: 0n, preview: pvs[pvs.length - 1]! };
    let lo = pts[idx]!;
    let loPv = pvs[idx]!;
    let up = pts[idx - 1]!;

    // 2) two refinement batches between lo (accepted) and up (rejected): geometric, then linear
    for (const geometric of [true, false]) {
      if (up - lo <= 1n) break;
      const ratio = Number(up) / Number(lo);
      pts = [];
      for (let k = 1; k <= PREVIEW_BATCH; k++) {
        const f = k / (PREVIEW_BATCH + 1);
        const p = geometric ? (lo * BigInt(Math.floor(ratio ** f * 1e9))) / 1_000_000_000n : lo + ((up - lo) * BigInt(k)) / BigInt(PREVIEW_BATCH + 1);
        if (p > lo && p < up && !pts.includes(p)) pts.push(p);
      }
      if (pts.length === 0) break;
      pvs = await stakePreviews(token, pts, partnered);
      // largest accepted point; the next point up (or the old bound) becomes the new rejected bound
      idx = -1;
      for (let i = pvs.length - 1; i >= 0; i--) if (ok(pvs[i]!)) { idx = i; break; }
      if (idx >= 0) {
        up = idx + 1 < pts.length ? pts[idx + 1]! : up;
        lo = pts[idx]!;
        loPv = pvs[idx]!;
      } else {
        up = pts[0]!;
      }
    }
    return { amount: lo, preview: loPv };
  }

  async function vaultWrite(
    functionName: "requestWithdraw" | "cancelWithdraw" | "withdraw",
    args: readonly bigint[],
    what: string,
  ): Promise<TransactionReceipt> {
    const { wc, account, chain } = wallet();
    try {
      const tv = need((await client.vault()) ?? undefined, "staking vault");
      const { request } = await pc.simulateContract({ account, address: tv, abi: treasuryVaultAbi, functionName, args } as never);
      const gas = await pc.estimateContractGas({ account, address: tv, abi: treasuryVaultAbi, functionName, args } as never);
      const hash = await wc.writeContract({ ...(request as object), gas: withRewardHeadroom(gas), account, chain, ...(await sendFees()) } as never);
      return await wait(hash, what);
    } catch (err) {
      throw toFlipperError(err, { symbol: "$FLIPPER" });
    }
  }

  const client = {
    addresses,

    /** $FLIPPER (cached after the first read). */
    async flipper(): Promise<Address> {
      if (!flipperAddress) {
        flipperAddress = await pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "flipper" });
      }
      return flipperAddress;
    },

    /** The fee quote: fee-bearing reads use `maxFeePerGas` (5/3 × base + tip; tip 0 on Arbitrum-family chains). */
    gasFees,
    /** What a transaction is sent with: `txFees(await gasFees())` (cap = 2 × base). */
    sendFees,
    /** base fee + tip: what a transaction is expected to pay per gas (for displaying costs) */
    expectedGasPrice,

    /**
     * The randomness fee a flip of `token` is expected to cost, evaluated at `expectedGasPrice()`: the number to show
     * users. (`flip` sends `randomnessFeeToSend`: the fee at the tx's maxFeePerGas, padded only when it moves with the
     * gas price; the house refunds any excess.)
     */
    async displayRandomnessFee(token: Address): Promise<bigint> {
      const gp = await expectedGasPrice();
      return client.randomnessFeeFor(token, { maxFeePerGas: gp, maxPriorityFeePerGas: 0n });
    },

    /**
     * Lens HouseView; its `randomnessFee` (token flips) is evaluated at the current `gasFees().maxFeePerGas`. `terms`
     * (added here) holds the base terms now: show those, not `params`' base win chance and payout.
     */
    async house(fees?: GasFees): Promise<HouseView> {
      const view = readAt<Omit<HouseView, "terms">>({ address: lens, abi: flipperLensAbi, functionName: "house", args: [house] }, fees);
      const [v, terms] = await Promise.all([view, readTerms(async () => (await view).params)]);
      flipperAddress ??= v.flipper;
      return { ...v, terms };
    },

    /**
     * The house's base terms now: its base win chance, $FLIPPER payout and Kelly multiplier. The edge schedule steps the
     * first two down from the launch terms (45%, 2.05×) as the house's own net buybacks grow, and never back up; the
     * Kelly multiplier backs off from half Kelly toward quarter Kelly as the bankroll nears the drawdown breaker. Route
     * costs, partner discounts and the 2% minimum edge still apply per flip (`preview`), and each flip keeps its
     * flip-time terms.
     */
    async baseTerms(): Promise<BaseTerms> {
      return readTerms();
    },

    /**
     * How the edge comes down as the protocol grows: the house's net buybacks (the real ETH its settlement swaps move
     * into the $FLIPPER/ETH pool), their ratcheted high, the schedule's endpoints and the terms now. null when the house
     * has no edge schedule (turned off, or a house from before it).
     */
    async edgeProgress(): Promise<EdgeProgress | null> {
      let progress: readonly [bigint, bigint, bigint, bigint, bigint, bigint];
      let schedule: readonly [bigint, bigint, number, number, number, number];
      try {
        [progress, schedule] = await Promise.all([
          pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "edgeProgress" }),
          pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "edgeSchedule" }),
        ]);
      } catch (err) {
        if (isMissingView(err)) return null;
        throw err;
      }
      const [netBuybackEth, buybackHigh, fromEth, toEth, win, payout] = progress;
      if (toEth === 0n) return null;
      const [, , winStartBps, winEndBps, payoutStartBps, payoutEndBps] = schedule;
      const span = toEth > fromEth ? toEth - fromEth : 1n;
      const progressed = buybackHigh <= fromEth ? 0 : buybackHigh >= toEth ? 1 : Number(((buybackHigh - fromEth) * 1_000_000n) / span) / 1_000_000;
      const baseWinChanceBps = Number(win);
      const flipperPayoutBps = Number(payout);
      return {
        netBuybackEth,
        buybackHigh,
        fromEth,
        toEth,
        winStartBps,
        winEndBps,
        payoutStartBps,
        payoutEndBps,
        baseWinChanceBps,
        flipperPayoutBps,
        progress: progressed,
        tokenEdgeBps: houseEdgeBps(baseWinChanceBps, 20_000),
        flipperEdgeBps: houseEdgeBps(baseWinChanceBps, flipperPayoutBps),
      };
    },

    async params(): Promise<HouseParams> {
      // an older house (a shorter Params tuple) decodes too, until it's redeployed
      const { data } = await pc.call({ to: house, data: encodeFunctionData({ abi: flipperHouseAbi, functionName: "params" }) });
      return legacyParams(decodeWithLegacyParams<HouseParams>(flipperHouseAbi, "params", data ?? "0x"));
    },

    /**
     * Randomness fee (native ETH) for flipping `token` at the gas price the flip will be sent with ($FLIPPER flips
     * use a much smaller callback budget). Send `randomnessFeeToSend(token, fee)`: exact for a flat fee, padded for a
     * gas-priced one (the house refunds the excess).
     */
    async randomnessFeeFor(token: Address, fees?: GasFees): Promise<bigint> {
      return readAt<bigint>({ address: house, abi: flipperHouseAbi, functionName: "randomnessFeeFor", args: [token] }, fees);
    },

    /**
     * Whether the house's randomness fee moves with the gas price. Chainlink VRF's does (it prices the callback at
     * tx.gasprice); Dice's and Pyth Entropy's are flat, whatever the gas. Probed once per client by quoting
     * `randomnessFeeFor(token)` at two gas prices. If the probe fails, it counts as gas-priced (the fee is padded) and
     * is tried again next time.
     */
    async randomnessFeeIsGasPriced(token: Address, fees?: GasFees): Promise<boolean> {
      feeGasPriced ??= (async () => {
        const at = fees ?? (await gasFees());
        // the second quote is at a lower price, so a node that checks the caller's balance still accepts it
        const lower = at.maxFeePerGas > 1n ? at.maxFeePerGas / 2n : at.maxFeePerGas + 1n;
        const [a, b] = await Promise.all([
          client.randomnessFeeFor(token, at),
          client.randomnessFeeFor(token, { maxFeePerGas: lower, maxPriorityFeePerGas: 0n }),
        ]);
        return a !== b;
      })().catch(() => {
        feeGasPriced = undefined;
        return true;
      });
      return feeGasPriced;
    },

    /**
     * The `msg.value` a flip of `token` sends for randomness: the quoted fee exactly when the adapter's fee is flat
     * (Dice, Pyth Entropy), since padding it would buy nothing and the house's refund of the excess fails for a
     * contract wallet without `receive()`; `paddedRandomnessFee(fee)` when it moves with the gas price (Chainlink VRF).
     * `fee` defaults to `randomnessFeeFor(token, fees)`.
     */
    async randomnessFeeToSend(token: Address, fee?: bigint, fees?: GasFees): Promise<bigint> {
      const at = fees ?? (await gasFees());
      const quoted = fee !== undefined && fee > 0n ? fee : await client.randomnessFeeFor(token, at);
      return (await client.randomnessFeeIsGasPriced(token, at)) ? paddedRandomnessFee(quoted) : quoted;
    },

    /**
     * Price a flip exactly as `flip` would (eth_call; previewFlip simulates swaps so it is not a view). With a
     * `partner`, the call carries the partner suffix, from the connected player when there is one (the registry
     * refuses self-attribution), so the preview shows the partner's odds.
     */
    async preview(token: Address, amount: bigint, fees?: GasFees): Promise<Preview> {
      const dataSuffix = await partnerSuffix();
      // from the connected player: the per-player limit (code 9, too many open flips) shows in the preview, and the
      // registry refuses self-attribution
      const from = wc?.account?.address;
      return simulateAt<Preview>(
        { address: house, abi: houseAbi, functionName: "previewFlip", args: [token, amount], gas: SIMULATION_GAS, ...(dataSuffix ? { dataSuffix } : {}) },
        fees,
        from,
      );
    },

    /** Batch previews (one per amount), through the lens: at base odds (the lens call can't carry a partner suffix). */
    async previews(token: Address, amounts: bigint[], fees?: GasFees): Promise<readonly Preview[]> {
      return simulateAt<readonly Preview[]>(
        { address: lens, abi: lensAbi, functionName: "previews", args: [house, token, amounts], gas: BATCH_SIMULATION_GAS },
        fees,
      );
    },

    /**
     * Largest stake in (0, hi] the house accepts (0 if none). With `baseOdds`, also requires that no
     * chance-based fee applies, i.e. the stake at which the odds return to the base win chance.
     *
     * Each flip's max is sized to its own edge: the house caps a flip's liability at min(`maxBetBps`, `kellyBps` ×
     * its Kelly fraction) of the unreserved treasury, at its final odds and partner share (the preview's
     * `maxLiability`; `house().maxLiability` is only the 5% ceiling). So the max is found by previewing, never
     * computed from the house view. With a `partner`, every preview carries the partner suffix (the partner's share
     * lowers the flip's edge, and so its cap).
     *
     * $FLIPPER without a partner uses `FlipperLens.maxStake` (cheap, and Kelly-aware: it searches previews onchain).
     * Otherwise the stake is searched client-side, since a 20-step onchain binary search can blow public RPC eth_call
     * caps: one batch of ≤5 log-spaced previews, then two refinement batches (result within ~8% below the true max),
     * cached per (token, hi, mode, partner, block).
     */
    async maxStake(token: Address, hi: bigint, baseOdds = false): Promise<{ amount: bigint; preview: Preview }> {
      if (hi <= 0n) throw new FlipperError("Nothing to size: the upper bound is zero.", "config");
      const partnered = !!(await partnerSuffix());
      const block = await pc.getBlockNumber({ cacheTime: 4_000 }).catch(() => 0n);
      const key = `${token.toLowerCase()}:${hi}:${baseOdds}:${partnered}:${block}`;
      const hit = stakeCache.get(key);
      if (hit) return hit;

      let out: { amount: bigint; preview: Preview };
      if (!partnered && isAddressEqual(token, await client.flipper())) {
        const result = await simulateAt<readonly [bigint, Preview]>({
          address: lens,
          abi: lensAbi,
          functionName: "maxStake",
          args: [house, token, hi, baseOdds],
          gas: SIMULATION_GAS,
        });
        out = { amount: result[0], preview: result[1] };
      } else {
        out = await searchStake(token, hi, baseOdds, partnered);
      }
      stakeCache.set(key, out);
      if (stakeCache.size > 64) stakeCache.delete(stakeCache.keys().next().value!);
      return out;
    },

    async tokenView(token: Address): Promise<TokenView> {
      return pc.readContract({ address: lens, abi: flipperLensAbi, functionName: "tokenView", args: [house, token] });
    },

    /** Listed tokens (paginated through the lens). */
    async listedTokens(pageSize = 100n): Promise<TokenView[]> {
      const out: TokenView[] = [];
      for (let offset = 0n; ; offset += pageSize) {
        const page = await pc.readContract({
          address: lens,
          abi: flipperLensAbi,
          functionName: "tokens",
          args: [house, offset, pageSize],
        });
        out.push(...page);
        if (BigInt(page.length) < pageSize) break;
      }
      return out;
    },

    /**
     * name / symbol / decimals. A token that lacks (or reverts on) one of them gets a fallback ("", "???", 18); a
     * transport failure is retried, then thrown, so a flaky RPC never turns into cached "???" / 18-decimals metadata.
     */
    async tokenMeta(token: Address): Promise<{ name: string; symbol: string; decimals: number }> {
      const [name, symbol, decimals] = await Promise.all([
        readTokenField(() => pc.readContract({ address: token, abi: erc20Abi, functionName: "name" }), ""),
        readTokenField(() => pc.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }), "???"),
        readTokenField(() => pc.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }), 18),
      ]);
      return { name, symbol, decimals };
    },

    async balanceOf(token: Address, owner: Address): Promise<bigint> {
      return pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
    },

    async allowance(token: Address, owner: Address): Promise<bigint> {
      return pc.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [owner, house] });
    },

    /**
     * Approve (exact amount, only if needed) → flip with the randomness fee. `minWinChanceBps` defaults to
     * the fresh preview's win chance and the deadline to now + 5 min. Resolves once the flip is included,
     * with the flipId from the FlipRequested log; then call `waitForSettlement`.
     */
    async flip({ token, amount, minWinChanceBps, deadlineSeconds = FLIP_DEADLINE_SECONDS, onStep, symbol, decimals, approve = "exact" }: FlipOptions): Promise<FlipResult> {
      const { wc, account, chain } = wallet();
      try {
        onStep?.({ step: "previewing" });
        const fees = await gasFees();
        const preview = await client.preview(token, amount, fees);
        if (preview.code !== 0) {
          throw new FlipperError(rejectReason(preview.code, { symbol })?.message ?? "Flip rejected.", "rejected", {
            code: preview.code,
          });
        }

        // checked before every flip: a max approval makes this a no-op, and a lowered cap gets approved again
        const allowance = await client.allowance(token, account.address);
        if (allowance < amount) {
          onStep?.({ step: "approving" });
          const send = (value: bigint) =>
            wc.writeContract({ address: token, abi: tokenAbi, functionName: "approve", args: [house, value], account, chain, ...txFees(fees) });
          let approveHash: Hash;
          if (approve === "max") {
            try {
              approveHash = await send(maxUint256);
            } catch (err) {
              // a token that rejects a max approval (e.g. 96-bit allowances) fails gas estimation, before any prompt
              if (toFlipperError(err).kind === "user-rejected") throw err;
              approveHash = await send(amount);
            }
          } else {
            approveHash = await send(amount);
          }
          onStep?.({ step: "approve-sent", hash: approveHash });
          await wait(approveHash, "approval");
          // wallets with an editable spend cap (MetaMask) may have approved less than asked
          const approved = await client.allowance(token, account.address);
          if (approved < amount) {
            const fmt = (v: bigint) => (decimals !== undefined ? formatTokenAmount(v, decimals) : v.toString());
            const sym = symbol ?? "tokens";
            throw new FlipperError(
              `Your wallet approved ${fmt(approved)} ${sym}, less than this flip's ${fmt(amount)} ${sym}. Flip again and allow at least ${fmt(amount)} ${sym} (or keep the suggested spend cap).`,
              "rejected",
            );
          }
        }

        // previewFlip's fee is already per-token (== randomnessFeeFor(token)). Exact for a flat-fee adapter; padded
        // for a gas-priced one (the house refunds the excess)
        const fee = await client.randomnessFeeToSend(token, preview.randomnessFee, fees);
        const minWin = minWinChanceBps ?? Number(preview.winChanceBps);
        const deadline = (await chainNow()) + BigInt(deadlineSeconds);
        const args = [token, amount, minWin, deadline] as const;

        // Simulate first so a rejection surfaces as a decoded error before the wallet prompt.
        // simulate at the highest price the tx can pay, so a gas-price-dependent fee can't come out higher onchain
        const cap = txFees(fees);
        // the partner's ERC-8021 suffix after the arguments: the house attributes the flip onchain
        const dataSuffix = await partnerSuffix();
        const sfx = dataSuffix ? { dataSuffix } : {};
        await pc.simulateContract({ account, address: house, abi: houseAbi, functionName: "flip", args, value: fee, gas: SIMULATION_GAS, gasPrice: cap.maxFeePerGas, ...sfx });
        const gas = await pc.estimateContractGas({ account, address: house, abi: houseAbi, functionName: "flip", args, value: fee, ...cap, ...sfx });
        const isFlipperToken = isAddressEqual(token, await client.flipper());

        onStep?.({ step: "signing" });
        const hash = await wc.writeContract({
          address: house,
          abi: houseAbi,
          functionName: "flip",
          args,
          value: fee,
          // a $FLIPPER flip moves $FLIPPER to the house (an excluded address): see withRewardHeadroom
          gas: isFlipperToken ? max(withHeadroom(gas), withRewardHeadroom(gas)) : max(withHeadroom(gas), routeGasFloor),
          account,
          chain,
          ...cap, // the padded fee covers any effective price up to this cap
          ...sfx,
        });
        onStep?.({ step: "flip-sent", hash });
        const receipt = await wait(hash, "flip");
        const [log] = parseEventLogs({ abi: flipperHouseAbi, eventName: "FlipRequested", logs: receipt.logs }).filter((l) =>
          isAddressEqual(l.address, house),
        );
        if (!log) throw new FlipperError("The flip was mined but no FlipRequested event was found.", "unknown");
        onStep?.({ step: "requested", hash, flipId: log.args.flipId });
        return { flipId: log.args.flipId, hash, receipt, preview, requested: log.args };
      } catch (err) {
        throw toFlipperError(err, { symbol });
      }
    },

    async getFlips(ids: readonly bigint[]): Promise<FlipView[]> {
      if (ids.length === 0) return [];
      const views = await pc.readContract({ address: lens, abi: flipperLensAbi, functionName: "flipsById", args: [house, ids] });
      return [...views];
    },

    async getFlip(id: bigint): Promise<FlipView | undefined> {
      const [f] = await client.getFlips([id]);
      return f;
    },

    /**
     * Lifecycle logs of a flip (searched from `fromBlock`, default the last 5k blocks): FlipSettled,
     * PendingWinResolved (WinPending → paid by `resolvePendingWin`) and FlipCancelled (refund).
     */
    async getFlipEvents(flipId: bigint, fromBlock?: bigint): Promise<FlipEvents> {
      // cacheTime 0: viem caches the block number for the polling interval, which would hide a resolution
      // mined a moment ago; the query itself runs up to the "latest" tag.
      const latest = await pc.getBlockNumber({ cacheTime: 0 });
      const from = fromBlock ?? (latest > 5_000n ? latest - 5_000n : 0n);
      const q = { address: house, abi: flipperHouseAbi, args: { flipId }, fromBlock: from, toBlock: "latest" } as const;
      const [settled, resolved, cancelled, deferred, partnered] = await Promise.all([
        pc.getContractEvents({ ...q, eventName: "FlipSettled" }),
        pc.getContractEvents({ ...q, eventName: "PendingWinResolved" }),
        pc.getContractEvents({ ...q, eventName: "FlipCancelled" }),
        pc.getContractEvents({ ...q, eventName: "SettlementDeferred" }).catch(() => []),
        pc.getContractEvents({ ...q, eventName: "FlipPartner" }).catch(() => []),
      ]);
      const s = settled[settled.length - 1];
      const r = resolved[resolved.length - 1];
      const c = cancelled[cancelled.length - 1];
      const d = deferred[deferred.length - 1];
      const p = partnered[partnered.length - 1]?.args;
      return {
        deferred: d ? { txHash: d.transactionHash } : undefined,
        partner:
          p && p.partnerId !== undefined
            ? {
                partnerId: p.partnerId,
                cutBps: p.cutBps ?? 0n,
                discountBps: p.discountBps ?? 0n,
                winChanceBonusBps: p.winChanceBonusBps ?? 0n,
                partnerShareBps: p.partnerShareBps ?? 0n,
              }
            : undefined,
        settled: s ? { event: s.args as FlipSettledEvent, txHash: s.transactionHash } : undefined,
        resolved:
          r && r.args.tokenPaid !== undefined && r.args.flipperPaid !== undefined
            ? normalizePendingWinResolution({ tokenPaid: r.args.tokenPaid, flipperPaid: r.args.flipperPaid, txHash: r.transactionHash })
            : undefined,
        cancelled: c && c.args.by ? { by: c.args.by, txHash: c.transactionHash } : undefined,
      };
    },

    /** Current state of a flip as a Settlement (status + whatever lifecycle logs exist). */
    async getSettlement(flipId: bigint, fromBlock?: bigint): Promise<Settlement | undefined> {
      const f = await client.getFlip(flipId);
      if (!f || !isFinalStatus(f.status)) return undefined;
      const ev = await client.getFlipEvents(flipId, fromBlock).catch(() => undefined);
      return {
        flipId,
        status: f.status,
        won: isWinStatus(f.status),
        roll: f.roll,
        flip: f,
        event: ev?.settled?.event,
        txHash: ev?.settled?.txHash,
        safeMode: ev?.settled?.event.safeMode ?? false,
        // re-normalised by the flip's final status (Won: bought; WonFallback: paid in $FLIPPER)
        resolved: ev?.resolved
          ? normalizePendingWinResolution(
              // back to the raw event amounts (exactly one of flipperPaid / flipperSpent is non-zero), then by status
              { tokenPaid: ev.resolved.tokenPaid, flipperPaid: ev.resolved.flipperPaid + ev.resolved.flipperSpent, txHash: ev.resolved.txHash },
              f.status,
            )
          : undefined,
        cancelled: ev?.cancelled,
        deferred: ev?.deferred,
        partner: ev?.partner,
      };
    },

    /**
     * Resolves once the flip leaves Pending (typically a few seconds after inclusion): polls the lens, then
     * fetches the lifecycle logs for payout amounts (best effort). `timeoutMs: 0` waits forever.
     */
    async waitForSettlement(flipId: bigint, opts: WaitOptions = {}): Promise<Settlement> {
      return waitUntil(flipId, (st) => isFinalStatus(st), opts);
    },

    /** For a WinPending flip: resolves once its winnings are paid (`PendingWinResolved`: status Won / WonFallback). */
    async waitForResolution(flipId: bigint, opts: WaitOptions = {}): Promise<Settlement> {
      return waitUntil(flipId, (st) => isFinalStatus(st) && st !== FlipStatus.WinPending, { pollIntervalMs: 2_000, timeoutMs: 0, ...opts });
    },

    /** Flip ids requested by `player` (log scan in ≤10k-block chunks). */
    async findFlipIds(player: Address, fromBlock: bigint, toBlock?: bigint): Promise<bigint[]> {
      const end = toBlock ?? (await pc.getBlockNumber());
      const ids: bigint[] = [];
      for (let from = fromBlock; from <= end; from += 10_000n) {
        const to = from + 9_999n > end ? end : from + 9_999n;
        const logs = await pc.getContractEvents({
          address: house,
          abi: flipperHouseAbi,
          eventName: "FlipRequested",
          args: { player },
          fromBlock: from,
          toBlock: to,
        });
        for (const l of logs) if (l.args.flipId !== undefined) ids.push(l.args.flipId);
      }
      return ids;
    },

    /**
     * Payments the house couldn't push, per token (same order as `tokens`), then native ETH as a last entry
     * (`token: zeroAddress`, `native: true`): a randomness-fee excess the house couldn't refund, e.g. to a contract
     * wallet without `receive()`. `claim(token)` withdraws each (`claim(zeroAddress)` for ETH). `{ eth: false }`
     * leaves ETH out.
     */
    async claimables(user: Address, tokens: readonly Address[], opts: { eth?: boolean } = {}): Promise<{ token: Address; amount: bigint; native?: boolean }[]> {
      const eth = opts.eth !== false;
      const list: Address[] = eth ? [...tokens, zeroAddress] : [...tokens];
      if (list.length === 0) return [];
      const amounts = await pc.readContract({
        address: lens,
        abi: flipperLensAbi,
        functionName: "claimables",
        args: [house, user, list],
      });
      return list.map((token, i) => (eth && i === tokens.length ? { token, amount: amounts[i] ?? 0n, native: true } : { token, amount: amounts[i] ?? 0n }));
    },

    /** Native ETH the house owes `user`: a randomness-fee excess it couldn't refund. `claim(zeroAddress)` withdraws it. */
    async claimableEth(user: Address): Promise<bigint> {
      return pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "claimable", args: [user, zeroAddress] });
    },

    /**
     * The house's balance of `token` (`zeroAddress`: ETH) less everything it owes in it (`lens.surplus`). It should
     * read 0: the house runs with no buffer. Negative means a claim could fail; positive is unaccounted dust.
     */
    async surplus(token: Address): Promise<bigint> {
      return pc.readContract({ address: lens, abi: flipperLensAbi, functionName: "surplus", args: [house, token] });
    },

    /**
     * The house's per-player flip limits: `maxOpenPerPlayer` flips waiting for randomness at once (reject code 9
     * beyond it; 0 onchain reads as `DEFAULT_MAX_OPEN_PER_PLAYER`), and `minLiability`, the smallest liability a flip
     * may carry in $FLIPPER (reject code 2 below it; see `minStake`). A house from before the limits reads as the
     * default cap and no floor.
     */
    async flipLimits(): Promise<FlipLimits> {
      try {
        const [maxOpen, minLiability] = await Promise.all([
          pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "maxOpenPerPlayer" }),
          pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "minLiability" }),
        ]);
        return { maxOpenPerPlayer: Number(maxOpen) || DEFAULT_MAX_OPEN_PER_PLAYER, minLiability };
      } catch {
        return { maxOpenPerPlayer: DEFAULT_MAX_OPEN_PER_PLAYER, minLiability: 0n };
      }
    },

    /** How many of `player`'s flips are waiting for randomness (reject code 9 once it reaches `maxOpenPerPlayer`). */
    async openFlips(player: Address): Promise<number> {
      try {
        return Number(await pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "openFlips", args: [player] }));
      } catch {
        return 0; // a house from before the counter
      }
    },

    /**
     * The smallest stake of `token` the house accepts: below it, a flip's liability is under `minLiability` (reject
     * code 2, "below the minimum size"). 0n when the house has no floor; null when `token` can't be priced now.
     * $FLIPPER is exact (liability = stake × (the current $FLIPPER payout − 1×)). Other tokens price their liability through the
     * route, so it's extrapolated from previews and checked (at most a few eth_calls); the answer can sit a hair above
     * the true minimum.
     */
    async minStake(token: Address, fees?: GasFees): Promise<bigint | null> {
      const { minLiability } = await client.flipLimits();
      if (minLiability === 0n) return 0n;
      if (isAddressEqual(token, await client.flipper())) {
        const gain = BigInt((await readTerms()).flipperPayoutBps) - BPS;
        return gain > 0n ? (minLiability * BPS + gain - 1n) / gain : null;
      }
      const at = fees ?? (await gasFees());
      let amount = 10n ** BigInt((await client.tokenMeta(token)).decimals);
      let hi: bigint | undefined; // the smallest stake seen that clears the floor
      for (let i = 0; i < 6; i++) {
        const pv = await client.preview(token, amount, at);
        if (pv.liability === 0n) return hi ?? null; // unpriced (no quote, not listed, too big to route)
        const near = hi !== undefined && hi - amount <= hi / 200n; // within 0.5% of the best accepted stake
        if (pv.liability >= minLiability) {
          if (near) return amount;
          if (hi === undefined || amount < hi) hi = amount;
        } else if (near) {
          return hi!;
        }
        // extrapolate through this preview, aiming 0.25% high: price impact makes a bigger stake's liability grow faster
        const est = estimateMinStake(amount, pv.liability, minLiability);
        const next = est + est / 400n + 1n;
        if (hi !== undefined && next >= hi) return hi;
        amount = next;
      }
      return hi ?? amount;
    },

    /**
     * "Now" for contract checks, in unix seconds: the later of the latest block's timestamp and the wall clock. A fork
     * or a stalled chain can lag the wall clock (a deadline from block time alone would already be past) or run ahead
     * of it (dev fast-forwards); flip deadlines, the pending-win timeout and countdowns all use this.
     */
    async now(): Promise<bigint> {
      return chainNow();
    },

    // ── drawdown circuit breaker ─────────────────────────────────────────────────────────────────────────

    /**
     * Whether the drawdown circuit breaker has locked the protocol. While locked, new flips are rejected (code 8),
     * and claims, listings, vault actions and harvests revert with `ProtocolLocked`. Flips already requested aren't
     * lost: randomness delivered meanwhile is recorded and settled by `settleDeferred` after the unlock.
     */
    async locked(): Promise<boolean> {
      return pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "locked" });
    },

    /** The breaker's state: the lock, the bankroll's NAV units and all-time high, and the unlocker role. */
    async breaker(): Promise<BreakerState> {
      const read = <T,>(functionName: "locked" | "navUnits" | "navAth" | "lockMinTreasury" | "unlocker" | "pendingUnlocker") =>
        pc.readContract({ address: house, abi: flipperHouseAbi, functionName }) as Promise<T>;
      const [locked, navUnits, navAth, lockMinTreasury, unlocker, pendingUnlocker] = await Promise.all([
        read<boolean>("locked"),
        read<bigint>("navUnits"),
        read<bigint>("navAth"),
        read<bigint>("lockMinTreasury"),
        read<Address>("unlocker"),
        read<Address>("pendingUnlocker"),
      ]);
      return { locked, navUnits, navAth, lockMinTreasury, unlocker, pendingUnlocker };
    },

    /** Run the drawdown check now (anyone may): it locks if the NAV per unit is below half its all-time high. */
    async checkDrawdown(): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      try {
        const { request } = await pc.simulateContract({ account, address: house, abi: houseAbi, functionName: "checkDrawdown" });
        const hash = await wc.writeContract({ ...request, account, chain, ...(await sendFees()) } as unknown as typeof request);
        return await wait(hash, "drawdown check");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /**
     * Unlock the protocol (the unlocker only). `resetAth` re-bases the all-time high to today's NAV, the usual choice
     * once the cause is dealt with (keeping the old high would re-lock at the next check).
     */
    async unlock(resetAth: boolean): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      try {
        const { request } = await pc.simulateContract({ account, address: house, abi: houseAbi, functionName: "unlock", args: [resetAth] });
        const hash = await wc.writeContract({ ...request, account, chain, ...(await sendFees()) } as unknown as typeof request);
        return await wait(hash, "unlock");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /**
     * Re-base the NAV all-time high the breaker measures against (the unlocker only): `newAth` in NAV-per-unit terms,
     * or 0n for today's NAV. Out-of-range values revert with `AthOutOfBounds`.
     */
    async resetNavAth(newAth: bigint): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      try {
        const { request } = await pc.simulateContract({ account, address: house, abi: houseAbi, functionName: "resetNavAth", args: [newAth] });
        const hash = await wc.writeContract({ ...request, account, chain, ...(await sendFees()) } as unknown as typeof request);
        return await wait(hash, "ATH reset");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /**
     * Whether `flipId`'s randomness arrived while the protocol was locked (`SettlementDeferred`) and it hasn't been
     * settled yet. Such a flip can't be cancelled; `settleDeferred` settles it after the unlock.
     */
    async isDeferred(flipId: bigint, fromBlock?: bigint): Promise<boolean> {
      const f = await client.getFlip(flipId);
      if (!f || f.status !== FlipStatus.Pending) return false;
      return !!(await deferredLog(flipId, fromBlock));
    },

    /**
     * Dry-run `settleDeferred(flipId)`. `locked`: the protocol is still locked; `notDeferred`: nothing to settle (not
     * deferred, or already settled).
     */
    async canSettleDeferred(flipId: bigint): Promise<{ ok: true } | { ok: false; reason: string; locked?: boolean; notDeferred?: boolean }> {
      try {
        await pc.simulateContract({ account: wc?.account ?? zeroAddress, address: house, abi: houseAbi, functionName: "settleDeferred", args: [flipId], gas: SIMULATION_GAS });
        return { ok: true };
      } catch (err) {
        const e = toFlipperError(err);
        const notDeferred = e.details.errorName === "BadStatus";
        return {
          ok: false,
          reason: notDeferred ? "This flip has nothing left to settle." : e.message,
          locked: e.details.errorName === "ProtocolLocked" || undefined,
          notDeferred: notDeferred || undefined,
        };
      }
    },

    /**
     * Settle a flip whose randomness arrived while the protocol was locked (anyone may, once it's unlocked). It settles
     * market-free (safe mode): a loss keeps the stake as inventory; a win returns the stake and reserves the winnings.
     */
    async settleDeferred(flipId: bigint): Promise<{ receipt: TransactionReceipt; settlement?: Settlement }> {
      const { wc, account, chain } = wallet();
      try {
        const { request } = await pc.simulateContract({ account, address: house, abi: houseAbi, functionName: "settleDeferred", args: [flipId], gas: SIMULATION_GAS });
        const gas = await pc.estimateContractGas({ account, address: house, abi: houseAbi, functionName: "settleDeferred", args: [flipId] });
        const hash = await wc.writeContract({ ...request, gas: withRewardHeadroom(gas), account, chain, ...(await sendFees()) } as unknown as typeof request);
        const receipt = await wait(hash, "settlement");
        const settlement = await client.getSettlement(flipId, receipt.blockNumber).catch(() => undefined);
        return { receipt, settlement };
      } catch (err) {
        const e = toFlipperError(err);
        if (e.details.errorName === "BadStatus") throw new FlipperError("This flip has nothing left to settle.", "revert", e.details);
        throw e;
      }
    },

    // ── the team's stake (PrincipalLock) ────────────────────────────────────────────────────────────────

    /**
     * The team's stake of vault shares, locked for good in the PrincipalLock (`addresses.principalLock`): its principal
     * (never withdrawable), current value, the withdrawable excess above it, unswept rewards, the dev address payouts
     * go to, and a pending excess withdrawal. Null when the deployment has no lock.
     */
    async teamStake(): Promise<TeamStake | null> {
      const lock = addresses.principalLock;
      if (!lock) return null;
      const read = <T,>(functionName: "principal" | "value" | "withdrawableExcess" | "pendingVaultRewards" | "pendingHolderRewards" | "devAddress" | "pendingWithdrawal") =>
        pc.readContract({ address: lock, abi: principalLockAbi, functionName }) as Promise<T>;
      const [principal, value, withdrawableExcess, pendingVaultRewards, pendingHolderRewards, devAddress, pending] = await Promise.all([
        read<bigint>("principal"),
        read<bigint>("value"),
        read<bigint>("withdrawableExcess"),
        read<bigint>("pendingVaultRewards"),
        read<bigint>("pendingHolderRewards"),
        read<Address>("devAddress"),
        read<readonly [bigint, bigint, bigint]>("pendingWithdrawal"),
      ]);
      const pendingRequest = pending[0] > 0n ? { shares: pending[0], assets: pending[1], readyAt: pending[2] } : null;
      const requestableExcess = teamExcessMax(principal, withdrawableExcess, pendingRequest?.assets ?? 0n, TEAM_EXCESS_CUSHION_BPS);
      return { lock, principal, value, withdrawableExcess, pendingVaultRewards, pendingHolderRewards, devAddress, pendingRequest, requestableExcess };
    },

    /**
     * Sweep the team stake's rewards to the dev address (anyone may): `"all"` (default: both sources), `"vault"` (the
     * vault's staking rewards) or `"holder"` ($FLIPPER holder rewards).
     */
    async sweepTeamRewards(which: "all" | "vault" | "holder" = "all"): Promise<{ receipt: TransactionReceipt; vaultRewards: bigint; holderRewards: bigint }> {
      if (which === "all") {
        const { receipt, result } = await lockWrite<readonly [bigint, bigint]>("sweepRewards", []);
        return { receipt, vaultRewards: result?.[0] ?? 0n, holderRewards: result?.[1] ?? 0n };
      }
      const { receipt, result } = await lockWrite<bigint>(which === "vault" ? "sweepVaultRewards" : "sweepHolderRewards", []);
      return { receipt, vaultRewards: which === "vault" ? (result ?? 0n) : 0n, holderRewards: which === "holder" ? (result ?? 0n) : 0n };
    },

    /**
     * Queue a withdrawal of `amount` $FLIPPER of the stake's excess over the principal (the dev address only). It also
     * sweeps the rewards; the vault's cooldown then applies.
     *
     * `"max"` (or `maxUint256`) requests `teamStake().requestableExcess`: the unqueued excess less a cushion of 1% of
     * the principal (`cushionBps`, default `TEAM_EXCESS_CUSHION_BPS`), since asking for all of it often ends in
     * `PrincipalBreach` at low volume, when the stake's value dips before the withdrawal completes. `cushionBps: 0n`
     * with `maxUint256` sends the contract's own "everything" instead. Throws a plain-English error, before sending,
     * when the connected account isn't the dev address or there's nothing to request.
     */
    async requestTeamExcess(amount: bigint | "max", opts: { cushionBps?: bigint } = {}): Promise<TransactionReceipt> {
      await needDevAddress();
      let request = amount === "max" ? maxUint256 : amount;
      const cushionBps = opts.cushionBps ?? TEAM_EXCESS_CUSHION_BPS;
      if (request === maxUint256 && cushionBps > 0n) {
        const stake = (await client.teamStake())!; // needDevAddress: the lock exists
        request = teamExcessMax(stake.principal, stake.withdrawableExcess, stake.pendingRequest?.assets ?? 0n, cushionBps);
        if (request === 0n) {
          throw new FlipperError(
            "There's nothing to withdraw yet: the stake's excess doesn't clear its 1% cushion above the principal (and anything already queued).",
            "rejected",
          );
        }
      }
      return (await lockWrite("requestExcess", [request])).receipt;
    },

    /** Complete the queued excess withdrawal after its cooldown (the dev address only): pays the dev address, sweeps both reward sources. */
    async withdrawTeamExcess(): Promise<{ receipt: TransactionReceipt; amount: bigint }> {
      await needDevAddress();
      const { receipt, result } = await lockWrite<bigint>("withdrawExcess", []);
      return { receipt, amount: result ?? 0n };
    },

    /** Cancel the queued excess withdrawal (the dev address only). */
    async cancelTeamExcess(): Promise<TransactionReceipt> {
      await needDevAddress();
      return (await lockWrite("cancelExcess", [])).receipt;
    },

    // ── partners (ERC-8021 attribution) ──────────────────────────────────────────────────────────────────

    /** The ERC-8021 suffix this client appends to flips (`registry.suffixOf(partner)`), or undefined without a partner. */
    partnerSuffix,

    /** The PartnerRegistry, or null when the house has none. */
    async partnerRegistry(): Promise<Address | null> {
      return partnerRegistryAddress();
    },

    /** A partner's registration (id ≥ 1). */
    async partnerInfo(id: bigint): Promise<PartnerInfo> {
      const registry = need((await partnerRegistryAddress()) ?? undefined, "partner registry");
      const p = await pc.readContract({ address: registry, abi: partnerRegistryAbi, functionName: "partner", args: [id] });
      return { id, code: p.code, controller: p.controller, payout: p.payout, discountBps: p.discountBps, tier: p.tier, status: p.status, allowSelf: p.allowSelf };
    },

    /** The id registered for `code`, or 0n when none. */
    async partnerIdOfCode(code: string): Promise<bigint> {
      const registry = need((await partnerRegistryAddress()) ?? undefined, "partner registry");
      return pc.readContract({ address: registry, abi: partnerRegistryAbi, functionName: "idOfCode", args: [keccak256(stringToHex(code))] });
    },

    /** A tier's cut of each attributed flip's expected house profit, in bps. */
    async partnerTierCutBps(tier: number): Promise<number> {
      const registry = need((await partnerRegistryAddress()) ?? undefined, "partner registry");
      return pc.readContract({ address: registry, abi: partnerRegistryAbi, functionName: "tierCutBps", args: [tier] });
    },

    /**
     * Register a partner code (1–32 of [a-z0-9_-]) with the address its share is paid to and the discount handed to
     * players (bps of the partner's cut). It is active at once, in the registry's default tier: no approval.
     */
    async registerPartner({ code, payout, discountBps = 0 }: { code: string; payout: Address; discountBps?: number }): Promise<{ receipt: TransactionReceipt; id: bigint }> {
      if (!isPartnerCode(code)) throw new FlipperError("A partner code is 1–32 characters of a–z, 0–9, _ and -.", "config");
      const registry = need((await partnerRegistryAddress()) ?? undefined, "partner registry");
      const { wc, account, chain } = wallet();
      try {
        const { request, result } = await pc.simulateContract({ account, address: registry, abi: partnerRegistryAbi, functionName: "register", args: [code, payout, discountBps] });
        const hash = await wc.writeContract({ ...request, account, chain, ...(await sendFees()) } as unknown as typeof request);
        return { receipt: await wait(hash, "partner registration"), id: result };
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /** The partner's controller changes its payout address, discount or controller. */
    async updatePartner(id: bigint, change: { payout: Address } | { discountBps: number } | { controller: Address }): Promise<TransactionReceipt> {
      const registry = need((await partnerRegistryAddress()) ?? undefined, "partner registry");
      const { wc, account, chain } = wallet();
      const req =
        "payout" in change
          ? ({ functionName: "setPayout", args: [id, change.payout] } as const)
          : "discountBps" in change
            ? ({ functionName: "setDiscount", args: [id, change.discountBps] } as const)
            : ({ functionName: "setController", args: [id, change.controller] } as const);
      try {
        const { request } = await pc.simulateContract({ account, address: registry, abi: partnerRegistryAbi, ...req } as never);
        const hash = await wc.writeContract({ ...(request as object), account, chain, ...(await sendFees()) } as never);
        return await wait(hash, "partner update");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /** A flip's partner attribution, fixed at flip time: partner id (0n = none) and its share of the value, in bps. */
    async flipPartner(flipId: bigint): Promise<{ partnerId: bigint; shareBps: number }> {
      const [partnerId, shareBps] = await pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "flipPartner", args: [flipId] });
      return { partnerId: BigInt(partnerId), shareBps };
    },

    /** $FLIPPER accrued to a partner and not yet claimed. */
    async partnerAccrued(partnerId: bigint): Promise<bigint> {
      return pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "partnerAccrued", args: [partnerId] });
    },

    /** $FLIPPER accrued to every partner and not yet claimed. */
    async partnerAccruedTotal(): Promise<bigint> {
      return pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "partnerAccruedTotal" });
    },

    /** Pay a partner's accrued $FLIPPER to its current payout address (anyone may call). Returns the amount paid. */
    async claimPartner(partnerId: bigint): Promise<{ receipt: TransactionReceipt; amount: bigint }> {
      const { wc, account, chain } = wallet();
      try {
        const { request, result } = await pc.simulateContract({ account, address: house, abi: houseAbi, functionName: "claimPartner", args: [partnerId] });
        const gas = await pc.estimateContractGas({ account, address: house, abi: houseAbi, functionName: "claimPartner", args: [partnerId] });
        // a $FLIPPER transfer out of the house (an excluded address): see withRewardHeadroom
        const hash = await wc.writeContract({ ...request, gas: withRewardHeadroom(gas), account, chain, ...(await sendFees()) } as unknown as typeof request);
        return { receipt: await wait(hash, "partner claim"), amount: result };
      } catch (err) {
        throw toFlipperError(err, { symbol: "$FLIPPER" });
      }
    },

    // ── pending wins (WinPending: the stake came back at settlement, the winnings are still owed) ─────────────

    /**
     * WinPending flips, oldest first: `player`'s (or everyone's, with `zeroAddress`). The lens scans flip ids, so the
     * range is paged: from `fromId` (default 1) up to the house's `nextFlipId`, `pageSize` ids per eth_call.
     */
    async pendingWins(player: Address, opts: { fromId?: bigint; toId?: bigint; pageSize?: bigint } = {}): Promise<FlipView[]> {
      const page = opts.pageSize ?? 2_000n;
      const end = opts.toId ?? (await client.house()).nextFlipId;
      const out: FlipView[] = [];
      for (let from = opts.fromId && opts.fromId > 0n ? opts.fromId : 1n; from < end; from += page) {
        const to = from + page > end ? end : from + page;
        const views = await pc.readContract({ address: lens, abi: flipperLensAbi, functionName: "pendingWins", args: [house, player, from, to] });
        out.push(...views);
      }
      return out;
    },

    /**
     * When a pending win can always be resolved (unix seconds): `createdAt + params.pendingTimeout`. From then on
     * `resolvePendingWin` pays the reserved liability in $FLIPPER if the token still can't be bought.
     */
    async resolveAt(flip: Pick<FlipView, "createdAt">): Promise<number> {
      return pendingWinResolveAt(flip, (await client.house()).params);
    },

    /**
     * Dry-run `resolvePendingWin(flipId)` (eth_call, from the connected account or the zero address: anyone may call
     * it). `ok` means a retry would pay out now. `tooEarly`: the winnings can't be bought yet and the timeout
     * hasn't passed; `notPending`: it was already resolved.
     */
    async canResolvePendingWin(flipId: bigint): Promise<{ ok: true } | { ok: false; reason: string; tooEarly?: boolean; notPending?: boolean }> {
      try {
        await pc.simulateContract({
          account: wc?.account ?? zeroAddress,
          address: house,
          abi: houseAbi,
          functionName: "resolvePendingWin",
          args: [flipId],
          gas: SIMULATION_GAS,
        });
        return { ok: true };
      } catch (err) {
        const e = toFlipperError(err);
        return { ok: false, reason: e.message, tooEarly: e.details.errorName === "TooEarly" || undefined, notPending: e.details.errorName === "BadStatus" || undefined };
      }
    },

    /**
     * Retry a pending win's payout: `resolvePendingWin(flipId)`, which anyone may call. It buys the winnings through
     * the token's route and pays them; after `resolveAt(flip)` it pays the reserved liability in $FLIPPER instead if
     * the buy still fails. Reverts `TooEarly` (buy failed, before the timeout) or `BadStatus` (not pending).
     * Returns what the player received (`tokenPaid` on Won, `flipperPaid` on WonFallback) and, separately, what the
     * house spent buying the winnings (`flipperSpent`).
     */
    async resolvePendingWin(flipId: bigint): Promise<{ receipt: TransactionReceipt } & Omit<PendingWinResolution, "txHash">> {
      const { wc, account, chain } = wallet();
      try {
        const { request } = await pc.simulateContract({ account, address: house, abi: houseAbi, functionName: "resolvePendingWin", args: [flipId], gas: SIMULATION_GAS });
        const gas = await pc.estimateContractGas({ account, address: house, abi: houseAbi, functionName: "resolvePendingWin", args: [flipId] });
        const hash = await wc.writeContract({
          ...request,
          gas: max(withHeadroom(gas), routeGasFloor),
          account,
          chain,
          ...(await sendFees()),
        } as unknown as typeof request);
        const receipt = await wait(hash, "payout");
        const [log] = parseEventLogs({ abi: flipperHouseAbi, eventName: "PendingWinResolved", logs: receipt.logs }).filter((l) => isAddressEqual(l.address, house));
        const status = (await client.getFlip(flipId).catch(() => undefined))?.status;
        const { txHash: _t, ...paid } = normalizePendingWinResolution(
          { tokenPaid: log?.args.tokenPaid ?? 0n, flipperPaid: log?.args.flipperPaid ?? 0n, txHash: receipt.transactionHash },
          status,
        );
        return { receipt, ...paid };
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    async claim(token: Address): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      try {
        const { request } = await pc.simulateContract({ account, address: house, abi: houseAbi, functionName: "claim", args: [token] });
        // request is a legacy/1559 union; adding EIP-1559 fees is valid at runtime, so assert the type
        const hash = await wc.writeContract({ ...request, account, chain, ...(await sendFees()) } as unknown as typeof request);
        return await wait(hash, "claim");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /** @internal */
    async isEligible(token: Address): Promise<boolean> {
      const adapter = need(addresses.hookitAdapter, "hookit adapter");
      return pc.readContract({ address: adapter, abi: hookitRouteAdapterAbi, functionName: "isEligible", args: [token] });
    },

    /** @internal */
    async canList(token: Address): Promise<{ ok: true } | { ok: false; reason: string; routeCostBps?: bigint }> {
      const adapter = need(addresses.hookitAdapter, "hookit adapter");
      try {
        await pc.simulateContract({
          account: wc?.account ?? zeroAddress,
          address: adapter,
          abi: hookitListingAbi,
          functionName: "registerAndList",
          args: [token],
          gas: SIMULATION_GAS,
        });
        return { ok: true };
      } catch (err) {
        const e = toFlipperError(err);
        const routeCostBps = e.details.errorName === "ListingProbeFailed" ? (e.details.args?.[0] as bigint) : undefined;
        return { ok: false, reason: e.message, routeCostBps };
      }
    },

    /** @internal */
    async listToken(token: Address, opts: ListingSendOptions = {}): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      const adapter = need(addresses.hookitAdapter, "hookit adapter");
      try {
        const { request } = await pc.simulateContract({
          account,
          address: adapter,
          abi: hookitListingAbi,
          functionName: "registerAndList",
          args: [token],
        });
        const gas = await pc.estimateContractGas({ account, address: adapter, abi: hookitListingAbi, functionName: "registerAndList", args: [token] });
        const hash = await wc.writeContract({
          ...request,
          gas: max(withHeadroom(gas), HOOKIT_TX_GAS_FLOOR),
          account,
          chain,
          ...(await sendFees()),
        } as unknown as typeof request);
        opts.onSent?.(hash);
        return await wait(hash, "listing");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /** `V4RouteAdapter.check(token, key)`: reason code (0 = ok, see `v4CheckReason`) and ETH depth. */
    async v4Check(token: Address, key: PoolKey): Promise<{ reason: number; depthWei: bigint }> {
      const adapter = need(addresses.v4Adapter, "v4 adapter");
      const [reason, depthWei] = await pc.readContract({ address: adapter, abi: v4RouteAdapterAbi, functionName: "check", args: [token, key] });
      return { reason: Number(reason), depthWei };
    },

    /** Dry-run `registerAndList` (catches the house's ListingProbeFailed for thin liquidity). */
    async canRegisterAndList(token: Address, key: PoolKey): Promise<{ ok: true } | { ok: false; reason: string; routeCostBps?: bigint }> {
      const adapter = need(addresses.v4Adapter, "v4 adapter");
      try {
        await pc.simulateContract({
          account: wc?.account ?? zeroAddress,
          address: adapter,
          abi: v4ListingAbi,
          functionName: "registerAndList",
          args: [token, key],
          gas: SIMULATION_GAS,
        });
        return { ok: true };
      } catch (err) {
        const e = toFlipperError(err);
        const routeCostBps = e.details.errorName === "ListingProbeFailed" ? (e.details.args?.[0] as bigint) : undefined;
        return { ok: false, reason: e.message, routeCostBps };
      }
    },

    /**
     * Permissionlessly list any Uniswap v4 token through the V4RouteAdapter: registers `key` (validated by the
     * adapter) and calls house.listToken in one tx. The token contract itself is not vetted.
     */
    async registerAndList(token: Address, key: PoolKey, opts: ListingSendOptions = {}): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      const adapter = need(addresses.v4Adapter, "v4 adapter");
      try {
        const { request } = await pc.simulateContract({
          account,
          address: adapter,
          abi: v4ListingAbi,
          functionName: "registerAndList",
          args: [token, key],
          gas: SIMULATION_GAS,
        });
        const gas = await pc.estimateContractGas({ account, address: adapter, abi: v4ListingAbi, functionName: "registerAndList", args: [token, key] });
        const hash = await wc.writeContract({
          ...request,
          gas: max(withHeadroom(gas), routeGasFloor),
          account,
          chain,
          ...(await sendFees()),
        } as unknown as typeof request);
        opts.onSent?.(hash);
        return await wait(hash, "listing");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /** `V3RouteAdapter.check(token, v3Pool)`: reason code (0 = ok, see `v3CheckReason`) and ETH depth. */
    async v3Check(token: Address, pool: Address): Promise<{ reason: number; depthWei: bigint }> {
      const adapter = need(addresses.v3Adapter, "v3 adapter");
      const [reason, depthWei] = await pc.readContract({ address: adapter, abi: v3RouteAdapterAbi, functionName: "check", args: [token, pool] });
      return { reason: Number(reason), depthWei };
    },

    /** Dry-run `V3RouteAdapter.registerAndList` (catches the house's ListingProbeFailed for thin liquidity). */
    async canRegisterAndListV3(token: Address, pool: Address): Promise<{ ok: true } | { ok: false; reason: string; routeCostBps?: bigint }> {
      const adapter = need(addresses.v3Adapter, "v3 adapter");
      const r = await dryRun({ address: adapter, abi: v3ListingAbi, functionName: "registerAndList", args: [token, pool] }, "v3");
      return r.ok ? { ok: true } : { ok: false, reason: r.reason, routeCostBps: r.routeCostBps };
    },

    /** Permissionlessly list a token through its Uniswap v3 pool (V3RouteAdapter: register + house.listToken in one tx). */
    async registerAndListV3(token: Address, pool: Address, opts: ListingSendOptions = {}): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      const adapter = need(addresses.v3Adapter, "v3 adapter");
      try {
        const req = { account, address: adapter, abi: v3ListingAbi, functionName: "registerAndList", args: [token, pool] } as const;
        const { request } = await pc.simulateContract({ ...req, gas: SIMULATION_GAS });
        const gas = await pc.estimateContractGas(req);
        const hash = await wc.writeContract({
          ...request,
          gas: max(withHeadroom(gas), routeGasFloor),
          account,
          chain,
          ...(await sendFees()),
        } as unknown as typeof request);
        opts.onSent?.(hash);
        return await wait(hash, "listing");
      } catch (err) {
        throw venueError(err, "v3");
      }
    },

    /**
     * Can `target` be listed right now? The adapter's `check()` first (its reason is the clearest), then a dry run of
     * the listing itself (the house's liquidity probe). Never throws: failures come back as `{ ok: false, reason }`.
     */
    async checkListing(target: ListingTarget): Promise<ListingCheck> {
      const venue = target.venue;
      try {
        if (target.venue === "hookit") {
          const r = await dryRun(
            { address: need(addresses.hookitAdapter, "hookit adapter"), abi: hookitListingAbi, functionName: "registerAndList", args: [target.token] },
            "hookit",
          );
          if (r.ok) return { ok: true, venue };
          const { ok: _ok, ...why } = r;
          return { ok: false, venue, ...why };
        }
        const c = target.venue === "v4" ? await client.v4Check(target.token, target.key) : await client.v3Check(target.token, target.pool);
        if (c.reason !== 0) {
          return { ok: false, venue, code: c.reason, reason: target.venue === "v4" ? v4CheckReason(c.reason) : v3CheckReason(c.reason) };
        }
        const r =
          target.venue === "v4"
            ? await dryRun({ address: need(addresses.v4Adapter, "v4 adapter"), abi: v4ListingAbi, functionName: "registerAndList", args: [target.token, target.key] }, "v4")
            : await dryRun({ address: need(addresses.v3Adapter, "v3 adapter"), abi: v3ListingAbi, functionName: "registerAndList", args: [target.token, target.pool] }, "v3");
        if (r.ok) return { ok: true, venue, depthWei: c.depthWei };
        const { ok: _ok, ...why } = r;
        return { ok: false, venue, ...why };
      } catch (err) {
        return { ok: false, venue, reason: venueError(err, venue).message };
      }
    },

    /** List `target` through its venue's adapter (`registerAndList` on the v4 or v3 adapter). */
    async list(target: ListingTarget, opts: ListingSendOptions = {}): Promise<TransactionReceipt> {
      if (target.venue === "v4") return client.registerAndList(target.token, target.key, opts);
      if (target.venue === "v3") return client.registerAndListV3(target.token, target.pool, opts);
      return client.listToken(target.token, opts);
    },

    // ── native ETH (wrapped into WETH) ───────────────────────────────────────────────────────────────────

    /** The chain's WETH: `addresses.weth`, else the v3 adapter's `weth()`, else `WETH_ADDRESSES[chainId]`. */
    async weth(): Promise<Address> {
      if (wethAddress) return wethAddress;
      if (addresses.v3Adapter) {
        const w = await pc.readContract({ address: addresses.v3Adapter, abi: v3RouteAdapterAbi, functionName: "weth" }).catch(() => undefined);
        if (w && !isAddressEqual(w, zeroAddress)) return (wethAddress = w);
      }
      const id = pc.chain?.id ?? (await pc.getChainId());
      const known = WETH_ADDRESSES[id];
      if (!known) throw new FlipperError("The WETH address isn't configured for this chain.", "config");
      return (wethAddress = known);
    },

    /**
     * Whether the connected wallet can send an atomic EIP-5792 batch on this chain (`wallet_getCapabilities` reports
     * `atomic: supported | ready`). Cached per account; false when the wallet doesn't implement EIP-5792.
     */
    async supportsAtomicBatch(): Promise<boolean> {
      if (!wc?.account) return false;
      const chainId = wc.chain?.id ?? pc.chain?.id ?? (await pc.getChainId());
      const key = `${wc.account.address}:${chainId}`;
      const hit = batchSupport.get(key);
      if (hit !== undefined) return hit;
      let ok = false;
      try {
        const caps = (await getCapabilities(wc as never, { account: wc.account, chainId })) as Record<string, unknown>;
        const atomic = caps?.atomic as { status?: string } | undefined;
        const legacy = caps?.atomicBatch as { supported?: boolean } | undefined;
        ok = atomic?.status === "supported" || atomic?.status === "ready" || legacy?.supported === true;
      } catch {
        ok = false;
      }
      batchSupport.set(key, ok);
      return ok;
    },

    /**
     * Flip native ETH: wraps `amount` into WETH and flips the WETH (wins pay out in WETH; `unwrapWeth` turns it back).
     * With a wallet that supports atomic batches, wrap + approve + flip is one `wallet_sendCalls` confirmation;
     * otherwise a wrap transaction, then `flip()`. WETH must be listed: a `FlipperError` with
     * `details.errorName === "WethNotListed"` says so (list it with `checkListing` / `list`, anyone can).
     */
    async flipEth({ amount, minWinChanceBps, deadlineSeconds = FLIP_DEADLINE_SECONDS, approve = "exact", batch = "auto", onStep }: FlipEthOptions): Promise<FlipEthResult> {
      const { wc, account, chain } = wallet();
      try {
        const weth = await client.weth();
        onStep?.({ step: "previewing" });
        const fees = await gasFees();
        const preview = await client.preview(weth, amount, fees);
        if (preview.code === RejectCode.TOKEN) {
          throw new FlipperError("WETH isn't listed on flipper yet, so ETH can't be flipped. Anyone can list it in one transaction.", "rejected", {
            code: preview.code,
            errorName: "WethNotListed",
          });
        }
        if (preview.code !== 0) {
          throw new FlipperError(rejectReason(preview.code, { symbol: "ETH" })?.message ?? "Flip rejected.", "rejected", { code: preview.code });
        }
        const fee = await client.randomnessFeeToSend(weth, preview.randomnessFee, fees);
        const balance = await pc.getBalance({ address: account.address });
        if (balance < amount + fee) {
          throw new FlipperError(
            `Not enough ETH: this flip needs ${formatTokenAmount(amount, 18)} ETH plus a ${formatTokenAmount(fee, 18)} ETH randomness fee, and gas.`,
            "insufficient-funds",
          );
        }
        const minWin = minWinChanceBps ?? Number(preview.winChanceBps);

        if (batch !== "never" && (await client.supportsAtomicBatch())) {
          const allowance = await client.allowance(weth, account.address);
          const deadline = (await chainNow()) + BigInt(deadlineSeconds);
          // the flip call carries the partner suffix, as in `flip`
          const flipCall = encodeFunctionData({ abi: flipperHouseAbi, functionName: "flip", args: [weth, amount, minWin, deadline] });
          const suffix = await partnerSuffix();
          const flipData = suffix ? concat([flipCall, suffix]) : flipCall;
          const calls = [
            { to: weth, data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" }), value: amount },
            ...(allowance < amount
              ? [{ to: weth, data: encodeFunctionData({ abi: wethAbi, functionName: "approve", args: [house, approve === "max" ? maxUint256 : amount] }) }]
              : []),
            { to: house, data: flipData, value: fee },
          ];
          onStep?.({ step: "batch-signing" });
          const { id } = await sendCalls(wc as never, { account, chain, calls, forceAtomic: true });
          onStep?.({ step: "batch-sent", id });
          const status = await waitForCallsStatus(wc as never, { id, timeout: 300_000 });
          if (status.status !== "success") throw new FlipperError("The wallet's batch didn't go through.", "revert");
          for (const r of status.receipts ?? []) {
            const hash = r.transactionHash as Hash;
            const receipt = await pc.waitForTransactionReceipt({ hash });
            const [log] = parseEventLogs({ abi: flipperHouseAbi, eventName: "FlipRequested", logs: receipt.logs }).filter((l) => isAddressEqual(l.address, house));
            if (!log) continue;
            onStep?.({ step: "requested", hash, flipId: log.args.flipId });
            return { flipId: log.args.flipId, hash, receipt, preview, requested: log.args, batched: true, weth };
          }
          throw new FlipperError("The batch was mined but no FlipRequested event was found.", "unknown");
        }

        onStep?.({ step: "wrapping" });
        const wrapHash = await wc.writeContract({ address: weth, abi: wethAbi, functionName: "deposit", value: amount, account, chain, ...txFees(fees) });
        onStep?.({ step: "wrap-sent", hash: wrapHash });
        await wait(wrapHash, "wrap");
        const res = await client.flip({ token: weth, amount, minWinChanceBps: minWin, deadlineSeconds, approve, symbol: "WETH", decimals: 18, onStep });
        return { ...res, batched: false, wrapHash, weth };
      } catch (err) {
        throw toFlipperError(err, { symbol: "ETH" });
      }
    },

    /** Wrap `amount` ETH into WETH. */
    async wrapEth(amount: bigint): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      try {
        const hash = await wc.writeContract({ address: await client.weth(), abi: wethAbi, functionName: "deposit", value: amount, account, chain, ...(await sendFees()) });
        return await wait(hash, "wrap");
      } catch (err) {
        throw toFlipperError(err, { symbol: "ETH" });
      }
    },

    /** Unwrap `amount` WETH back into ETH (flipping ETH pays winnings in WETH). */
    async unwrapWeth(amount: bigint): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      try {
        const hash = await wc.writeContract({ address: await client.weth(), abi: wethAbi, functionName: "withdraw", args: [amount], account, chain, ...(await sendFees()) });
        return await wait(hash, "unwrap");
      } catch (err) {
        throw toFlipperError(err, { symbol: "WETH" });
      }
    },

    /** Any Uniswap v4 token the V4RouteAdapter could list (resumable PoolManager scan + adapter.check). */
    async discoverV4Tokens(opts: V4ScanOptions & { multicallAddress?: Address } = {}) {
      const adapter = need(addresses.v4Adapter, "v4 adapter");
      // the adapter knows its PoolManager; prefer it over a caller default so the scan and the checks agree
      const poolManager =
        opts.poolManager ??
        addresses.poolManager ??
        (await pc.readContract({ address: adapter, abi: v4RouteAdapterAbi, functionName: "poolManager" }).catch(() => undefined));
      return discoverV4Tokens(pc, {
        ...opts,
        adapter,
        poolManager,
        flipper: await client.flipper().catch(() => undefined),
      });
    },

    /** The token holder rewards are paid in: $FLIPPER itself (rewards are built into the token). */
    async rewardToken(): Promise<Address> {
      return addresses.rewards ?? client.flipper();
    },

    /**
     * $FLIPPER holder rewards, read from the token (and the staking vault for `user`'s staked share): the stream's
     * rate and end, totals, and `user`'s claimable, lifetime and estimated per-day earnings. Estimates use `now()`
     * (the later of chain and wall time).
     */
    async holderRewards(user?: Address): Promise<HolderRewardsSummary> {
      const token = await client.rewardToken();
      const t = { address: token, abi: flipperRewardTokenAbi } as const;
      const [meta, stream, rateX96, periodFinish, pendingStream, totalDistributed, totalClaimed, eligibleSupply, nowS, tv] = await Promise.all([
        client.tokenMeta(token),
        pc.readContract({ ...t, functionName: "STREAM" }),
        pc.readContract({ ...t, functionName: "rewardRate" }),
        pc.readContract({ ...t, functionName: "periodFinish" }),
        pc.readContract({ ...t, functionName: "pendingStream" }),
        pc.readContract({ ...t, functionName: "totalDistributed" }),
        pc.readContract({ ...t, functionName: "totalClaimed" }),
        pc.readContract({ ...t, functionName: "eligibleSupply" }),
        chainNow(),
        user ? client.vault() : Promise.resolve(null),
      ]);
      const now = Number(nowS);
      const live = now < Number(periodFinish);
      // rewardRate is magnified by 2^96 ($FLIPPER wei per second across the whole eligible supply)
      const ratePerSecond = live ? rateX96 / REWARD_MAGNITUDE : 0n;
      const perDayOf = (bal: bigint) => (live && eligibleSupply > 0n ? (rateX96 * bal * 86_400n) / eligibleSupply / REWARD_MAGNITUDE : 0n);
      const summary: HolderRewardsSummary = {
        token,
        symbol: meta.symbol,
        decimals: meta.decimals,
        now,
        stream: Number(stream),
        ratePerSecond,
        periodFinish: Number(periodFinish),
        pendingStream,
        totalDistributed,
        totalClaimed,
        eligibleSupply,
      };
      if (!user) return summary;
      const [excluded, balance, eligibleBalance, claimable, accrued, claimed, staking] = await Promise.all([
        pc.readContract({ ...t, functionName: "rewardExempt", args: [user] }),
        pc.readContract({ ...t, functionName: "balanceOf", args: [user] }),
        pc.readContract({ ...t, functionName: "eligibleBalanceOf", args: [user] }),
        pc.readContract({ ...t, functionName: "claimable", args: [user] }),
        pc.readContract({ ...t, functionName: "accrued", args: [user] }),
        pc.readContract({ ...t, functionName: "claimed", args: [user] }),
        tv
          ? Promise.all([
              pc.readContract({ address: tv, abi: treasuryVaultAbi, functionName: "pendingRewards", args: [user] }),
              client.vaultState(user).then((s) => s?.position?.assets ?? 0n),
            ]).then(([pending, stakedAssets]) => ({ vault: tv, pending, stakedAssets, perDay: perDayOf(stakedAssets) }))
          : Promise.resolve(undefined),
      ]);
      summary.account = {
        address: user,
        excluded,
        balance,
        eligibleBalance,
        claimable: excluded ? 0n : claimable,
        accrued,
        claimed,
        perDay: excluded ? 0n : perDayOf(eligibleBalance),
        staking,
        totalClaimable: (excluded ? 0n : claimable) + (staking?.pending ?? 0n),
      };
      return summary;
    },

    /** Claim the $FLIPPER holder rewards the connected wallet earned on its balance (`token.claim()`). */
    async claimHolderRewards(): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      try {
        const token = await client.rewardToken();
        const { request } = await pc.simulateContract({ account, address: token, abi: flipperRewardTokenAbi, functionName: "claim" });
        const gas = await pc.estimateContractGas({ account, address: token, abi: flipperRewardTokenAbi, functionName: "claim" });
        const hash = await wc.writeContract({ ...request, gas: withRewardHeadroom(gas), account, chain, ...(await sendFees()) } as unknown as typeof request);
        return await wait(hash, "claim");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /** Claim the holder rewards the connected wallet's stake earned in the vault (`vault.claimRewards()`). */
    async claimStakingRewards(): Promise<TransactionReceipt> {
      const { wc, account, chain } = wallet();
      try {
        const tv = need((await client.vault()) ?? undefined, "staking vault");
        const { request } = await pc.simulateContract({ account, address: tv, abi: treasuryVaultAbi, functionName: "claimRewards" });
        const gas = await pc.estimateContractGas({ account, address: tv, abi: treasuryVaultAbi, functionName: "claimRewards" });
        const hash = await wc.writeContract({ ...request, gas: withRewardHeadroom(gas), account, chain, ...(await sendFees()) } as unknown as typeof request);
        return await wait(hash, "claim");
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    /** The RevenueRouter (`addresses.router`, else `house.revenueRouter()`). */
    async revenueRouter(): Promise<Address> {
      if (addresses.router) return addresses.router;
      return pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "revenueRouter" });
    },

    /**
     * `RevenueRouter.harvest()` (anyone): pulls the house's profit share and fees in and `distribute`s the holders'
     * $FLIPPER to the token, paying the caller a capped bounty. Mostly for dev tools: the API's upkeep worker runs it.
     */
    async harvest(): Promise<{ receipt: TransactionReceipt }> {
      const { wc, account, chain } = wallet();
      try {
        const router = await client.revenueRouter();
        const { request } = await pc.simulateContract({ account, address: router, abi: revenueRouterAbi, functionName: "harvest", gas: SIMULATION_GAS });
        const gas = await pc.estimateContractGas({ account, address: router, abi: revenueRouterAbi, functionName: "harvest" });
        const hash = await wc.writeContract({ ...request, gas: withHeadroom(gas), account, chain, ...(await sendFees()) } as unknown as typeof request);
        return { receipt: await wait(hash, "harvest") };
      } catch (err) {
        throw toFlipperError(err);
      }
    },

    // ── staking (TreasuryVault) ─────────────────────────────────────────────────────────────────────────

    /** The house's staking vault (`house.vault()`, cached), or null when it has none. */
    async vault(): Promise<Address | null> {
      if (vaultAddress === undefined) {
        const v = await pc.readContract({ address: house, abi: flipperHouseAbi, functionName: "vault" }).catch(() => zeroAddress);
        vaultAddress = isAddressEqual(v, zeroAddress) ? null : v;
      }
      return vaultAddress;
    },

    /** Vault totals and, with `user`, their position (one `FlipperLens.vault` call); null without a vault. */
    async vaultState(user?: Address): Promise<VaultState | null> {
      const tv = await client.vault();
      if (!tv) return null;
      const [[v, p], block] = await Promise.all([
        pc.readContract({ address: lens, abi: flipperLensAbi, functionName: "vault", args: [tv, user ?? zeroAddress] }),
        pc.getBlock({ blockTag: "latest" }),
      ]);
      return {
        info: {
          vault: v.vault,
          totalAssets: v.totalAssets,
          freeAssets: v.freeAssets,
          depositorShares: v.depositorShares,
          protocolShares: v.protocolShares,
          pricePerShare: v.pricePerShare,
          highWaterMark: v.highWaterMark,
          protocolOwnedAssets: v.protocolOwnedAssets,
          depositorAssets: v.depositorAssets,
          performanceFeeBps: Number(v.performanceFeeBps),
          lockDuration: Number(v.lockDuration),
          withdrawCooldown: Number(v.withdrawCooldown),
        },
        position: user
          ? {
              shares: p.shares,
              assets: p.assets,
              unlockAt: p.unlockAt,
              pendingShares: p.pendingShares,
              readyAt: p.readyAt,
              maxWithdrawable: p.maxWithdrawable,
              flipperBalance: p.flipperBalance,
              flipperAllowance: p.flipperAllowance,
            }
          : null,
        chainTime: block.timestamp,
      };
    },

    /** sFLIPPER `assets` $FLIPPER would mint now (post-crystallization). */
    async previewStake(assets: bigint): Promise<bigint> {
      const tv = need((await client.vault()) ?? undefined, "staking vault");
      return pc.readContract({ address: tv, abi: treasuryVaultAbi, functionName: "previewDeposit", args: [assets] });
    },

    /** $FLIPPER `shares` sFLIPPER are worth now (post-crystallization). */
    async previewUnstake(shares: bigint): Promise<bigint> {
      const tv = need((await client.vault()) ?? undefined, "staking vault");
      return pc.readContract({ address: tv, abi: treasuryVaultAbi, functionName: "previewRedeem", args: [shares] });
    },

    /**
     * Stake $FLIPPER: approve the vault if needed, then `deposit(assets, minShares)`. Every deposit (re)locks all of
     * the account's sFLIPPER for the vault's `lockDuration`. `slippageBps` bounds the share price moving meanwhile.
     */
    async stake({ amount, slippageBps = 50, onStep }: { amount: bigint; slippageBps?: number; onStep?: (s: StakeStep) => void }) {
      const { wc, account, chain } = wallet();
      try {
        const tv = need((await client.vault()) ?? undefined, "staking vault");
        const flipper = await client.flipper();
        const fees = await gasFees();
        const allowance = await pc.readContract({ address: flipper, abi: erc20Abi, functionName: "allowance", args: [account.address, tv] });
        if (allowance < amount) {
          onStep?.({ step: "approving" });
          const approveGas = await pc.estimateContractGas({ account, address: flipper, abi: erc20Abi, functionName: "approve", args: [tv, amount] });
          const hash = await wc.writeContract({ address: flipper, abi: erc20Abi, functionName: "approve", args: [tv, amount], gas: withRewardHeadroom(approveGas), account, chain, ...txFees(fees) });
          onStep?.({ step: "approve-sent", hash });
          await wait(hash, "approval");
        }
        const expected = await client.previewStake(amount);
        const minShares = (expected * (BPS - BigInt(slippageBps))) / BPS;
        onStep?.({ step: "signing" });
        const { request, result } = await pc.simulateContract({ account, address: tv, abi: treasuryVaultAbi, functionName: "deposit", args: [amount, minShares] });
        const depositGas = await pc.estimateContractGas({ account, address: tv, abi: treasuryVaultAbi, functionName: "deposit", args: [amount, minShares] });
        const hash = await wc.writeContract({ ...request, gas: withRewardHeadroom(depositGas), account, chain, ...(await sendFees()) } as unknown as typeof request);
        onStep?.({ step: "sent", hash });
        const receipt = await wait(hash, "stake");
        return { receipt, shares: result };
      } catch (err) {
        throw toFlipperError(err, { symbol: "$FLIPPER" });
      }
    },

    /** Queue `shares` sFLIPPER for withdrawal (after the lock); (re)starts the cooldown for everything queued. */
    async requestUnstake(shares: bigint): Promise<TransactionReceipt> {
      return vaultWrite("requestWithdraw", [shares], "withdrawal request");
    },

    /** Un-queue a pending withdrawal (the shares stay staked). */
    async cancelUnstake(): Promise<TransactionReceipt> {
      return vaultWrite("cancelWithdraw", [], "cancellation");
    },

    /** After the cooldown: burn every queued share for $FLIPPER at the current price (paid from the free bankroll). */
    async unstake({ slippageBps = 50 }: { slippageBps?: number } = {}) {
      const { account } = wallet();
      const tv = need((await client.vault()) ?? undefined, "staking vault");
      const [queued] = await pc.readContract({ address: tv, abi: treasuryVaultAbi, functionName: "pending", args: [account.address] });
      const expected = queued > 0n ? await client.previewUnstake(queued) : 0n;
      const minAssets = (expected * (BPS - BigInt(slippageBps))) / BPS;
      const receipt = await vaultWrite("withdraw", [minAssets], "withdrawal");
      return { receipt, expected };
    },

    /** @internal */
    async discoverHookitTokens(opts: DiscoverOptions = {}) {
      return discoverHookitTokens(client, pc, opts);
    },
  };
  return client;
}

export type FlipperClient = ReturnType<typeof createFlipperClient>;

/** Progress of `stake`: the approval (only when the allowance is short), then the deposit. */
export type StakeStep = { step: "approving" } | { step: "approve-sent"; hash: Hash } | { step: "signing" } | { step: "sent"; hash: Hash };

export { FlipStatus };
