import { FlipStatus } from "./constants";
import { formatTokenAmount } from "./format";
import type { Settlement } from "./types";

export interface SettlementCopy {
  tone: "win" | "loss" | "neutral";
  /** coin face to land on: the dolphin (heads) for wins, the fluke (tails) for losses */
  face: "heads" | "tails" | null;
  /** "You won." / "Not this time." / "Refunded." */
  headline: string;
  detail: string;
  /** "Roll 7,812 · wins from 5,500" */
  fairness: string;
  /** part of the payout was credited to `claimable` (safe-mode settlement or a failed push) */
  claimable: boolean;
  /** the winnings are still being settled (paid out by upkeep) */
  pending: boolean;
}

export interface SettlementCopyContext {
  symbol: string;
  decimals: number;
  flipperSymbol?: string;
  flipperDecimals?: number;
  /** true when the flipped token is $FLIPPER itself */
  isFlipper?: boolean;
  /** the house's $FLIPPER payout now (`house().terms.flipperPayoutBps`), used when neither the settle log nor the flip's own `payoutBps` is available */
  flipperPayoutBps?: number;
}

/** Player-facing wording for every FlipperHouse lifecycle outcome (FlipSettled 2–7, PendingWinResolved, FlipCancelled). */
export function describeSettlement(s: Settlement, ctx: SettlementCopyContext): SettlementCopy {
  const fSym = ctx.flipperSymbol ?? "FLIPPER";
  const fDec = ctx.flipperDecimals ?? 18;
  const amt = (v: bigint) => formatTokenAmount(v, ctx.decimals);
  const flp = (v: bigint) => `${formatTokenAmount(v, fDec)} ${fSym}`;
  const stake = `${amt(s.flip.amount)} ${ctx.symbol}`;
  const threshold = 10_000 - s.flip.winChanceBps;
  const fairness =
    s.status === FlipStatus.Refunded ? "" : `Roll ${s.roll.toLocaleString("en-US")} · wins from ${threshold.toLocaleString("en-US")}`;
  const ev = s.event;
  const safe = s.safeMode || !!ev?.safeMode;
  const base = { fairness, claimable: false, pending: false };

  switch (s.status) {
    case FlipStatus.Won: {
      if (s.resolved) {
        // WinPending → upkeep bought the token and paid the winnings.
        return {
          ...base,
          tone: "win",
          face: "heads",
          headline: "You won.",
          detail: `Your ${stake} stake came back at settlement, and your ${amt(s.resolved.tokenPaid)} ${ctx.symbol} winnings have now been paid.`,
        };
      }
      let paid: bigint | undefined;
      if (ctx.isFlipper) {
        // the flip's own multiple, fixed at flip time (the house param only as a fallback; never a hard-coded one)
        const payoutBps = s.flip.payoutBps || ctx.flipperPayoutBps;
        paid = ev ? s.flip.amount + ev.flipperPaid : payoutBps ? (s.flip.amount * BigInt(payoutBps)) / 10_000n : undefined;
      } else {
        paid = ev && ev.tokenPaid > 0n ? ev.tokenPaid : 2n * s.flip.amount;
      }
      const what = paid !== undefined ? `${amt(paid)} ${ctx.symbol}` : `Your ${ctx.symbol} winnings`;
      return {
        ...base,
        tone: "win",
        face: "heads",
        headline: "You won.",
        claimable: safe,
        detail: safe
          ? `${what} ${paid !== undefined ? "is" : "are"} ready to claim: this flip settled in safe mode, so the payout was credited instead of sent.`
          : `${what} ${paid !== undefined ? "was" : "were"} sent to your wallet.`,
      };
    }
    case FlipStatus.WonFallback: {
      if (s.resolved) {
        return {
          ...base,
          tone: "win",
          face: "heads",
          headline: "You won.",
          detail: `Your ${stake} stake came back at settlement, and your winnings were paid as ${flp(s.resolved.flipperPaid)} because ${ctx.symbol} couldn't be bought at a fair price.`,
        };
      }
      const bonus = ev ? flp(ev.flipperPaid) : fSym;
      return {
        ...base,
        tone: "win",
        face: "heads",
        headline: "You won.",
        detail: `Your ${stake} stake is back, and your winnings were paid as ${bonus} because buying ${ctx.symbol} failed at settlement.`,
      };
    }
    case FlipStatus.WinPending:
      return {
        ...base,
        tone: "win",
        face: "heads",
        headline: "You won.",
        pending: true,
        claimable: safe,
        detail: safe
          ? `Your ${stake} stake is ready to claim, and your winnings are being settled. They'll arrive shortly.`
          : `Your ${stake} stake is back. Your winnings are being settled and will arrive shortly.`,
      };
    case FlipStatus.Lost:
    case FlipStatus.LostInventory:
      return { ...base, tone: "loss", face: "tails", headline: "Not this time.", detail: `Your ${stake} stake went to the house.` };
    case FlipStatus.Refunded:
      return {
        ...base,
        tone: "neutral",
        face: null,
        headline: "Refunded.",
        detail: `The randomness never arrived, so the flip was cancelled and your ${stake} stake was returned. The randomness fee isn't refundable.`,
      };
    default:
      return { ...base, tone: "neutral", face: null, headline: "Drawing…", detail: "Waiting for randomness." };
  }
}
