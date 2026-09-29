import { isAddressEqual, type Address } from "viem";
import { BELOW_MIN_SIZE_MESSAGE, BPS, PROTOCOL_LOCKED_MESSAGE, RejectCode, TOO_MANY_OPEN_MESSAGE } from "./constants";
import { formatTokenAmount } from "./format";
import type { HouseParams, OddsShift, Preview, RejectReason } from "./types";

/** "45.00%" from 4500 bps. */
export function formatBps(bps: number | bigint, fractionDigits = 2): string {
  return `${(Number(bps) / 100).toFixed(fractionDigits)}%`;
}

/**
 * A win chance as people read it: "45%", "46.25%", "46.5%" (whole numbers stay whole; never rounded up, so a chance
 * is never shown above what the house gives).
 */
export function formatWinChance(bps: number | bigint): string {
  const n = Math.floor(Number(bps));
  return `${n % 100 === 0 ? n / 100 : (n / 100).toFixed(2).replace(/0$/, "")}%`;
}

/**
 * The house's expected profit, in bps of the stake, at a win chance and payout (both bps): 10000 − win × payout,
 * rounded as the house rounds it. 4500 × 2× → 1000 (10%, a token flip on a free route); 4500 × 2.05× → 775.
 */
export function houseEdgeBps(winChanceBps: number, payoutBps: number): number {
  return Math.max(0, 10_000 - Math.ceil((winChanceBps * payoutBps) / 10_000));
}

/**
 * "2×" / "2.05×" / "2.025×" from 20000 / 20500 / 20250 bps. With a `locale` that writes a decimal comma ("es", "de", "fr",
 * …), "2,05×".
 */
export function formatMultiple(payoutBps: number | bigint, locale?: string): string {
  // up to three decimals, rounded down: the edge schedule's payouts (2.025×, 2.0389× → 2.038×) never read above what the house pays
  const milli = Math.floor(Number(payoutBps) / 10);
  const s = (milli / 1000).toFixed(3).replace(/\.?0+$/, "");
  return `${locale && decimalComma(locale) ? s.replace(".", ",") : s}×`;
}
function decimalComma(locale: string): boolean {
  try {
    return new Intl.NumberFormat(locale).format(1.5).includes(",");
  } catch {
    return false;
  }
}

/**
 * Plain-English explanation of a `Preview.code` / `FlipRejected(code)`. Returns null for OK (0).
 * `symbol` personalises the copy ("Lower the HKT amount"). For code 2, `amount: 0n` reads as "Enter an amount"; any
 * other stake reads as below the minimum size, naming the minimum when `minStake` and `decimals` are given.
 */
export function rejectReason(
  code: number,
  ctx: { symbol?: string; amount?: bigint; minStake?: bigint; decimals?: number } = {},
): RejectReason | null {
  const sym = ctx.symbol ?? "token";
  switch (code) {
    case RejectCode.OK:
      return null;
    case RejectCode.PAUSED:
      return { code, key: "PAUSED", title: "Flipping is paused", message: "The house is paused for maintenance. Try again shortly." };
    case RejectCode.AMOUNT: {
      if (ctx.amount === 0n) return { code, key: "AMOUNT", title: "Enter an amount", message: "The stake must be greater than zero." };
      const min =
        ctx.minStake !== undefined && ctx.minStake > 0n && ctx.decimals !== undefined
          ? ` The minimum is ${formatTokenAmount(ctx.minStake, ctx.decimals)} ${ctx.symbol ?? "tokens"}.`
          : "";
      return { code, key: "BELOW_MIN", title: "Below the minimum", message: `${BELOW_MIN_SIZE_MESSAGE}${min}` };
    }
    case RejectCode.TOKEN:
      return {
        code,
        key: "TOKEN",
        title: "Token not listed",
        message: `${sym} isn't listed on flipper yet (or it was disabled).`,
      };
    case RejectCode.QUOTE:
      return {
        code,
        key: "QUOTE",
        title: "Can't price this flip",
        message: `Couldn't price ${sym} right now (liquidity / launch window / you traded it this block). Try again in a moment.`,
      };
    case RejectCode.ROUTE_COST:
      return {
        code,
        key: "ROUTE_COST",
        title: "Too expensive to route",
        message: `Flipping this much ${sym} costs too much in fees and price impact. Lower the amount.`,
      };
    case RejectCode.WIN_CHANCE:
      return {
        code,
        key: "WIN_CHANCE",
        title: "Odds too low",
        message: `Token fees at this size push the odds below the house floor. Lower the amount.`,
      };
    case RejectCode.BET_SIZE:
      return {
        code,
        key: "BET_SIZE",
        title: "Above the max bet",
        message: "This flip is bigger than the house takes on for it right now: each flip is capped to its own edge. Lower the amount.",
      };
    case RejectCode.LOCKED:
      return { code, key: "LOCKED", title: "Flips are paused", message: PROTOCOL_LOCKED_MESSAGE };
    case RejectCode.TOO_MANY_OPEN:
      return { code, key: "TOO_MANY_OPEN", title: "Too many flips in progress", message: TOO_MANY_OPEN_MESSAGE };
    default:
      return { code, key: "UNKNOWN", title: "Flip rejected", message: `The house rejected this flip (code ${code}).` };
  }
}

/**
 * How far the chance-based fee moved the odds below the base win chance.
 * Only meaningful when the preview actually priced the route (OK, WIN_CHANCE or BET_SIZE).
 * Pass the base terms now (`house().terms` or `baseTerms()`): with an edge schedule, `params` holds only the launch terms.
 */
export function oddsShift(
  preview: Pick<Preview, "code" | "winChanceBps">,
  params: Pick<HouseParams, "baseWinChanceBps">,
): OddsShift {
  const base = Number(params.baseWinChanceBps);
  const win = Number(preview.winChanceBps);
  const priced =
    preview.code === RejectCode.OK || preview.code === RejectCode.WIN_CHANCE || preview.code === RejectCode.BET_SIZE;
  const shiftBps = priced && win > 0 && win < base ? base - win : 0;
  const label = formatBps(shiftBps);
  return {
    shifted: shiftBps > 0,
    shiftBps,
    baseWinChanceBps: base,
    winChanceBps: win,
    label,
    message: shiftBps > 0 ? `The odds for this flip are shifted ${label} due to token fees` : "",
  };
}

/**
 * Payout multiple in bps: 2x for token flips, the $FLIPPER payout for $FLIPPER itself (2.05x at launch, stepping down
 * to 2x with the edge schedule: pass `house().terms` or `baseTerms()`).
 */
export function payoutBps(token: Address, flipper: Address | undefined, params: Pick<HouseParams, "flipperPayoutBps">): bigint {
  if (flipper && isAddressEqual(token, flipper)) return BigInt(params.flipperPayoutBps);
  return 2n * BPS;
}

/** Total returned on a win (stake included). */
export function potentialPayout(amount: bigint, multipleBps: bigint): bigint {
  return (amount * multipleBps) / BPS;
}
