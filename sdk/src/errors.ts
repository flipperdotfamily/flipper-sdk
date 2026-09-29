import { PROTOCOL_LOCKED_MESSAGE } from "./constants";
import { formatTokenAmount } from "./format";
import { formatBps, rejectReason } from "./odds";
import { v4CheckReason } from "./v4";

// Errors are matched by `name`, not `instanceof`: the host app's viem (which creates the errors) can be a different
// copy from the one this package resolves, and instanceof fails across copies.
interface ViemLikeError extends Error {
  shortMessage?: string;
  walk: (fn?: (e: unknown) => boolean) => unknown;
}
interface RevertLike {
  name: string;
  reason?: string;
  data?: { errorName?: string; args?: readonly unknown[] };
}
const isViemError = (e: unknown): e is ViemLikeError =>
  e instanceof Error && typeof (e as { walk?: unknown }).walk === "function";
const named = (name: string) => (e: unknown) => (e as { name?: string } | null)?.name === name;
const isUserRejection = (e: unknown) =>
  named("UserRejectedRequestError")(e) || (e as { code?: unknown } | null)?.code === 4001;

/** OpenZeppelin v5 ERC20 custom errors (many launchpad tokens use them), so viem can decode token reverts. */
export const erc20ErrorsAbi = [
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
] as const;

/** Thrown by the SDK when the house would reject a flip (preview code != 0) or a known revert happens. */
export class FlipperError extends Error {
  override name = "FlipperError";
  constructor(
    message: string,
    readonly kind: "rejected" | "revert" | "user-rejected" | "insufficient-funds" | "timeout" | "config" | "unknown",
    readonly details: { code?: number; errorName?: string; args?: readonly unknown[]; cause?: unknown } = {},
  ) {
    super(message);
  }
}

/** a unix timestamp (seconds) as a local date and time */
function when(ts: unknown): string {
  const n = Number(ts ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "later";
  return new Date(n * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** ListingPolicy reasons (the adapters' `check()` codes 12 / 13, and `NotVetted(reason, detail)`) */
export const LISTING_POLICY_NOT_VETTED = 12;
export const LISTING_POLICY_HOOK_NOT_PINNED = 13;

/**
 * `NotVetted(reason, detail)`: why the ListingPolicy refused a permissionless listing. `detail` is the refusing launchpad
 * verifier's own code.
 */
export function notVettedMessage(reason: number, detail = 0): string {
  if (reason === LISTING_POLICY_HOOK_NOT_PINNED) return "The pool uses a hook flipper hasn't approved, so it can't be listed.";
  switch (detail) {
    case 2:
      return "Its pool's hook isn't the launchpad's audited hook, so it can't be listed.";
    case 3:
      return "Only ETH-quoted launches can be listed.";
    case 4:
      return "Its launch pool isn't initialized yet.";
    case 5:
      return "This token uses anti-MEV, max-tx or holder-airdrop modules, which flips can't settle through.";
    case 6:
      return "Its launch window is still live: try again after it ends.";
    case 7:
      return "Its token contract isn't the launchpad's audited token template, so it can't be listed.";
    case 8:
      return "It has a holder tracker, which flips can't settle through.";
    case 9:
      return "That isn't the token's canonical launch pool.";
    default:
      return "Only whitelisted tokens can be listed right now.";
  }
}

function fromRevert(errorName: string | undefined, args: readonly unknown[] | undefined, symbol?: string): string | null {
  switch (errorName) {
    case "FlipRejected":
      return rejectReason(Number(args?.[0] ?? 0), { symbol })?.message ?? "The house rejected this flip.";
    case "ListingProbeFailed": {
      const cost = args?.[0] as bigint | undefined;
      if (cost === undefined || cost > 100_000n) return "The pool is too thin to list yet: a test trade couldn't be quoted.";
      return `The pool is too thin to list yet: a test trade's round trip costs ${formatBps(cost)}, above the listing limit.`;
    }
    case "PartialFill":
      return "The pool is too thin to list yet: a test trade couldn't fill.";
    case "NotVetted":
      return notVettedMessage(Number(args?.[0] ?? 0), Number(args?.[1] ?? 0));
    case "ProtocolLocked":
      // the drawdown circuit breaker: flips, listings, claims, vault actions and harvests all revert while locked
      return PROTOCOL_LOCKED_MESSAGE;
    // PrincipalLock (the team stake)
    case "ExceedsExcess":
      return `That's more than the stake's withdrawable excess (${formatTokenAmount(BigInt(String(args?.[1] ?? 0)), 18)} $FLIPPER above the principal).`;
    case "PrincipalBreach":
      return "That would take the team stake below its locked principal, which can never be withdrawn. Request less than the maximum, leaving a cushion (\"max\" leaves 1% of the principal).";
    // DutchAuctionConverter
    case "AlreadyPriced":
      return "This token's auction already has a price, so it can't be seeded again.";
    case "AlreadyStaked":
      return "The team stake is already in place: it can only be staked once.";
    case "AthOutOfBounds":
      return "That all-time high is out of bounds for the current NAV. Pass 0 to reset it to today's NAV.";
    case "InsufficientGas":
      return "The transaction was sent with too little gas for this step. Try again without lowering the gas limit.";
    case "TooEarly":
      return "The winnings can't be bought right now. Try again later: after the timeout the payout is made in $FLIPPER.";
    case "BadStatus":
      // resolvePendingWin on a flip that's no longer pending (someone paid it first), or a cancel on a settled flip
      return "Already paid out.";
    case "SameToken":
      return "That's $FLIPPER itself.";
    case "InvalidRail":
      return "This token's launch rail isn't one flipper supports.";
    case "InsufficientFee":
      return "The randomness fee changed while you were signing. Try again.";
    case "Expired":
      return "The flip took too long to be included. Try again.";
    case "FeeOnTransfer":
      return "This token charges a fee on transfer and can't be flipped.";
    case "TokenBlocked":
      return "This token was disabled by the house and can't be re-listed.";
    case "AlreadyListed":
      return "This token is already listed.";
    case "Unauthorized":
      return "That action isn't allowed (is the route adapter approved on this house?).";
    case "InvalidAddress":
    case "InvalidPath":
      return "This token can't be routed to $FLIPPER.";
    case "Rejected":
      return `The v4 adapter rejected this pool: ${v4CheckReason(Number(args?.[0] ?? 0)).toLowerCase()}.`;
    case "NotRegistered":
      return "This token has no registered Uniswap v4 pool yet.";
    case "InvalidPool":
      return "The v4 adapter isn't fully configured on this chain yet.";
    case "NotHookitToken":
      return "This token wasn't launched on a supported launchpad.";
    case "UnsupportedQuote":
      return "Only ETH-quoted, single-market launches can be listed.";
    case "Reentrancy":
    case "ReentrancyGuardReentrantCall":
      return "The house is busy. Try again.";
    case "ERC20InsufficientBalance":
      return `Not enough ${symbol ?? "tokens"} in your wallet.`;
    case "ERC20InsufficientAllowance":
      return `The house isn't approved to move your ${symbol ?? "tokens"} yet.`;
    case "EpochNotOver":
      return "That rewards epoch hasn't ended yet.";
    case "NotClaimable":
      return "Those rewards aren't claimable yet (the epoch's root is still in its challenge window).";
    case "AlreadyClaimed":
      return "You already claimed those rewards.";
    case "InvalidProof":
      return "The rewards proof didn't match the posted root. Refresh and try again.";
    // TreasuryVault
    case "Locked":
      return `Your stake is locked until ${when(args?.[0])}. Withdrawals open after the lock.`;
    case "CoolingDown":
      return `Your withdrawal is still cooling down. It can be completed from ${when(args?.[0])}.`;
    case "Slippage":
      return "The share price moved while you were signing. Check the new amount and try again.";
    case "ExceedsBalance":
      return `That's more sFLIPPER than you can withdraw (${formatTokenAmount(BigInt(String(args?.[0] ?? 0)), 18)} available).`;
    case "InsufficientFreeBankroll":
      return `Only ${formatTokenAmount(BigInt(String(args?.[0] ?? 0)), 18)} $FLIPPER of the bankroll is free right now: pending flips reserve the rest. Try again once they settle.`;
    case "NothingPending":
      return "You have no withdrawal queued. Request one first.";
    case "ZeroAmount":
      return "Enter an amount.";
    case "ZeroShares":
      return "That amount is too small to mint any sFLIPPER.";
    case "NoAssets":
      return "The bankroll is empty, so staking is paused until it's topped up.";
    case "NonTransferable":
      return "sFLIPPER can't be transferred: it only leaves the vault through a withdrawal.";
    default:
      return null;
  }
}

/** Walks a (viem) error and returns a short, plain-English explanation. */
export function describeError(err: unknown, ctx: { symbol?: string } = {}): string {
  if (err instanceof FlipperError) return err.message;
  if (isViemError(err)) {
    if (err.walk(isUserRejection)) return "You rejected the request in your wallet.";
    if (err.walk(named("InsufficientFundsError"))) return "Not enough ETH to cover gas and the randomness fee.";
    const revert = err.walk(named("ContractFunctionRevertedError")) as RevertLike | null;
    if (revert) {
      const msg = fromRevert(revert.data?.errorName, revert.data?.args, ctx.symbol);
      if (msg) return msg;
      if (revert.reason) return revert.reason;
    }
    return err.shortMessage || err.message;
  }
  if (isUserRejection(err)) return "You rejected the request in your wallet.";
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

/** Normalises any error into a FlipperError (keeps the decoded revert name/args when available). */
export function toFlipperError(err: unknown, ctx: { symbol?: string } = {}): FlipperError {
  if (err instanceof FlipperError) return err;
  const message = describeError(err, ctx);
  if (isViemError(err)) {
    if (err.walk(isUserRejection)) return new FlipperError(message, "user-rejected", { cause: err });
    if (err.walk(named("InsufficientFundsError"))) return new FlipperError(message, "insufficient-funds", { cause: err });
    const revert = err.walk(named("ContractFunctionRevertedError")) as RevertLike | null;
    if (revert?.data) {
      const code = revert.data.errorName === "FlipRejected" ? Number(revert.data.args?.[0]) : undefined;
      return new FlipperError(message, code !== undefined ? "rejected" : "revert", {
        code,
        errorName: revert.data.errorName,
        args: revert.data.args,
        cause: err,
      });
    }
  }
  return new FlipperError(message, "unknown", { cause: err });
}
