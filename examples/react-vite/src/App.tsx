import { FlipperWidget, type FlipperEventMap } from "@flipperdotfamily/react";
import { useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { useBalance, useConnect, useConnection, useConnectors, useDisconnect, useReadContracts, useWalletClient } from "wagmi";
import { DEV_WALLET_ID, type ShowcaseToken, type Stack } from "./showcase";

// The tokens Lagoon lets its users flip (the widget's `tokens` allowlist), by symbol. $FLIPPER and ETH are always on.
const LAGOON_TOKENS = ["FLIPPER", "Degen", "BNKR", "PONS"];

interface Activity {
  flipId: string;
  symbol: string;
  amount: string;
  status: "pending" | "won" | "lost" | "refunded";
  payout?: string;
  at: number;
}
interface Toast {
  id: number;
  tone: "win" | "loss" | "info";
  title: string;
  body: string;
}

const fmt = (wei: string | bigint, decimals: number) => {
  const n = Number(formatUnits(BigInt(wei), decimals));
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function App({ stack }: { stack: Stack }) {
  const { address } = useConnection();
  const { data: walletClient } = useWalletClient();
  const { mutate: disconnect } = useDisconnect();
  const [picking, setPicking] = useState(false);
  const [tokens, setTokens] = useState<ShowcaseToken[] | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    // Lagoon's list, or (on a chain without those tokens) the first few listed ones
    Promise.all([stack.findTokens(LAGOON_TOKENS), stack.listTokens()])
      .then(([mine, all]) => setTokens(mine.length > 2 ? mine : [...mine, ...all.filter((t) => !mine.some((m) => m.address === t.address))].slice(0, 5)))
      .catch(() => setTokens([]));
  }, [stack]);
  const allowlist = useMemo(
    () => [...new Set([stack.addresses.flipper, "ETH", ...(tokens ?? []).map((t) => t.address)].filter(Boolean))],
    [tokens, stack],
  );

  // portfolio: ETH plus the allowlisted tokens
  const eth = useBalance({ address, query: { enabled: !!address } });
  const balances = useReadContracts({
    contracts: (tokens ?? []).map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address!] }) as const),
    query: { enabled: !!address && !!tokens?.length },
  });

  const toast = (t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 5000);
  };

  const onRequested = (d: FlipperEventMap["flip-requested"]) => {
    setActivity((a) => [{ flipId: d.flipId, symbol: d.symbol, amount: fmt(d.amount, d.decimals), status: "pending", at: Date.now() }, ...a]);
    toast({ tone: "info", title: "Flip sent", body: `${fmt(d.amount, d.decimals)} ${d.symbol}: waiting for the coin.` });
  };
  const onSettled = (d: FlipperEventMap["flip-settled"]) => {
    const status = d.outcome;
    setActivity((a) => {
      const row = { flipId: d.flipId, symbol: d.symbol, amount: fmt(d.amount, d.decimals), status, payout: d.won ? fmt(d.payout, d.decimals) : undefined, at: Date.now() };
      return a.some((x) => x.flipId === d.flipId) ? a.map((x) => (x.flipId === d.flipId ? { ...x, ...row } : x)) : [row, ...a];
    });
    toast(
      d.pending
        ? { tone: "win", title: "You won", body: `Your ${d.symbol} stake is back. The winnings are being paid out.` }
        : d.won
        ? { tone: "win", title: "You won", body: `+${fmt(d.payout, d.decimals)} ${d.symbol} landed in your wallet.` }
        : status === "refunded"
          ? { tone: "info", title: "Refunded", body: `Your ${d.symbol} stake came back.` }
          : { tone: "loss", title: "Tails", body: `${fmt(d.amount, d.decimals)} ${d.symbol} went to the house.` },
    );
    void eth.refetch();
    void balances.refetch();
  };

  const rows = (tokens ?? []).map((t, i) => ({ token: t, balance: balances.data?.[i]?.result as bigint | undefined }));

  return (
    <div className="shell">
      <aside className="side">
        <a className="logo" href="#">
          <Wave /> Lagoon
        </a>
        <nav>
          {["Overview", "Swap", "Pools", "Flip", "Activity"].map((n) => (
            <a key={n} href="#" className={n === "Flip" ? "on" : undefined} aria-current={n === "Flip" ? "page" : undefined}>
              {n}
              {n === "Flip" && <span className="new">new</span>}
            </a>
          ))}
        </nav>
        <div className="net">
          <span className="dot" /> {stack.chainName}
          <small>chain {stack.chainId}</small>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <div>
            <h1>Flip</h1>
            <p>Double or nothing on the tokens Lagoon supports. Settles onchain in seconds.</p>
          </div>
          {address ? (
            <button className="acct" onClick={() => disconnect()} title="Disconnect">
              <span className="dot" />
              {short(address)}
            </button>
          ) : (
            <button className="btn" onClick={() => setPicking(true)}>
              Connect wallet
            </button>
          )}
        </header>

        <div className="cols">
          <section className="panel portfolio">
            <h2>Your tokens</h2>
            {!address ? (
              <p className="muted">Connect a wallet to see your balances.</p>
            ) : (
              <ul className="tokens">
                <li>
                  <Avatar symbol={stack.nativeSymbol} />
                  <span className="sym">{stack.nativeSymbol}</span>
                  <span className="num">{eth.data ? fmt(eth.data.value, 18) : "–"}</span>
                </li>
                {rows.map(({ token, balance }) => (
                  <li key={token.address}>
                    <Avatar symbol={token.symbol} logo={token.logo} />
                    <span className="sym">{token.symbol}</span>
                    <span className="num">{balance !== undefined ? fmt(balance, token.decimals) : "–"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flip">
            {tokens && (
              <FlipperWidget
                walletClient={walletClient ?? null}
                onConnectRequest={() => setPicking(true)}
                chainId={stack.chainId}
                deploymentUrl={stack.deploymentUrl}
                mode="picker"
                tokens={allowlist}
                token={stack.addresses.flipper}
                variant="card"
                partner="lagoon"
                theme={{
                  mode: "dark",
                  accent: "#7c5cff",
                  radius: 20,
                  background: "#0e1430",
                  surface: "#131a3a",
                  field: "#0b1027",
                  border: "#ffffff14",
                }}
                onFlipRequested={onRequested}
                onFlipSettled={onSettled}
                onError={(e) => console.warn("flipper:", e.message)}
              />
            )}
          </section>

          <section className="panel activity">
            <h2>Activity</h2>
            {activity.length === 0 ? (
              <p className="muted">Your flips show up here as they happen.</p>
            ) : (
              <ul className="feed" data-testid="activity">
                {activity.map((a) => (
                  <li key={a.flipId} data-status={a.status}>
                    <span className={`badge ${a.status}`}>{a.status === "pending" ? "flipping" : a.status}</span>
                    <span>
                      {a.amount} {a.symbol}
                    </span>
                    <span className="muted">{a.payout ? `+${a.payout}` : `#${a.flipId}`}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {picking && <ConnectModal onClose={() => setPicking(false)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <b>{t.title}</b>
            <span>{t.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Lagoon's wallet picker: wagmi's EIP-6963 connectors. */
function ConnectModal({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <h3>Connect a wallet</h3>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {connectors.length === 0 && <p className="muted">No browser wallet found. Install one, such as Rabby or MetaMask.</p>}
        <div className="wallets">
          {connectors.map((c) => (
            <button key={c.uid} className="wallet" disabled={isPending} onClick={() => connect({ connector: c }, { onSuccess: onClose })}>
              {c.icon ? <img src={c.icon} alt="" /> : <Avatar symbol={c.name} />}
              <span>{c.name}</span>
              {c.id === DEV_WALLET_ID && <span className="dev">DEV · local fork</span>}
            </button>
          ))}
        </div>
        {error && <p className="err">{error.message.split("\n")[0]}</p>}
      </div>
    </div>
  );
}

function Avatar({ symbol, logo }: { symbol: string; logo?: string | null }) {
  if (logo) return <img className="avatar" src={logo} alt="" />;
  const hue = [...symbol].reduce((h, c) => h + c.charCodeAt(0) * 37, 0) % 360;
  return (
    <span className="avatar" style={{ background: `hsl(${hue} 70% 55%)` }}>
      {symbol.slice(0, 1)}
    </span>
  );
}

function Wave() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#7c5cff" />
      <path d="M5 19c4-4 7-4 11 0s7 4 11 0" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M5 12c4-4 7-4 11 0s7 4 11 0" fill="none" stroke="#ffffff80" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
