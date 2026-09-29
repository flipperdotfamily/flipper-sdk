import {
  FlipStatus,
  RejectCode,
  describeError,
  describeSettlement,
  oddsShift,
  paddedRandomnessFee,
  parseAmount,
  payoutBps,
  potentialPayout,
  rejectReason,
  toInputString,
  type FlipStep,
  type HouseView,
  type OddsShift,
  type Preview,
  type RejectReason,
  type Settlement,
  type SettlementCopy,
} from "@flipperdotfamily/sdk";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAddressEqual, type Address, type Hash } from "viem";
import { useFlipperClient, type FlipperClientState, type UseFlipperClientOptions } from "./useFlipperClient";

export interface UseFlipperHeadlessOptions extends UseFlipperClientOptions {
  /** token to flip (default $FLIPPER) */
  token?: Address;
  /** the stake as the user typed it, in whole tokens ("100", "0.5"); previews are debounced */
  amount?: string;
  /** preview debounce (default 400 ms) */
  debounceMs?: number;
  /** balance refresh interval (default 15 s; 0 = only after flips) */
  refreshIntervalMs?: number;
  /** allowance to request when short: "max" (default, later flips skip the approval) or "exact" */
  approve?: "max" | "exact";
  /** called when a flip settles (again when a WinPending flip is paid out) */
  onSettled?: (settlement: Settlement, copy: SettlementCopy) => void;
}

export type FlipperPhase =
  | { kind: "idle" }
  | { kind: "working"; step: FlipStep["step"]; hash?: Hash }
  | { kind: "drawing"; flipId: bigint; hash: Hash }
  | { kind: "settled"; settlement: Settlement; copy: SettlementCopy }
  | { kind: "error"; message: string };

export interface FlipperTokenInfo {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  isFlipper: boolean;
}

export interface FlipperHeadlessState extends FlipperClientState {
  house: HouseView | null;
  token: FlipperTokenInfo | null;
  /** token balance of the connected account */
  balance: bigint | null;
  /** native ETH balance (pays the randomness fee and gas) */
  ethBalance: bigint | null;
  /** randomness fee for this token, at the expected gas price (display value; `flip` pads it only when gas-priced) */
  randomnessFee: bigint | null;
  /** `amount` parsed to wei (null when empty or invalid) */
  parsedAmount: bigint | null;
  preview: Preview | null;
  previewing: boolean;
  /** why the house would refuse this stake right now */
  reject: RejectReason | null;
  /** fee-shifted odds, when the route costs moved them below base */
  odds: OddsShift | null;
  /** total returned on a win, stake included */
  payoutIfWon: bigint | null;
  /** ETH `flip` will send with the transaction: the exact fee for a flat-fee adapter (Dice, Pyth), padded for a
   *  gas-priced one (Chainlink VRF; the excess is refunded) */
  valueToSend: bigint | null;
  phase: FlipperPhase;
  busy: boolean;
  /** flip `amountOverride` (wei) or the current `amount` */
  flip(amountOverride?: bigint): Promise<Settlement | undefined>;
  /** the largest stake the house accepts, capped by the balance (at base odds with `baseOdds`) */
  maxStake(baseOdds?: boolean): Promise<string | null>;
  /** claim payouts that couldn't be pushed at settlement (safe mode) */
  claim(): Promise<void>;
  refresh(): void;
  /** back to idle (keeps balances) */
  reset(): void;
}

const MIN_SPIN_MS = 1200;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Everything a fully native flip UI needs, built on `@flipperdotfamily/sdk`: house state, token metadata, balances, a
 * debounced preview of the typed stake, and a `flip()` that walks approve → sign → draw → settle.
 *
 * ```tsx
 * const f = useFlipperHeadless({ wallet: provider, account: address, amount: text });
 * <Button title={f.busy ? "Flipping…" : "Flip"} disabled={!f.canTransact || !!f.reject} onPress={() => f.flip()} />
 * ```
 */
export function useFlipperHeadless(options: UseFlipperHeadlessOptions = {}): FlipperHeadlessState {
  const { amount = "", debounceMs = 400, refreshIntervalMs = 15_000, approve = "max" } = options;
  const base = useFlipperClient(options);
  const { client, account, publicClient } = base;
  const onSettledRef = useRef(options.onSettled);
  onSettledRef.current = options.onSettled;

  // ── house + token metadata ─────────────────────────────────────────────────────────────────────
  const [house, setHouse] = useState<HouseView | null>(null);
  const [token, setToken] = useState<FlipperTokenInfo | null>(null);
  const [flipperMeta, setFlipperMeta] = useState<{ symbol: string; decimals: number } | null>(null);
  const [randomnessFee, setRandomnessFee] = useState<bigint | null>(null);
  // null until probed: padded, the safe side
  const [feeGasPriced, setFeeGasPriced] = useState<boolean | null>(null);
  const [metaError, setMetaError] = useState<Error | null>(null);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    (async () => {
      const h = await client.house();
      const addr = options.token ?? h.flipper;
      const [meta, fee, gasPriced] = await Promise.all([
        client.tokenMeta(addr),
        client.displayRandomnessFee(addr),
        client.randomnessFeeIsGasPriced(addr),
      ]);
      const isFlipper = isAddressEqual(addr, h.flipper);
      const fMeta = isFlipper ? meta : await client.tokenMeta(h.flipper);
      if (cancelled) return;
      setHouse(h);
      setToken({ address: addr, ...meta, isFlipper });
      setFlipperMeta({ symbol: fMeta.symbol, decimals: fMeta.decimals });
      setRandomnessFee(fee);
      setFeeGasPriced(gasPriced);
      setMetaError(null);
    })().catch((err: unknown) => !cancelled && setMetaError(err instanceof Error ? err : new Error(String(err))));
    return () => {
      cancelled = true;
    };
  }, [client, options.token]);

  // ── balances ────────────────────────────────────────────────────────────────────────────────────
  const [balance, setBalance] = useState<bigint | null>(null);
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (!client || !publicClient || !account || !token) {
      setBalance(null);
      setEthBalance(null);
      return;
    }
    let cancelled = false;
    const load = () =>
      Promise.all([client.balanceOf(token.address, account), publicClient.getBalance({ address: account })])
        .then(([b, e]) => {
          if (cancelled) return;
          setBalance(b);
          setEthBalance(e);
        })
        .catch(() => undefined);
    void load();
    const timer = refreshIntervalMs > 0 ? setInterval(load, refreshIntervalMs) : undefined;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [client, publicClient, account, token, refreshIntervalMs, tick]);

  // ── preview ─────────────────────────────────────────────────────────────────────────────────────
  const decimals = token?.decimals ?? 18;
  const parsedAmount = useMemo(() => (amount.trim() ? parseAmount(amount, decimals) : null), [amount, decimals]);
  const debounced = useDebounced(parsedAmount, debounceMs);
  const [preview, setPreview] = useState<{ amount: bigint; preview: Preview } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    if (!client || !token || debounced === null || debounced <= 0n) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    client
      .preview(token.address, debounced)
      .then((p) => !cancelled && setPreview({ amount: debounced, preview: p }))
      .catch(() => !cancelled && setPreview(null))
      .finally(() => !cancelled && setPreviewing(false));
    return () => {
      cancelled = true;
    };
  }, [client, token, debounced, tick]);
  const current = preview && parsedAmount !== null && preview.amount === parsedAmount ? preview.preview : null;
  const reject = current && current.code !== RejectCode.OK ? rejectReason(current.code, { symbol: token?.symbol }) : null;
  const odds = current && house ? oddsShift(current, house.terms) : null;
  const payoutIfWon =
    parsedAmount !== null && house && token ? potentialPayout(parsedAmount, payoutBps(token.address, house.flipper, house.terms)) : null;
  const quotedFee = current ? current.randomnessFee : randomnessFee;
  const valueToSend = quotedFee === null ? null : feeGasPriced === false ? quotedFee : paddedRandomnessFee(quotedFee);

  // ── flip ────────────────────────────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<FlipperPhase>({ kind: "idle" });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const copyCtx = useCallback(
    () => ({
      symbol: token?.symbol ?? "",
      decimals,
      isFlipper: token?.isFlipper,
      flipperSymbol: flipperMeta?.symbol,
      flipperDecimals: flipperMeta?.decimals,
      flipperPayoutBps: house?.terms.flipperPayoutBps,
    }),
    [token, decimals, flipperMeta, house],
  );

  const flip = useCallback(
    async (amountOverride?: bigint): Promise<Settlement | undefined> => {
      const stake = amountOverride ?? parsedAmount;
      if (!client || !token || stake === null || stake <= 0n) return undefined;
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await client.flip({
          token: token.address,
          amount: stake,
          symbol: token.symbol,
          decimals: token.decimals,
          approve,
          onStep: (s) => setPhase({ kind: "working", step: s.step, hash: "hash" in s ? s.hash : undefined }),
        });
        const spunAt = Date.now();
        setPhase({ kind: "drawing", flipId: res.flipId, hash: res.hash });
        let settlement = await client.waitForSettlement(res.flipId, { fromBlock: res.receipt.blockNumber, signal: ctrl.signal });
        await new Promise<void>((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - spunAt))));
        let copy = describeSettlement(settlement, copyCtx());
        setPhase({ kind: "settled", settlement, copy });
        onSettledRef.current?.(settlement, copy);
        refresh();
        if (settlement.status === FlipStatus.WinPending) {
          // a keeper pays WinPending winnings later: keep watching in the background
          client
            .waitForResolution(res.flipId, { fromBlock: res.receipt.blockNumber, signal: ctrl.signal })
            .then((resolved) => {
              settlement = resolved;
              copy = describeSettlement(resolved, copyCtx());
              setPhase({ kind: "settled", settlement: resolved, copy });
              onSettledRef.current?.(resolved, copy);
              refresh();
            })
            .catch(() => undefined);
        }
        return settlement;
      } catch (err) {
        if (!ctrl.signal.aborted) setPhase({ kind: "error", message: describeError(err, { symbol: token.symbol }) });
        return undefined;
      }
    },
    [client, token, parsedAmount, approve, copyCtx, refresh],
  );

  const maxStake = useCallback(
    async (baseOdds = false): Promise<string | null> => {
      if (!client || !token || balance === null || balance === 0n) return null;
      try {
        const { amount: max } = await client.maxStake(token.address, balance, baseOdds);
        return toInputString(max > 0n ? max : balance, token.decimals);
      } catch {
        return toInputString(balance, token.decimals);
      }
    },
    [client, token, balance],
  );

  const claim = useCallback(async () => {
    if (!client || !account || !token || !house) return;
    try {
      const tokens = token.isFlipper ? [token.address] : [token.address, house.flipper];
      for (const c of await client.claimables(account, tokens)) if (c.amount > 0n) await client.claim(c.token);
      refresh();
    } catch (err) {
      setPhase({ kind: "error", message: describeError(err, { symbol: token.symbol }) });
    }
  }, [client, account, token, house, refresh]);

  const reset = useCallback(() => {
    abort.current?.abort();
    setPhase({ kind: "idle" });
  }, []);

  return {
    ...base,
    error: base.error ?? metaError,
    house,
    token,
    balance,
    ethBalance,
    randomnessFee,
    parsedAmount,
    preview: current,
    previewing,
    reject,
    odds,
    payoutIfWon,
    valueToSend,
    phase,
    busy: phase.kind === "working" || phase.kind === "drawing",
    flip,
    maxStake,
    claim,
    refresh,
    reset,
  };
}
