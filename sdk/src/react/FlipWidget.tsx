import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatEther, isAddressEqual, type Address, type Hash } from "viem";
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { getFlipperAddresses } from "../addresses";
import { createFlipperClient, paddedRandomnessFee, type FlipperPublicClient, type FlipperWalletClient } from "../client";
import { FlipStatus, RejectCode } from "../constants";
import { describeError } from "../errors";
import { formatNumber, formatTokenAmount, parseAmount, toInputString } from "../format";
import { formatBps, formatMultiple, formatWinChance, oddsShift, payoutBps, potentialPayout, rejectReason } from "../odds";
import { describeSettlement, type SettlementCopy } from "../settlement";
import type { FlipperAddresses, FlipStep, Settlement } from "../types";
import { MiniCoin, type MiniCoinState } from "./MiniCoin";
import { WIDGET_CSS, WIDGET_STYLE_ID } from "./styles";

export interface FlipWidgetProps {
  /** token to flip (must be listed on the house, or $FLIPPER) */
  token: Address;
  /** protocol addresses; defaults to the canonical deployment registered for `chainId` */
  addresses?: FlipperAddresses;
  /** chain the house lives on (default: the host wagmi config's current chain); must be in the host's wagmi config */
  chainId?: number;
  theme?: "dark" | "light";
  /** called once a flip settles */
  onSettled?: (settlement: Settlement) => void;
  /** called when a disconnected user presses the button (open your connect modal here) */
  onConnect?: () => void;
  className?: string;
  style?: CSSProperties;
}

type Phase =
  | { kind: "idle" }
  | { kind: "working"; step: FlipStep["step"]; hash?: Hash }
  | { kind: "drawing"; flipId: bigint; hash: Hash }
  | { kind: "done"; settlement: Settlement; copy: SettlementCopy; fromBlock?: bigint }
  | { kind: "error"; message: string };

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
 * Embeddable flip card. Uses the host app's wagmi + react-query context; styles are self-contained.
 *
 * ```tsx
 * <FlipWidget token="0x…" addresses={{ house, lens }} theme="dark" onSettled={(s) => console.log(s.won)} />
 * ```
 */
export function FlipWidget({
  token,
  addresses: addressesProp,
  chainId: chainIdProp,
  theme = "dark",
  onSettled,
  onConnect,
  className,
  style,
}: FlipWidgetProps) {
  const hostChainId = useChainId();
  const chainId = chainIdProp ?? hostChainId;
  const addresses = addressesProp ?? getFlipperAddresses(chainId);
  const { address: account, chainId: walletChainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const { switchChain, isPending: switching } = useSwitchChain();
  const queryClient = useQueryClient();

  const client = useMemo(
    () =>
      addresses && publicClient
        ? createFlipperClient({
            publicClient: publicClient as unknown as FlipperPublicClient,
            walletClient: (walletClient ?? null) as unknown as FlipperWalletClient | null,
            addresses,
          })
        : null,
    [addresses, publicClient, walletClient],
  );

  const base = ["flipper-widget", chainId, addresses?.house, token] as const;

  const houseQ = useQuery({
    queryKey: [...base, "house"],
    enabled: !!client,
    staleTime: 30_000,
    queryFn: async () => {
      // the fee to show: evaluated at the expected gas price (Chainlink-style fees scale with it)
      const [house, meta, fee, feeGasPriced] = await Promise.all([
        client!.house(),
        client!.tokenMeta(token),
        client!.displayRandomnessFee(token),
        client!.randomnessFeeIsGasPriced(token),
      ]);
      const flipperMeta = isAddressEqual(house.flipper, token) ? meta : await client!.tokenMeta(house.flipper);
      return { house, meta, flipperMeta, fee, feeGasPriced };
    },
  });
  const house = houseQ.data?.house;
  const meta = houseQ.data?.meta;
  const decimals = meta?.decimals ?? 18;
  const symbol = meta?.symbol ?? "…";
  const isFlipper = !!house && isAddressEqual(house.flipper, token);

  const balanceQ = useQuery({
    queryKey: [...base, "balance", account],
    enabled: !!client && !!account,
    refetchInterval: 15_000,
    queryFn: async () => {
      const [tokenBal, eth] = await Promise.all([client!.balanceOf(token, account!), publicClient!.getBalance({ address: account! })]);
      return { tokenBal, eth };
    },
  });

  const [text, setText] = useState("");
  const amount = useMemo(() => parseAmount(text, decimals), [text, decimals]);
  const debounced = useDebounced(amount, 400);

  const previewQ = useQuery({
    queryKey: [...base, "preview", debounced?.toString()],
    enabled: !!client && debounced !== null && debounced > 0n,
    staleTime: 10_000,
    queryFn: () => client!.preview(token, debounced!),
  });
  const preview = amount !== null && amount === debounced ? previewQ.data : undefined;

  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [maxing, setMaxing] = useState(false);
  const busy = phase.kind === "working" || phase.kind === "drawing";
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const onMax = useCallback(async () => {
    const bal = balanceQ.data?.tokenBal;
    if (!client || !bal) return;
    setMaxing(true);
    try {
      const { amount: max } = await client.maxStake(token, bal, false);
      setText(max > 0n ? toInputString(max, decimals) : toInputString(bal, decimals));
    } catch {
      setText(toInputString(bal, decimals));
    } finally {
      setMaxing(false);
    }
  }, [client, balanceQ.data, token, decimals]);

  // Shifted odds → suggest the stake at which they return to base.
  const shift = preview && house ? oddsShift(preview, house.terms) : undefined;
  const baseHi = balanceQ.data?.tokenBal && balanceQ.data.tokenBal > 0n ? balanceQ.data.tokenBal : (amount ?? 0n);
  const baseStakeQ = useQuery({
    queryKey: [...base, "base-odds-max", baseHi.toString()],
    enabled: !!client && !!shift?.shifted && baseHi > 0n,
    staleTime: 30_000,
    queryFn: () => client!.maxStake(token, baseHi, true),
  });

  const copyCtx = {
    symbol,
    decimals,
    isFlipper,
    flipperSymbol: houseQ.data?.flipperMeta.symbol,
    flipperDecimals: houseQ.data?.flipperMeta.decimals,
    flipperPayoutBps: house?.terms.flipperPayoutBps,
  };

  const flip = useCallback(async () => {
    if (!client || amount === null || amount <= 0n) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await client.flip({
        token,
        amount,
        symbol,
        onStep: (s) => setPhase({ kind: "working", step: s.step, hash: "hash" in s ? s.hash : undefined }),
      });
      const spunAt = Date.now();
      setPhase({ kind: "drawing", flipId: res.flipId, hash: res.hash });
      const settlement = await client.waitForSettlement(res.flipId, { fromBlock: res.receipt.blockNumber, signal: ctrl.signal });
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_SPIN_MS - (Date.now() - spunAt))));
      const copy = describeSettlement(settlement, copyCtx);
      setPhase({ kind: "done", settlement, copy, fromBlock: res.receipt.blockNumber });
      onSettled?.(settlement);
      void queryClient.invalidateQueries({ queryKey: base });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      setPhase({ kind: "error", message: describeError(err, { symbol }) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, amount, token, symbol, decimals, isFlipper, house, houseQ.data, onSettled, queryClient]);

  // A WinPending flip is resolved later by a keeper (PendingWinResolved): keep watching and update the copy.
  const pendingId = phase.kind === "done" && phase.settlement.status === FlipStatus.WinPending ? phase.settlement.flipId : null;
  const pendingFrom = phase.kind === "done" ? phase.fromBlock : undefined;
  useEffect(() => {
    if (pendingId === null || !client) return;
    const ctrl = new AbortController();
    client
      .waitForResolution(pendingId, { signal: ctrl.signal, fromBlock: pendingFrom })
      .then((settlement) => {
        setPhase({ kind: "done", settlement, fromBlock: pendingFrom, copy: describeSettlement(settlement, copyCtx) });
        onSettled?.(settlement);
      })
      .catch(() => undefined);
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId, client]);

  const claimNow = useCallback(async () => {
    if (!client || !account) return;
    try {
      const tokens = house && !isFlipper ? [token, house.flipper] : [token];
      for (const c of await client.claimables(account, tokens)) if (c.amount > 0n) await client.claim(c.token);
      void queryClient.invalidateQueries({ queryKey: base });
    } catch (err) {
      setPhase({ kind: "error", message: describeError(err, { symbol }) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, account, token, house, isFlipper, symbol, queryClient]);

  const coin: MiniCoinState =
    phase.kind === "drawing" || (phase.kind === "working" && phase.step === "flip-sent")
      ? { status: "spinning" }
      : phase.kind === "done" && phase.copy.face
        ? { status: "revealed", face: phase.copy.face, won: phase.copy.tone === "win" }
        : { status: "idle" };

  // ── button state ──────────────────────────────────────────────────────────────────────────────────
  const tokenBal = balanceQ.data?.tokenBal;
  const reject = preview && preview.code !== RejectCode.OK ? rejectReason(preview.code, { symbol }) : null;
  const fee = houseQ.data?.fee ?? preview?.randomnessFee ?? 0n; // per-token: $FLIPPER flips are much cheaper
  // what flip() sends: exact for a flat fee (Dice, Pyth), padded for a gas-priced one (excess refunded)
  const quotedFee = preview?.randomnessFee ?? fee;
  const feeToSend = houseQ.data?.feeGasPriced === false ? quotedFee : paddedRandomnessFee(quotedFee);
  let label = `Flip${amount ? ` ${formatTokenAmount(amount, decimals)} ${symbol}` : ""}`;
  let action: (() => void) | undefined = () => void flip();
  if (!addresses) {
    label = "Not available on this network";
    action = undefined;
  } else if (!isConnected) {
    label = "Connect wallet";
    action = onConnect;
  } else if (walletChainId !== chainId) {
    label = switching ? "Switching…" : "Switch network";
    action = () => switchChain({ chainId });
  } else if (phase.kind === "working") {
    label = {
      previewing: "Checking odds…",
      approving: `Approve ${symbol} in wallet…`,
      "approve-sent": `Approving ${symbol}…`,
      signing: "Confirm in wallet…",
      "flip-sent": "Flipping…",
      requested: "Drawing…",
    }[phase.step];
    action = undefined;
  } else if (phase.kind === "drawing") {
    label = "Drawing…";
    action = undefined;
  } else if (amount === null || amount === 0n) {
    label = "Enter an amount";
    action = undefined;
  } else if (tokenBal !== undefined && amount > tokenBal) {
    label = `Not enough ${symbol}`;
    action = undefined;
  } else if (balanceQ.data && fee > 0n && balanceQ.data.eth < feeToSend) {
    label = "Need ETH for the randomness fee";
    action = undefined;
  } else if (!preview) {
    label = previewQ.isError ? "Couldn't price this flip" : "Pricing…";
    action = undefined;
  } else if (reject) {
    label = reject.title;
    action = undefined;
  } else if (phase.kind === "done") {
    label = "Flip again";
  }

  const mult = house ? payoutBps(token, house.flipper, house.terms) : 20_000n;
  const payout = amount && amount > 0n ? potentialPayout(amount, mult) : 0n;

  return (
    <div className={`flw${className ? ` ${className}` : ""}`} data-theme={theme} style={style}>
      <style href={WIDGET_STYLE_ID} precedence="default">
        {WIDGET_CSS}
      </style>

      <div className="flw-head">
        <MiniCoin state={coin} />
        <div>
          <p className="flw-title">Flip {symbol}</p>
          <p className="flw-sub">
            Double or nothing on{" "}
            <a href="https://flipper.family" target="_blank" rel="noreferrer">
              flipper.family
            </a>
          </p>
        </div>
      </div>

      <label className="flw-field">
        <span className="flw-sr">Amount of {symbol} to flip</span>
        <input
          className="flw-input"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value.replace(/[^\d.,]/g, ""));
            if (phase.kind === "error" || phase.kind === "done") setPhase({ kind: "idle" });
          }}
        />
        <span className="flw-sym">{symbol}</span>
        <button type="button" className="flw-max" onClick={onMax} disabled={!tokenBal || busy || maxing}>
          {maxing ? "…" : "MAX"}
        </button>
      </label>
      <div className="flw-meta">
        <span>
          Balance <span className="flw-num">{tokenBal !== undefined ? formatTokenAmount(tokenBal, decimals) : "–"}</span>
        </span>
        {house && <span className="flw-num">fee {formatNumber(Number(formatEther(fee)))} ETH</span>}
      </div>

      {house && (
        <dl className="flw-odds">
          <dt>Win chance</dt>
          <dd className={shift?.shifted ? "flw-shifted" : "flw-strong"}>
            {formatBps(preview && preview.winChanceBps > 0n ? preview.winChanceBps : house.terms.baseWinChanceBps)}
          </dd>
          <dt>Payout</dt>
          <dd>
            {formatMultiple(mult)}
            {payout > 0n ? ` · ${formatTokenAmount(payout, decimals)} ${symbol}` : ""}
          </dd>
        </dl>
      )}

      {shift?.shifted && (
        <p className="flw-note" role="status">
          <b>{shift.message}.</b>{" "}
          {baseStakeQ.data && baseStakeQ.data.amount > 0n ? (
            <>
              Flip{" "}
              <button
                type="button"
                className="flw-link"
                onClick={() => setText(toInputString(baseStakeQ.data!.amount, decimals))}
              >
                {formatTokenAmount(baseStakeQ.data.amount, decimals)} {symbol}
              </button>{" "}
              or less for the full {formatBps(shift.baseWinChanceBps)}.
            </>
          ) : baseStakeQ.isFetching ? (
            "Finding the stake for full odds…"
          ) : null}
        </p>
      )}
      {reject && !busy && (
        <p className="flw-note flw-note--error" role="status">
          {reject.message}
        </p>
      )}
      {phase.kind === "error" && (
        <p className="flw-note flw-note--error" role="alert">
          {phase.message}
        </p>
      )}
      {houseQ.isError && (
        <p className="flw-note flw-note--error" role="alert">
          Can&apos;t reach the flipper contracts on this network.
        </p>
      )}

      <button
        type="button"
        className="flw-cta"
        disabled={!action}
        data-busy={busy}
        onClick={action}
        aria-live="polite"
      >
        {label}
      </button>

      <div className="flw-result" aria-live="polite">
        {phase.kind === "done" && (
          <>
            <p className="flw-headline" data-tone={phase.copy.tone}>
              {phase.copy.headline}
            </p>
            <p className="flw-detail">{phase.copy.detail}</p>
            {phase.copy.claimable && (
              <button type="button" className="flw-link" onClick={() => void claimNow()}>
                Claim now
              </button>
            )}
            {phase.copy.fairness && <p className="flw-fair">{phase.copy.fairness}</p>}
          </>
        )}
      </div>
      <div className="flw-foot">
        <span>Verifiable randomness{publicClient?.chain?.name ? ` · ${publicClient.chain.name}` : ""}</span>
        {house && <span>{formatWinChance(house.terms.baseWinChanceBps)} base odds</span>}
      </div>
    </div>
  );
}
