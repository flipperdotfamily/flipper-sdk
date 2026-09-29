<script setup lang="ts">
import { FlipperWidget, type FlipperEventMap, type FlipperStrings } from "@flipperdotfamily/vue";
import { useConnect, useConnection, useConnectorClient, useConnectors, useDisconnect } from "@wagmi/vue";
import { formatUnits } from "viem";
import { ref, shallowRef } from "vue";
import { DEV_WALLET_ID, type Stack } from "./showcase";

defineProps<{ stack: Stack }>();

const { address } = useConnection();
const connectors = useConnectors();
const { mutate: connect, isPending, error } = useConnect();
const { mutate: disconnect } = useDisconnect();
// the connected wallet as a viem client (undefined while disconnected: the widget runs read-only)
const { data: walletClient } = useConnectorClient();

const widget = shallowRef<{ open(): void; close(): void }>();
const picking = ref(false);
let reopen = false;

// Questline's voice: every built-in string can be replaced (see FlipperStrings)
const strings: Partial<FlipperStrings> = {
  flip: "Double {amount} {symbol}",
  flipAgain: "Go again",
  won: "Loot doubled!",
  lost: "The house takes this round.",
  openWidget: "Bonus flip",
};

// The bonus flip lives in a modal. When it asks for a wallet, step out of it, connect, then come back.
function onConnectRequest() {
  reopen = true;
  widget.value?.close();
  picking.value = true;
}
function pick(c: (typeof connectors.value)[number]) {
  connect(
    { connector: c },
    {
      onSuccess: () => {
        picking.value = false;
        if (reopen) setTimeout(() => widget.value?.open(), 50);
        reopen = false;
      },
    },
  );
}

interface Loot {
  flipId: string;
  text: string;
  won: boolean;
}
const log = ref<Loot[]>([]);
const onSettled = (d: FlipperEventMap["flip-settled"]) => {
  const amount = Number(formatUnits(BigInt(d.amount), d.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const text = d.pending ? `Won ${amount} ${d.symbol}, paying out…` : d.won ? `Doubled ${amount} ${d.symbol}` : `Lost ${amount} ${d.symbol}`;
  // a pending win settles twice (winnings on their way, then paid): one row per flip
  log.value = [{ flipId: d.flipId, won: d.won, text }, ...log.value.filter((l) => l.flipId !== d.flipId)];
};

const quests = [
  { name: "Win 3 ranked matches", done: 2, of: 3, xp: 250 },
  { name: "Open 5 loot crates", done: 5, of: 5, xp: 150 },
  { name: "Collect 1,000 gold", done: 640, of: 1000, xp: 200 },
  { name: "Squad up with a friend", done: 0, of: 1, xp: 120 },
];
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
</script>

<template>
  <header class="bar">
    <div class="wrap bar-in">
      <a class="logo" href="#">
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
          <rect width="32" height="32" rx="9" fill="#6d4aff" />
          <path d="M16 5l9 4v7c0 6-4 9-9 11-5-2-9-5-9-11V9z" fill="#ffb36b" />
          <path d="M16 10v13" stroke="#6d4aff" stroke-width="2.5" stroke-linecap="round" />
        </svg>
        Questline
      </a>
      <nav><a href="#" class="on">Quests</a><a href="#">Leaderboard</a><a href="#">Shop</a></nav>
      <div class="me">
        <span class="lvl"><b>Lv 12</b><i><em style="width: 64%"></em></i></span>
        <button v-if="address" class="chip" title="Disconnect" @click="disconnect()">{{ short(address) }}</button>
        <button v-else class="cta" @click="picking = true">Connect wallet</button>
      </div>
    </div>
  </header>

  <main class="wrap">
    <section class="season">
      <div>
        <span class="tag">Season 3 · 12 days left</span>
        <h1>Tides of Fortune</h1>
        <p>Finish quests, earn loot, and flip it in the bonus round. Heads doubles it.</p>
      </div>
      <div class="pass">
        <span>Season pass</span>
        <b>Tier 18 <small>/ 40</small></b>
        <i><em style="width: 45%"></em></i>
      </div>
    </section>

    <div class="grid">
      <section class="card">
        <h2>Daily quests</h2>
        <ul class="quests">
          <li v-for="q in quests" :key="q.name" :class="{ done: q.done >= q.of }">
            <div class="q-top">
              <span>{{ q.name }}</span>
              <b>+{{ q.xp }} XP</b>
            </div>
            <i><em :style="{ width: `${Math.min(100, (q.done / q.of) * 100)}%` }"></em></i>
            <small>{{ q.done >= q.of ? "Complete" : `${q.done.toLocaleString()} / ${q.of.toLocaleString()}` }}</small>
          </li>
        </ul>
      </section>

      <section class="card vault">
        <div class="chest" aria-hidden="true">
          <svg viewBox="0 0 120 90" width="120" height="90">
            <rect x="10" y="38" width="100" height="46" rx="8" fill="#ff9a3d" />
            <path d="M10 44a50 26 0 0 1 100 0z" fill="#ffb36b" />
            <rect x="10" y="40" width="100" height="8" fill="#6d4aff" />
            <rect x="52" y="36" width="16" height="22" rx="4" fill="#ffe08a" stroke="#6d4aff" stroke-width="3" />
            <circle cx="30" cy="20" r="5" fill="#ffe08a" /><circle cx="92" cy="14" r="4" fill="#ffe08a" /><circle cx="70" cy="8" r="3" fill="#ffe08a" />
          </svg>
        </div>
        <h2>Bonus round</h2>
        <p>Flip any token in your wallet, double or nothing. It's provably fair and settles onchain.</p>
        <!-- the widget as a button: it opens the flip card in a modal -->
        <FlipperWidget
          ref="widget"
          variant="button"
          button-label="Bonus flip: double your loot"
          :wallet-client="walletClient ?? null"
          :strings="strings"
          @connect-request="onConnectRequest"
          @flip-settled="onSettled"
          @error="(e) => console.warn('flipper:', e.message)"
        />
        <h3>Loot log</h3>
        <ul v-if="log.length" class="log" data-testid="loot-log">
          <li v-for="l in log" :key="l.flipId" :class="l.won ? 'won' : 'lost'">{{ l.text }}</li>
        </ul>
        <p v-else class="muted">Your bonus flips show up here.</p>
      </section>
    </div>
  </main>

  <div v-if="picking" class="modal" @click.self="picking = false">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Connect a wallet">
      <h3>Connect a wallet</h3>
      <p v-if="!connectors.length" class="muted">No browser wallet found. Install one, such as Rabby or MetaMask.</p>
      <button v-for="c in connectors" :key="c.uid" class="wallet" :disabled="isPending" @click="pick(c)">
        <img v-if="c.icon" :src="c.icon" alt="" />
        <span>{{ c.name }}</span>
        <span v-if="c.id === DEV_WALLET_ID" class="dev">DEV · local fork</span>
      </button>
      <p v-if="error" class="err">{{ error.message.split("\n")[0] }}</p>
    </div>
  </div>
</template>
