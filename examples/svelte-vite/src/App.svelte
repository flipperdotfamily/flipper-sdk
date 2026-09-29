<script lang="ts">
  import { FlipperWidget, type FlipperEventMap } from "@flipperdotfamily/svelte";
  import { getBalance, readContracts } from "@wagmi/core";
  import { erc20Abi, formatUnits } from "viem";
  import { DEV_WALLET_ID, type ShowcaseToken, type Stack } from "./showcase";
  import type { Wallet } from "./wallet.svelte";

  let { stack, wallet }: { stack: Stack; wallet: Wallet } = $props();

  const TRACKED = ["FLIPPER", "Degen", "BNKR", "PONS", "WETH"];
  let tokens = $state.raw<ShowcaseToken[]>([]);
  let holdings = $state.raw<{ symbol: string; name: string; logo: string | null; amount: number }[]>([]);
  let picking = $state(false);
  let flips = $state.raw<{ id: string; text: string; won: boolean; at: string }[]>([]);

  $effect(() => {
    // Folio's usual list, or (on a chain without those tokens) the first few listed ones
    Promise.all([stack.findTokens(TRACKED), stack.listTokens()]).then(([mine, all]) => {
      tokens = mine.length > 2 ? mine : [...mine, ...all.filter((t) => !mine.some((m) => m.address === t.address))].slice(0, 6);
    });
  });

  async function refresh() {
    const address = wallet.address;
    if (!address) return (holdings = []);
    const [eth, results] = await Promise.all([
      getBalance(wallet.config, { address }),
      readContracts(wallet.config, { contracts: tokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address] }) as const) }),
    ]);
    holdings = [
      { symbol: stack.nativeSymbol, name: "Ether", logo: null, amount: Number(formatUnits(eth.value, 18)) },
      ...tokens.map((t, i) => ({ symbol: t.symbol, name: t.name, logo: t.logo, amount: Number(formatUnits((results[i]?.result as bigint) ?? 0n, t.decimals)) })),
    ];
  }
  $effect(() => {
    void wallet.address;
    void tokens;
    refresh();
  });

  const onSettled = (d: FlipperEventMap["flip-settled"]) => {
    const amount = Number(formatUnits(BigInt(d.amount), d.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const at = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const text = d.pending ? `Won ${amount} ${d.symbol}, paying out…` : `${d.won ? "Won" : "Lost"} ${amount} ${d.symbol}`;
    // a pending win settles twice (winnings on their way, then paid): one row per flip
    flips = [{ id: d.flipId, won: d.won, text, at }, ...flips.filter((f) => f.id !== d.flipId)];
    refresh();
  };

  // a little 30-day line per asset (decorative: Folio's price history isn't part of this demo)
  function spark(seed: string) {
    let h = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const pts: number[] = [];
    let y = 16;
    for (let i = 0; i < 24; i++) {
      h = (h * 1103515245 + 12345) >>> 0;
      y = Math.max(3, Math.min(29, y + ((h % 9) - 4) * 0.9));
      pts.push(y);
    }
    return { d: pts.map((v, i) => `${i ? "L" : "M"}${(i * 100) / 23},${v}`).join(" "), up: pts[23]! <= pts[0]! };
  }
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString(undefined, { maximumFractionDigits: 4 }));
  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
  const assets = $derived(holdings.filter((h) => h.amount > 0).length);
</script>

<div class="app">
  <div class="main">
    <header>
      <a class="logo" href="./">
        <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#3ddc97" /><path d="M8 22l6-7 4 4 6-9" fill="none" stroke="#0a0f0e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Folio
      </a>
      <nav><a href="./" class="on">Portfolio</a><a href="#watchlist">Watchlist</a><a href="#reports">Reports</a></nav>
      {#if wallet.address}
        <button class="acct" onclick={wallet.disconnect} title="Disconnect"><span class="dot"></span>{short(wallet.address)}</button>
      {:else}
        <button class="btn" onclick={() => (picking = true)}>Connect wallet</button>
      {/if}
    </header>

    <section class="summary">
      <div>
        <span class="label">Wallet</span>
        <b class="big">{holdings[0] ? `${fmt(holdings[0].amount)} ${stack.nativeSymbol}` : "—"}</b>
        <span class="muted">{wallet.address ? `${assets} assets on ${stack.chainName}` : "Connect a wallet to track it"}</span>
      </div>
      <svg class="chart" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3ddc97" stop-opacity=".35" /><stop offset="1" stop-color="#3ddc97" stop-opacity="0" /></linearGradient></defs>
        <path d={`${spark("folio-net-worth").d} L100,32 L0,32 Z`} fill="url(#g)" />
        <path d={spark("folio-net-worth").d} fill="none" stroke="#3ddc97" stroke-width="1.2" vector-effect="non-scaling-stroke" />
      </svg>
    </section>

    <section class="table">
      <div class="thead"><span>Asset</span><span>Balance</span><span class="hide-s">30 days</span></div>
      {#if !holdings.length}
        <p class="muted empty">{wallet.address ? "Loading balances…" : "Your holdings appear here once a wallet is connected."}</p>
      {/if}
      {#each holdings as h (h.symbol)}
        {@const s = spark(h.symbol)}
        <div class="row">
          <span class="asset">
            {#if h.logo}<img src={h.logo} alt="" />{:else}<i style={`background:hsl(${[...h.symbol].reduce((a, c) => a + c.charCodeAt(0) * 41, 0) % 360} 60% 55%)`}>{h.symbol[0]}</i>{/if}
            <span><b>{h.symbol}</b><small>{h.name}</small></span>
          </span>
          <span class="num">{fmt(h.amount)}</span>
          <svg class="hide-s spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><path d={s.d} fill="none" stroke={s.up ? "#3ddc97" : "#ff6b6b"} stroke-width="1.4" vector-effect="non-scaling-stroke" /></svg>
        </div>
      {/each}
    </section>
  </div>

  <aside class="side">
    <div class="side-head">
      <h2>Quick flip</h2>
      <span class="muted">Double or nothing on any token you hold.</span>
    </div>
    <!-- the widget fills this pane: compact variant, fit="fill", small size -->
    <div class="pane">
      <FlipperWidget
        variant="compact"
        fit="fill"
        size="sm"
        walletClient={wallet.client ?? null}
        chainId={stack.chainId}
        deploymentUrl={stack.deploymentUrl}
        partner="folio"
        theme={{ mode: "dark", accent: "#3ddc97", radius: 16, background: "#0f1715", surface: "#121c19", field: "#0b1210", border: "#ffffff12" }}
        onConnectRequest={() => (picking = true)}
        onFlipSettled={onSettled}
        onError={(e) => console.warn("flipper:", e.message)}
      />
    </div>
    <div class="recent">
      <h3>Recent flips</h3>
      {#if flips.length}
        <ul data-testid="recent">
          {#each flips as f (f.id)}
            <li class={f.won ? "won" : "lost"}><span>{f.text}</span><small>{f.at}</small></li>
          {/each}
        </ul>
      {:else}
        <p class="muted">Nothing yet.</p>
      {/if}
    </div>
  </aside>
</div>

{#if picking}
  <div class="modal" role="presentation" onclick={(e) => e.target === e.currentTarget && (picking = false)}>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Connect a wallet">
      <h3>Connect a wallet</h3>
      {#if !wallet.connectors.length}<p class="muted">No browser wallet found. Install one, such as Rabby or MetaMask.</p>{/if}
      {#each wallet.connectors as c (c.uid)}
        <button class="wallet" onclick={() => wallet.connect(c).then(() => (picking = false))}>
          {#if c.icon}<img src={c.icon} alt="" />{/if}
          <span>{c.name}</span>
          {#if c.id === DEV_WALLET_ID}<span class="dev">DEV · local fork</span>{/if}
        </button>
      {/each}
    </div>
  </div>
{/if}
