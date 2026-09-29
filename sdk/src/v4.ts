import { getAddress, isAddressEqual, zeroAddress, type Address, type Hex } from "viem";
import { erc20Abi, poolManagerAbi, v4RouteAdapterAbi } from "./abis/slim";
import type { FlipperPublicClient } from "./client";
import { MULTICALL3, PONS, QUOTES_AND_STABLES, knownPoolManager } from "./constants";
import type { DiscoveredToken, KeyValueStore, PoolKey } from "./types";

/** A Uniswap v4 pool from the PoolManager's `Initialize` log (or a server index). */
export interface V4Pool {
  id: Hex;
  key: PoolKey;
  block: bigint;
  /** the flippable side, when an index already picked it (otherwise both sides are considered) */
  token?: Address;
  /** index-reported ETH-side depth of this pool (ranked keeper index) */
  depthWei?: bigint;
  /** other eligible pools for the same token (ranked index), tried in depth order if this one fails check() */
  alternatives?: V4Pool[];
}

export interface V4ScanProgress {
  /** lowest block the scan must reach (the PoolManager's first Initialize) */
  fromBlock: bigint;
  head: bigint;
  /** contiguous range already scanned: [scannedFrom, scannedTo] */
  scannedFrom: bigint;
  scannedTo: bigint;
  pools: number;
  /** 0..1 */
  fraction: number;
  done: boolean;
}

export interface V4ScanOptions {
  /** Uniswap v4 PoolManager; defaults to the known one for the client's chain (KNOWN_POOL_MANAGERS) */
  poolManager?: Address;
  /** block of the PoolManager's first `Initialize` (defaults with `poolManager`; else 0) */
  fromBlock?: bigint;
  /** ≤ 10k: many public RPCs reject larger eth_getLogs ranges */
  chunkSize?: bigint;
  /** chunks fetched per call; the scan resumes from `store` on the next call (default 300) */
  maxChunks?: number;
  concurrency?: number;
  store?: KeyValueStore;
  onProgress?: (p: V4ScanProgress) => void;
}

/** `V4RouteAdapter.check` reason codes → plain English. */
export const V4_CHECK_REASONS: Record<number, string> = {
  0: "OK",
  1: "Not a token contract",
  2: "That's $FLIPPER itself",
  3: "The pool doesn't contain this token",
  4: "Paired with an unsupported quote currency",
  5: "The pool uses a hook flipper doesn't route through",
  6: "The pool isn't initialized",
  7: "No in-range liquidity",
  8: "A deeper pool is already registered",
  12: "Only hookit launches and whitelisted tokens can be listed",
  13: "The pool uses a hook flipper hasn't approved",
};
export const v4CheckReason = (code: number) => V4_CHECK_REASONS[code] ?? `Rejected by the v4 adapter (code ${code})`;

type CompactPool = [id: Hex, c0: Address, c1: Address, fee: number, ts: number, hooks: Address, block: string];
interface ScanCache {
  v: 1;
  lo: string;
  hi: string;
  pools: CompactPool[];
}

async function runLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

/**
 * Scans the PoolManager's `Initialize` logs in ≤10k-block chunks. The scanned range stays contiguous and is
 * persisted in `store`: each call first catches up to the head, then keeps walking backwards (newest pools
 * first) until it reaches `fromBlock`, fetching at most `maxChunks` chunks. Call it repeatedly until `done`.
 */
export async function scanV4Pools(
  pc: FlipperPublicClient,
  opts: V4ScanOptions = {},
): Promise<{ pools: V4Pool[]; progress: V4ScanProgress }> {
  const chainId = pc.chain?.id ?? (await pc.getChainId());
  const known = knownPoolManager(chainId);
  const pm = opts.poolManager ?? known?.poolManager;
  if (!pm) throw new Error(`No Uniswap v4 PoolManager configured for chain ${chainId}`);
  const fromBlock = opts.fromBlock ?? (known && known.poolManager.toLowerCase() === pm.toLowerCase() ? known.firstInitializeBlock : 0n);
  const chunk = opts.chunkSize && opts.chunkSize > 0n && opts.chunkSize <= 10_000n ? opts.chunkSize : 10_000n;
  const concurrency = opts.concurrency ?? 6;
  let budget = opts.maxChunks ?? 300;
  const head = await pc.getBlockNumber({ cacheTime: 0 });
  const key = `flipper:v4-pools:v1:${chainId}:${pm.toLowerCase()}`;

  let cache: ScanCache | null = null;
  try {
    const raw = await opts.store?.get(key);
    if (raw) cache = JSON.parse(raw) as ScanCache;
  } catch {
    cache = null;
  }
  if (cache && (cache.v !== 1 || BigInt(cache.hi) > head)) cache = null; // an older fork: start over
  const pools = new Map<string, CompactPool>((cache?.pools ?? []).map((p) => [p[0].toLowerCase(), p]));
  let lo = cache ? BigInt(cache.lo) : head + 1n; // scanned range [lo, hi]; empty while lo > hi
  let hi = cache ? BigInt(cache.hi) : head;

  const progress = (): V4ScanProgress => {
    const total = head >= fromBlock ? head - fromBlock + 1n : 1n;
    const covered = hi >= lo ? hi - (lo > fromBlock ? lo : fromBlock) + 1n : 0n;
    const done = lo <= fromBlock && hi >= head;
    return {
      fromBlock,
      head,
      scannedFrom: lo,
      scannedTo: hi,
      pools: pools.size,
      fraction: done ? 1 : Number((covered * 10_000n) / total) / 10_000,
      done,
    };
  };

  const fetchRange = async (from: bigint, to: bigint) => {
    try {
      return await pc.getLogs({ address: pm, event: poolManagerAbi[0], fromBlock: from, toBlock: to });
    } catch {
      return null;
    }
  };
  const add = (logs: NonNullable<Awaited<ReturnType<typeof fetchRange>>>) => {
    for (const l of logs) {
      const a = l.args;
      if (!a.id || !a.currency0 || !a.currency1 || a.fee === undefined || a.tickSpacing === undefined || !a.hooks) continue;
      pools.set(a.id.toLowerCase(), [a.id, getAddress(a.currency0), getAddress(a.currency1), a.fee, a.tickSpacing, getAddress(a.hooks), String(l.blockNumber ?? 0n)]);
    }
  };
  const save = async () => {
    try {
      await opts.store?.set(key, JSON.stringify({ v: 1, lo: lo.toString(), hi: hi.toString(), pools: [...pools.values()] } satisfies ScanCache));
    } catch {
      /* storage unavailable or full: the scan restarts next time */
    }
  };

  // 1) forward: catch up from hi+1 to head
  const forward: Array<[bigint, bigint]> = [];
  for (let f = hi + 1n; f <= head && forward.length < budget; f += chunk) forward.push([f, f + chunk - 1n > head ? head : f + chunk - 1n]);
  budget -= forward.length;
  let failed = false;
  for (let i = 0; i < forward.length && !failed; i += concurrency) {
    const batch = forward.slice(i, i + concurrency);
    const res = await runLimited(batch, concurrency, ([a, b]) => fetchRange(a, b));
    for (let j = 0; j < res.length; j++) {
      const logs = res[j];
      if (!logs) {
        failed = true;
        break;
      }
      add(logs);
      hi = batch[j]![1];
      if (lo > hi) lo = batch[0]![0]; // first ever chunk: the range starts here
    }
    opts.onProgress?.(progress());
  }
  if (lo > hi) lo = hi + 1n;

  // 2) backward: walk from lo-1 down to fromBlock, newest first
  if (!failed) {
    const back: Array<[bigint, bigint]> = [];
    for (let t = lo - 1n; t >= fromBlock && back.length < budget; t -= chunk) back.push([t - chunk + 1n < fromBlock ? fromBlock : t - chunk + 1n, t]);
    for (let i = 0; i < back.length && !failed; i += concurrency) {
      const batch = back.slice(i, i + concurrency);
      const res = await runLimited(batch, concurrency, ([a, b]) => fetchRange(a, b));
      for (let j = 0; j < res.length; j++) {
        const logs = res[j];
        if (!logs) {
          failed = true;
          break;
        }
        add(logs);
        lo = batch[j]![0];
      }
      if ((i / concurrency) % 5 === 4) await save();
      opts.onProgress?.(progress());
    }
  }
  await save();

  return {
    pools: [...pools.values()].map((p) => ({
      id: p[0],
      key: { currency0: p[1], currency1: p[2], fee: p[3], tickSpacing: p[4], hooks: p[5] },
      block: BigInt(p[6]),
    })),
    progress: progress(),
  };
}

export interface V4Evaluation {
  token: Address;
  /** deepest valid pool (reason 0), or the registered pool (reason 8) */
  key: PoolKey;
  poolId?: Hex;
  quote: Address;
  reason: number;
  depthWei: bigint;
  /** a pool for this token is already registered with the adapter */
  registered: boolean;
}

// check() results change slowly; re-check each pool at most every few minutes (per adapter)
const checkCache = new Map<string, { at: number; reason: number; depth: bigint }>();
const CHECK_TTL_MS = 5 * 60_000;

/**
 * Candidate (token, pool) pairs → `V4RouteAdapter.check` via multicall → the deepest valid pool per token.
 * Pools are pre-filtered locally: the other side must be native ETH or an allowlisted quote currency, and the
 * hook must be zero or allowlisted.
 */
export async function evaluateV4Pools(
  pc: FlipperPublicClient,
  opts: {
    adapter: Address;
    pools: readonly V4Pool[];
    flipper?: Address;
    multicallAddress?: Address;
    batchSize?: number;
    /** check() calls per multicall; groups run one after another (gentle on rate-limited RPCs) */
    groupSize?: number;
    /** extra tokens never to offer (quote currencies and known stables are always excluded) */
    exclude?: readonly Address[];
    /**
     * Ranked index mode: every pool carries its `token`; check the chosen pool first and, only if it fails, its
     * `alternatives` in depth order (instead of checking every pool and keeping the deepest).
     */
    ranked?: boolean;
    /** ranked mode: how many pools per token to try at most (chosen + alternatives) */
    maxTries?: number;
  },
): Promise<{ eligible: V4Evaluation[]; rejected: Map<string, number> }> {
  const { adapter, pools } = opts;
  const chainId = pc.chain?.id ?? (await pc.getChainId());
  if (opts.ranked) return evaluateRanked(pc, { ...opts, chainId });
  const multicallAddress = opts.multicallAddress ?? pc.chain?.contracts?.multicall3?.address ?? MULTICALL3;
  const a = { address: adapter, abi: v4RouteAdapterAbi } as const;
  const quotes = await pc.readContract({ ...a, functionName: "quoteCurrencies" });
  const quoteSet = new Set([zeroAddress, ...quotes].map((q) => q.toLowerCase()));
  // quote currencies / stables / WETH are pricing assets, not something to flip
  const excluded = new Set([...quoteSet, ...(QUOTES_AND_STABLES[chainId] ?? []), ...(opts.exclude ?? [])].map((a) => a.toLowerCase()));

  const hooks = [...new Set(pools.map((p) => p.key.hooks.toLowerCase()).filter((h) => h !== zeroAddress))] as Address[];
  const allowed = new Set<string>([zeroAddress]);
  if (hooks.length) {
    const res = await pc.multicall({
      contracts: hooks.map((h) => ({ ...a, functionName: "isHookAllowed" as const, args: [h] as const })),
      allowFailure: true,
      multicallAddress,
      batchSize: 32_768,
    });
    res.forEach((r, i) => r.status === "success" && r.result && allowed.add(hooks[i]!));
  }

  const candidates: Array<{ token: Address; key: PoolKey; id: Hex; quote: Address }> = [];
  for (const p of pools) {
    if (!allowed.has(p.key.hooks.toLowerCase())) continue;
    for (const [tok, other] of [
      [p.key.currency0, p.key.currency1],
      [p.key.currency1, p.key.currency0],
    ] as const) {
      if (p.token && !isAddressEqual(p.token, tok)) continue;
      if (tok === zeroAddress || !quoteSet.has(other.toLowerCase()) || excluded.has(tok.toLowerCase())) continue;
      if (opts.flipper && isAddressEqual(tok, opts.flipper)) continue;
      candidates.push({ token: tok, key: p.key, id: p.id, quote: other });
    }
  }

  const now = Date.now();
  const cacheKey = (c: { token: Address; id: Hex }) => `${adapter.toLowerCase()}:${c.id.toLowerCase()}:${c.token.toLowerCase()}`;
  const stale = candidates.filter((c) => {
    const hit = checkCache.get(cacheKey(c));
    return !hit || now - hit.at > CHECK_TTL_MS;
  });
  const group = opts.groupSize ?? 400;
  for (let g = 0; g < stale.length; g += group) {
    const slice = stale.slice(g, g + group);
    const res = await pc.multicall({
      contracts: slice.map((c) => ({ ...a, functionName: "check" as const, args: [c.token, c.key] as const })),
      allowFailure: true,
      multicallAddress,
      batchSize: opts.batchSize ?? 131_072, // one eth_call per group (~400 checks)
    });
    res.forEach((r, i) => {
      const c = slice[i]!;
      if (r.status === "success") checkCache.set(cacheKey(c), { at: now, reason: Number(r.result[0]), depth: r.result[1] });
    });
  }

  const best = new Map<string, V4Evaluation>();
  const rejected = new Map<string, number>();
  for (const c of candidates) {
    const hit = checkCache.get(cacheKey(c));
    if (!hit) continue;
    const k = c.token.toLowerCase();
    if (hit.reason === 0) {
      const cur = best.get(k);
      if (!cur || !cur.registered && hit.depth > cur.depthWei) {
        best.set(k, { token: c.token, key: c.key, poolId: c.id, quote: c.quote, reason: 0, depthWei: hit.depth, registered: false });
      }
    } else if (hit.reason === 8) {
      const cur = best.get(k);
      if (!cur || !cur.registered) best.set(k, { token: c.token, key: c.key, quote: c.quote, reason: 8, depthWei: cur?.depthWei ?? hit.depth, registered: true });
    } else if (!rejected.has(k) || hit.reason > (rejected.get(k) ?? 0)) {
      rejected.set(k, hit.reason); // the highest code is the most specific ("no liquidity" beats "unsupported quote")
    }
  }

  // Tokens with a registered pool: list with the registered key.
  const registered = [...best.values()].filter((e) => e.registered);
  if (registered.length) {
    const res = await pc.multicall({
      contracts: registered.map((e) => ({ ...a, functionName: "poolOf" as const, args: [e.token] as const })),
      allowFailure: true,
      multicallAddress,
      batchSize: 32_768,
    });
    res.forEach((r, i) => {
      if (r.status === "success") registered[i]!.key = r.result as PoolKey;
    });
  }
  for (const k of best.keys()) rejected.delete(k);
  return { eligible: [...best.values()], rejected };
}

const metaCache = new Map<string, { name: string; symbol: string; decimals: number }>();

/** ERC-20 metadata for many tokens via multicall (cached per address). */
export async function readTokenMeta(
  pc: FlipperPublicClient,
  tokens: readonly Address[],
  multicallAddress?: Address,
): Promise<Map<string, { name: string; symbol: string; decimals: number }>> {
  const todo = [...new Set(tokens.map((t) => t.toLowerCase()))].filter((t) => !metaCache.has(t)) as Address[];
  if (todo.length) {
    const res = await pc.multicall({
      contracts: todo.flatMap((t) => [
        { address: t, abi: erc20Abi, functionName: "name" as const },
        { address: t, abi: erc20Abi, functionName: "symbol" as const },
        { address: t, abi: erc20Abi, functionName: "decimals" as const },
      ]),
      allowFailure: true,
      multicallAddress: multicallAddress ?? pc.chain?.contracts?.multicall3?.address ?? MULTICALL3,
      batchSize: 32_768,
    });
    todo.forEach((t, i) => {
      const [n, s, d] = [res[i * 3], res[i * 3 + 1], res[i * 3 + 2]];
      metaCache.set(t, {
        name: n?.status === "success" ? String(n.result) : "",
        symbol: s?.status === "success" ? String(s.result) : "",
        decimals: d?.status === "success" ? Number(d.result) : 18,
      });
    });
  }
  return new Map(tokens.map((t) => [t.toLowerCase(), metaCache.get(t.toLowerCase())!]));
}

export interface V4DiscoveryOptions extends V4ScanOptions {
  /** V4RouteAdapter address (required) */
  adapter: Address;
  flipper?: Address;
  multicallAddress?: Address;
  /** use these pools (a server / keeper index) instead of scanning; pair with `indexProgress` */
  pools?: readonly V4Pool[];
  indexProgress?: V4ScanProgress;
  /** the pools come from a ranked index (chosen pool first, then `alternatives`) */
  ranked?: boolean;
  groupSize?: number;
}

/** Unvetted Uniswap v4 tokens the V4RouteAdapter could list (deepest valid pool per token), plus scan progress. */
export async function discoverV4Tokens(
  pc: FlipperPublicClient,
  opts: V4DiscoveryOptions,
): Promise<{ tokens: DiscoveredToken[]; progress: V4ScanProgress; rejected: Map<string, number> }> {
  const { pools, progress } = opts.pools
    ? { pools: opts.pools, progress: opts.indexProgress ?? completeProgress(opts.pools.length) }
    : await scanV4Pools(pc, opts);
  const chainId = pc.chain?.id ?? (await pc.getChainId());
  const memeHook = PONS[chainId]?.memeHook;
  const { eligible, rejected } = await evaluateV4Pools(pc, {
    adapter: opts.adapter,
    pools,
    flipper: opts.flipper,
    multicallAddress: opts.multicallAddress,
    groupSize: opts.groupSize,
    ranked: opts.ranked,
  });
  const meta = await readTokenMeta(pc, eligible.map((e) => e.token), opts.multicallAddress);
  const tokens: DiscoveredToken[] = eligible
    .map((e) => {
      const m = meta.get(e.token.toLowerCase());
      return {
        address: e.token,
        name: m?.name ?? "",
        symbol: m?.symbol || "???",
        decimals: m?.decimals ?? 18,
        status: "eligible" as const,
        // pons v2 graduations trade in (ETH, token, fee 0, ts 200, meme hook) pools
        kind: memeHook && isAddressEqual(e.key.hooks, memeHook) ? ("pons" as const) : ("v4" as const),
        listVia: "v4" as const,
        isFlipper: false,
        v4: { key: e.key, poolId: e.poolId, quote: e.quote, depthWei: e.depthWei, registered: e.registered },
        sources: ["v4" as const],
      };
    })
    .filter((t) => t.symbol !== "???" || t.name !== "") // no metadata at all: almost certainly not an ERC-20
    .sort((x, y) => (y.v4.depthWei > x.v4.depthWei ? 1 : y.v4.depthWei < x.v4.depthWei ? -1 : 0));
  return { tokens, progress, rejected };
}

function completeProgress(pools: number): V4ScanProgress {
  return { fromBlock: 0n, head: 0n, scannedFrom: 0n, scannedTo: 0n, pools, fraction: 1, done: true };
}

interface IndexEntry {
  token?: string;
  key?: Record<string, unknown>;
  poolId?: string;
  id?: string;
  block?: string | number;
  depthWei?: string | number | null;
  depthUpdatedAt?: string | number | null;
  others?: IndexEntry[];
}

/**
 * Parse one page of a server pool index (`GET {keeper}/tokens/v4`; entries may carry `depthWei` and `others`):
 * `{ scannedFrom, scannedTo, head, complete, pools: [{ token, key, poolId, block }] }`.
 */
export function parseV4PoolIndex(body: unknown): { pools: V4Pool[]; progress: V4ScanProgress } {
  const b = body as {
    scannedFrom?: string | number;
    scannedTo?: string | number;
    head?: string | number;
    complete?: boolean;
    pools?: Array<IndexEntry>;
  };
  if (!b || !Array.isArray(b.pools)) throw new Error("unexpected pool index response");
  const big = (v: unknown) => {
    try {
      return BigInt((v as string | number | undefined) ?? 0);
    } catch {
      return 0n;
    }
  };
  const toPool = (p: IndexEntry, token?: Address): V4Pool => {
    const k = p.key ?? {};
    return {
      id: (p.poolId ?? p.id ?? "0x") as Hex,
      key: {
        currency0: getAddress(String(k.currency0)),
        currency1: getAddress(String(k.currency1)),
        fee: Number(k.fee),
        tickSpacing: Number(k.tickSpacing),
        hooks: getAddress(String(k.hooks ?? zeroAddress)),
      },
      block: big(p.block),
      token,
      depthWei: p.depthWei === undefined || p.depthWei === null ? undefined : big(p.depthWei),
    };
  };
  const pools: V4Pool[] = [];
  for (const p of b.pools) {
    try {
      const token = p.token ? getAddress(p.token) : undefined;
      const pool = toPool(p, token);
      const alts: V4Pool[] = [];
      for (const o of p.others ?? []) {
        try {
          alts.push(toPool(o, token));
        } catch {
          /* skip a malformed alternative */
        }
      }
      if (alts.length) pool.alternatives = alts;
      pools.push(pool);
    } catch {
      /* skip malformed entries */
    }
  }
  const head = big(b.head);
  const from = big(b.scannedFrom);
  const to = big(b.scannedTo);
  const done = b.complete === true;
  const span = head > from ? head - from : 0n;
  return {
    pools,
    progress: {
      fromBlock: from,
      head,
      scannedFrom: from,
      scannedTo: to,
      pools: pools.length,
      fraction: done ? 1 : span > 0n ? Number(((to - from) * 10_000n) / span) / 10_000 : 0,
      done,
    },
  };
}

/** JSON-safe form of discovered tokens (bigints → decimal strings) for server routes. */
export function encodeDiscovered(tokens: readonly DiscoveredToken[]): unknown[] {
  return JSON.parse(JSON.stringify(tokens, (_k, v) => (typeof v === "bigint" ? { $big: v.toString() } : v)));
}

/** Inverse of `encodeDiscovered`. */
export function decodeDiscovered(json: unknown): DiscoveredToken[] {
  return JSON.parse(JSON.stringify(json), (_k, v) =>
    v && typeof v === "object" && typeof (v as { $big?: unknown }).$big === "string" ? BigInt((v as { $big: string }).$big) : v,
  ) as DiscoveredToken[];
}

/** JSON-safe scan progress. */
export const encodeProgress = (p: V4ScanProgress) => JSON.parse(JSON.stringify(p, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
export const decodeProgress = (j: Record<string, unknown>): V4ScanProgress => ({
  fromBlock: BigInt(String(j.fromBlock ?? 0)),
  head: BigInt(String(j.head ?? 0)),
  scannedFrom: BigInt(String(j.scannedFrom ?? 0)),
  scannedTo: BigInt(String(j.scannedTo ?? 0)),
  pools: Number(j.pools ?? 0),
  fraction: Number(j.fraction ?? 0),
  done: j.done === true,
});

/** Ranked index: chosen pool first, then alternatives in depth order, one multicall round per "try". */
async function evaluateRanked(
  pc: FlipperPublicClient,
  opts: {
    adapter: Address;
    pools: readonly V4Pool[];
    chainId: number;
    flipper?: Address;
    multicallAddress?: Address;
    batchSize?: number;
    groupSize?: number;
    exclude?: readonly Address[];
    maxTries?: number;
  },
): Promise<{ eligible: V4Evaluation[]; rejected: Map<string, number> }> {
  const { adapter } = opts;
  const multicallAddress = opts.multicallAddress ?? pc.chain?.contracts?.multicall3?.address ?? MULTICALL3;
  const a = { address: adapter, abi: v4RouteAdapterAbi } as const;
  const quotes = await pc.readContract({ ...a, functionName: "quoteCurrencies" });
  const quoteSet = new Set([zeroAddress, ...quotes].map((q) => q.toLowerCase()));
  const excluded = new Set([...quoteSet, ...(QUOTES_AND_STABLES[opts.chainId] ?? []), ...(opts.exclude ?? [])].map((x) => x.toLowerCase()));

  // per token: [chosen, ...alternatives by depth desc], dropping pools that can't pass (wrong pairing)
  const queue = new Map<string, { token: Address; tries: V4Pool[] }>();
  for (const p of opts.pools) {
    if (!p.token) continue;
    const t = p.token.toLowerCase();
    if (excluded.has(t) || (opts.flipper && isAddressEqual(p.token, opts.flipper)) || queue.has(t)) continue;
    const alts = [...(p.alternatives ?? [])].sort((x, y) => ((y.depthWei ?? 0n) > (x.depthWei ?? 0n) ? 1 : (y.depthWei ?? 0n) < (x.depthWei ?? 0n) ? -1 : 0));
    const tries = [p, ...alts].filter((q) => {
      const other = isAddressEqual(q.key.currency0, p.token!) ? q.key.currency1 : isAddressEqual(q.key.currency1, p.token!) ? q.key.currency0 : undefined;
      return other !== undefined && quoteSet.has(other.toLowerCase());
    });
    if (tries.length) queue.set(t, { token: p.token, tries: tries.slice(0, opts.maxTries ?? 4) });
  }

  const best = new Map<string, V4Evaluation>();
  const rejected = new Map<string, number>();
  const group = opts.groupSize ?? 400;
  for (let round = 0; ; round++) {
    const batch = [...queue.values()].filter((q) => !best.has(q.token.toLowerCase()) && q.tries[round]);
    if (batch.length === 0) break;
    const now = Date.now();
    const key = (tok: Address, pool: V4Pool) => `${adapter.toLowerCase()}:${pool.id.toLowerCase()}:${tok.toLowerCase()}`;
    const stale = batch.filter((q) => {
      const hit = checkCache.get(key(q.token, q.tries[round]!));
      return !hit || now - hit.at > CHECK_TTL_MS;
    });
    for (let g = 0; g < stale.length; g += group) {
      const slice = stale.slice(g, g + group);
      const res = await pc.multicall({
        contracts: slice.map((q) => ({ ...a, functionName: "check" as const, args: [q.token, q.tries[round]!.key] as const })),
        allowFailure: true,
        multicallAddress,
        batchSize: opts.batchSize ?? 131_072,
      });
      res.forEach((r, i) => {
        const q = slice[i]!;
        if (r.status === "success") checkCache.set(key(q.token, q.tries[round]!), { at: now, reason: Number(r.result[0]), depth: r.result[1] });
      });
    }
    for (const q of batch) {
      const pool = q.tries[round]!;
      const hit = checkCache.get(key(q.token, pool));
      const t = q.token.toLowerCase();
      if (!hit) continue;
      const quote = isAddressEqual(pool.key.currency0, q.token) ? pool.key.currency1 : pool.key.currency0;
      if (hit.reason === 0 || hit.reason === 8) {
        best.set(t, { token: q.token, key: pool.key, poolId: pool.id, quote, reason: hit.reason, depthWei: hit.depth, registered: hit.reason === 8 });
        rejected.delete(t);
      } else rejected.set(t, hit.reason);
    }
  }

  // tokens whose pool is registered already: list with the registered key
  const registered = [...best.values()].filter((e) => e.registered);
  if (registered.length) {
    const res = await pc.multicall({
      contracts: registered.map((e) => ({ ...a, functionName: "poolOf" as const, args: [e.token] as const })),
      allowFailure: true,
      multicallAddress,
      batchSize: 131_072,
    });
    res.forEach((r, i) => {
      if (r.status === "success") registered[i]!.key = r.result as PoolKey;
    });
  }
  return { eligible: [...best.values()], rejected };
}

export interface V4IndexFetchOptions {
  /** index endpoint, e.g. `${KEEPER_API_URL}/tokens/v4` */
  url: string;
  /** keep pools at least this deep (ETH wei); sent as `minDepthWei` with `order=depth` */
  minDepthWei?: bigint;
  /** stop after this many tokens */
  cap?: number;
  /** page size (the keeper defaults to 5,000, max 20,000) */
  limit?: number;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Pages through a (possibly depth-ranked) pool index. Ranked when entries carry `depthWei`: then it asks for
 * `order=depth&minDepthWei=…` and follows `next` up to `cap` tokens. An index without depth is unranked: only the
 * first page (`cap` entries) is taken.
 */
export async function fetchV4PoolIndex(
  opts: V4IndexFetchOptions,
): Promise<{ pools: V4Pool[]; progress: V4ScanProgress; ranked: boolean; total?: number }> {
  const f = opts.fetch ?? fetch;
  const cap = opts.cap ?? 2_000;
  const limit = Math.min(opts.limit ?? Math.min(cap, 5_000), 20_000);
  const get = async (u: string) => {
    const res = await f(u, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) } as RequestInit);
    if (!res.ok) throw new Error(`pool index responded ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const withParams = (offset?: string | number) => {
    const u = new URL(opts.url);
    u.searchParams.set("order", "depth");
    u.searchParams.set("minDepthWei", String(opts.minDepthWei ?? 500_000_000_000_000_000n));
    u.searchParams.set("limit", String(limit));
    if (offset !== undefined) u.searchParams.set("offset", String(offset));
    return u.toString();
  };
  let body = await get(withParams());
  let page = parseV4PoolIndex(body);
  const ranked = page.pools.some((p) => p.depthWei !== undefined);
  const pools: V4Pool[] = [...page.pools];
  const total = typeof body.total === "number" ? body.total : undefined;
  // unranked (no depth yet): everything is equal, take just the first page
  while (ranked && pools.length < cap) {
    const next = body.next;
    if (next === null || next === undefined || next === false || next === "") break;
    const url = typeof next === "string" && /^(https?:)?\//.test(next) ? new URL(next, opts.url).toString() : withParams(next as string | number);
    body = await get(url);
    page = parseV4PoolIndex(body);
    if (page.pools.length === 0) break;
    pools.push(...page.pools);
  }
  return { pools: pools.slice(0, cap), progress: { ...page.progress, pools: Math.min(pools.length, cap) }, ranked, total };
}
