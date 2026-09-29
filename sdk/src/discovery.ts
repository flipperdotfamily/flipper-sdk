import { formatUnits, getAddress, isAddress, isAddressEqual, zeroAddress, type Address } from "viem";
import { hookitLaunchFactoryAbi } from "./abis/slim";
import type { FlipperClient, FlipperPublicClient } from "./client";
import { HOOKIT, HOOKIT_QUOTE_SYMBOLS } from "./constants";
import type { DiscoveredToken, DiscoveryResult, KeyValueStore, TokenMarket } from "./types";

/** One entry of `GET {indexer}/v1/tokens` (fields used by the SDK; the indexer returns more). */
export interface IndexerToken {
  address: string;
  poolId?: string | null;
  quote?: string | null;
  tokenIsCurrency0?: boolean;
  name?: string;
  symbol?: string;
  decimals?: number;
  quoteDecimals?: number;
  totalSupply?: string | number | null;
  creator?: string;
  launchedAt?: number;
  launchId?: number;
  rail?: "master" | "classic" | string;
  bondingPhase?: number | null;
  realQuote?: string | number | null;
  graduationQuote?: string | number | null;
  graduatedAt?: number | null;
  marketCount?: number;
  price?: string | number | null;
  volume24h?: string | number | null;
  change24h?: number | null;
}

export interface IndexerOptions {
  /** @internal */
  url?: string;
  /** @internal */
  tokensUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export interface ChainScanOptions {
  /** @internal */
  factories?: ReadonlyArray<{ address: Address; fromBlock: bigint }>;
  /** ≤ 10k: many public RPCs reject larger eth_getLogs ranges */
  chunkSize?: bigint;
  /** cap on chunks per call; the scan resumes from `store` next time */
  maxChunks?: number;
  concurrency?: number;
  /** persists progress (e.g. localStorage) so later scans only fetch new blocks */
  store?: KeyValueStore;
}

export interface DiscoverOptions {
  /** @internal */
  indexer?: IndexerOptions | false;
  /** onchain fallback when the indexer is unavailable; only runs with explicit `factories` */
  chainScan?: ChainScanOptions | false;
  /** dry-run `listToken` for each eligible token to flag thin liquidity (slow: simulates hook swaps) */
  probeListing?: boolean;
  /** keep ineligible tokens in the result (default true) */
  includeIneligible?: boolean;
  /** @internal */
  hidden?: string[];
}

export interface HookitLaunch {
  token: Address;
  launchId: bigint;
  creator: Address;
  factory: Address;
  poolId: string;
  blockNumber: bigint;
}

const big = (v: string | number | null | undefined): bigint | null => {
  if (v === null || v === undefined || v === "") return null;
  try {
    return typeof v === "number" ? BigInt(Math.trunc(v)) : BigInt(v);
  } catch {
    return null;
  }
};

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** @internal */
export async function fetchIndexerTokens(opts: IndexerOptions = {}): Promise<IndexerToken[]> {
  const url = opts.tokensUrl ?? `${(opts.url ?? HOOKIT.indexerUrl).replace(/\/$/, "")}/v1/tokens`;
  const f = opts.fetch ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8_000);
  try {
    const res = await f(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`indexer responded ${res.status}`);
    const body = (await res.json()) as { tokens?: IndexerToken[] } | IndexerToken[];
    const list = Array.isArray(body) ? body : body.tokens;
    if (!Array.isArray(list)) throw new Error("unexpected indexer response");
    return list.filter((t) => typeof t?.address === "string" && isAddress(t.address, { strict: false }));
  } finally {
    clearTimeout(timer);
  }
}

/** Market stats (in quote units) derived from an indexer entry. */
export function marketFromIndexer(t: IndexerToken): TokenMarket {
  const quote = (t.quote && isAddress(t.quote, { strict: false }) ? getAddress(t.quote) : zeroAddress) as Address;
  const qd = t.quoteDecimals ?? 18;
  const price = num(t.price);
  const supplyWei = big(t.totalSupply);
  const supply = supplyWei !== null ? Number(formatUnits(supplyWei, t.decimals ?? 18)) : null;
  const realQuote = big(t.realQuote);
  const vol = big(t.volume24h);
  return {
    quote,
    quoteSymbol: HOOKIT_QUOTE_SYMBOLS[quote.toLowerCase()] ?? "quote",
    quoteDecimals: qd,
    price,
    marketCap: price !== null && supply !== null ? price * supply : null,
    liquidity: realQuote !== null ? Number(formatUnits(realQuote, qd)) : null,
    volume24h: vol !== null ? Number(formatUnits(vol, qd)) : null,
    change24h: typeof t.change24h === "number" && Number.isFinite(t.change24h) ? t.change24h : null,
  };
}

/** Why an indexer entry can't be routed (null = worth asking the adapter). */
function preclassify(t: IndexerToken): string | null {
  if (t.rail === "classic") {
    return t.graduatedAt ? "Graduated bonding-curve launch (not supported yet)" : "Still on the bonding curve";
  }
  const quote = (t.quote ?? zeroAddress).toLowerCase();
  if (quote !== zeroAddress) return `Quoted in ${HOOKIT_QUOTE_SYMBOLS[quote] ?? "an ERC-20"}, not ETH`;
  if ((t.marketCount ?? 1) > 1) return "Multi-market launch (not supported)";
  return null;
}

async function runLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

interface ScanCache {
  scannedTo: string;
  launches: Array<{ token: string; launchId: string; creator: string; factory: string; poolId: string; blockNumber: string }>;
}

/** @internal */
export async function scanHookitLaunches(
  pc: FlipperPublicClient,
  opts: ChainScanOptions = {},
): Promise<{ launches: HookitLaunch[]; partial: boolean; scannedTo: bigint }> {
  const factories = opts.factories ?? [];
  const chunk = opts.chunkSize && opts.chunkSize > 0n && opts.chunkSize <= HOOKIT.maxLogRange ? opts.chunkSize : HOOKIT.maxLogRange;
  const maxChunks = opts.maxChunks ?? 300;
  const concurrency = opts.concurrency ?? 4;
  const chainId = pc.chain?.id ?? (await pc.getChainId());
  const latest = await pc.getBlockNumber();
  const launches: HookitLaunch[] = [];
  let partial = false;
  let budget = maxChunks;

  for (const factory of factories) {
    const key = `flipper:hookit-launches:${chainId}:${factory.address.toLowerCase()}`;
    let cache: ScanCache | null = null;
    try {
      const raw = await opts.store?.get(key);
      if (raw) cache = JSON.parse(raw) as ScanCache;
    } catch {
      cache = null;
    }
    // A cache from a chain that is ahead of this one (e.g. an older fork) is ignored.
    if (cache && BigInt(cache.scannedTo) > latest) cache = null;
    const found: HookitLaunch[] = (cache?.launches ?? []).map((l) => ({
      token: getAddress(l.token),
      launchId: BigInt(l.launchId),
      creator: getAddress(l.creator),
      factory: getAddress(l.factory),
      poolId: l.poolId,
      blockNumber: BigInt(l.blockNumber),
    }));
    let scannedTo = cache ? BigInt(cache.scannedTo) : factory.fromBlock - 1n;

    const ranges: Array<[bigint, bigint]> = [];
    for (let from = scannedTo + 1n; from <= latest; from += chunk) {
      ranges.push([from, from + chunk - 1n > latest ? latest : from + chunk - 1n]);
    }
    if (ranges.length > budget) {
      partial = true;
      ranges.length = budget;
    }
    budget -= ranges.length;

    // Process in batches so `scannedTo` only ever advances over a contiguous, fully-fetched prefix.
    for (let i = 0; i < ranges.length; i += concurrency) {
      const batch = ranges.slice(i, i + concurrency);
      const results = await runLimited(batch, concurrency, async ([fromBlock, toBlock]) => {
        try {
          return await pc.getLogs({ address: factory.address, event: hookitLaunchFactoryAbi[0], fromBlock, toBlock });
        } catch {
          return null;
        }
      });
      for (const logs of results) {
        if (!logs) break;
        for (const log of logs) {
          if (!log.args.token || log.args.launchId === undefined) continue;
          found.push({
            token: getAddress(log.args.token),
            launchId: log.args.launchId,
            creator: log.args.creator ?? zeroAddress,
            factory: factory.address,
            poolId: log.args.poolId ?? "0x",
            blockNumber: log.blockNumber ?? 0n,
          });
        }
      }
      const firstFailure = results.findIndex((r) => r === null);
      const done = firstFailure === -1 ? batch.length : firstFailure;
      if (done > 0) scannedTo = batch[done - 1]![1];
      if (firstFailure !== -1) {
        partial = true;
        break;
      }
    }

    // de-dupe (a range may be re-read after a partial batch)
    const uniq = new Map(found.map((l) => [l.token.toLowerCase(), l]));
    launches.push(...uniq.values());
    try {
      await opts.store?.set(
        key,
        JSON.stringify({
          scannedTo: scannedTo.toString(),
          launches: [...uniq.values()].map((l) => ({
            token: l.token,
            launchId: l.launchId.toString(),
            creator: l.creator,
            factory: l.factory,
            poolId: l.poolId,
            blockNumber: l.blockNumber.toString(),
          })),
        } satisfies ScanCache),
      );
    } catch {
      /* storage full / unavailable: next scan starts over */
    }
  }
  return { launches, partial, scannedTo: latest };
}

const statusRank: Record<DiscoveredToken["status"], number> = { listed: 0, eligible: 1, disabled: 2, ineligible: 3 };

/** $FLIPPER first, then listed → eligible (vetted launches before unvetted v4 tokens) → disabled → ineligible. */
export function sortTokens(tokens: DiscoveredToken[]): DiscoveredToken[] {
  return tokens.sort((a, b) => {
    if (a.isFlipper !== b.isFlipper) return a.isFlipper ? -1 : 1;
    const r = statusRank[a.status] - statusRank[b.status];
    if (r !== 0) return r;
    if (a.status === "eligible" && a.kind !== b.kind) return a.kind === "hookit" ? -1 : b.kind === "hookit" ? 1 : 0;
    const va = a.market?.volume24h ?? -1;
    const vb = b.market?.volume24h ?? -1;
    if (va !== vb) return vb - va;
    const da = a.v4?.depthWei ?? 0n;
    const db = b.v4?.depthWei ?? 0n;
    if (da !== db) return db > da ? 1 : -1;
    return a.symbol.localeCompare(b.symbol);
  });
}

/**
 * Merge the v4 scan into another discovery: new tokens are added; a token its own adapter can't route but that has a
 * valid v4 pool becomes listable via the v4 adapter; listed tokens keep their listing.
 */
export function mergeDiscoveries(
  base: DiscoveryResult | undefined,
  v4: readonly DiscoveredToken[] | undefined,
  opts: { hidden?: readonly string[] } = {},
): DiscoveryResult {
  const hidden = new Set((opts.hidden ?? []).map((a) => a.toLowerCase()));
  const tokens = (base?.tokens ?? []).map((t) => ({ ...t, sources: [...t.sources] }));
  const by = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));
  for (const v of v4 ?? []) {
    if (hidden.has(v.address.toLowerCase())) continue;
    const cur = by.get(v.address.toLowerCase());
    if (!cur) {
      const t = { ...v, sources: [...v.sources] };
      tokens.push(t);
      by.set(v.address.toLowerCase(), t);
      continue;
    }
    cur.v4 ??= v.v4;
    if (!cur.sources.includes("v4")) cur.sources.push("v4");
    if (cur.kind === "v4" && v.kind === "pons") cur.kind = "pons"; // listed via the v4 adapter on a pons pool
    if (cur.status === "ineligible") {
      cur.status = "eligible";
      cur.listVia = "v4";
      cur.reason = undefined;
    }
  }
  return { tokens: sortTokens(tokens), source: base?.source ?? "none", partial: base?.partial ?? false, errors: base?.errors ?? [] };
}

/** @internal */
export async function discoverHookitTokens(
  client: FlipperClient,
  pc: FlipperPublicClient,
  opts: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const errors: string[] = [];
  const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const hidden = new Set([...HOOKIT.hiddenTokens, ...(opts.hidden ?? [])].map((a) => a.toLowerCase()));
  const { hookitAdapter, v4Adapter } = client.addresses;
  const kindOfAdapter = (a: Address): DiscoveredToken["kind"] =>
    hookitAdapter && isAddressEqual(a, hookitAdapter) ? "hookit" : v4Adapter && isAddressEqual(a, v4Adapter) ? "v4" : "other";

  const [flipper, listed, indexed] = await Promise.all([
    client.flipper().catch((e) => {
      errors.push(`house: ${msg(e)}`);
      return undefined;
    }),
    client.listedTokens().catch((e) => {
      errors.push(`listed tokens: ${msg(e)}`);
      return [];
    }),
    !opts.indexer || (!opts.indexer.url && !opts.indexer.tokensUrl)
      ? Promise.resolve(null)
      : fetchIndexerTokens(opts.indexer).catch((e) => {
          errors.push(`indexer: ${msg(e)}`);
          return null;
        }),
  ]);

  let source: DiscoveryResult["source"] = "none";
  let partial = false;
  const byAddr = new Map<string, DiscoveredToken>();

  if (flipper) {
    const meta = await client.tokenMeta(flipper).catch(() => ({ name: "flipper", symbol: "FLIPPER", decimals: 18 }));
    byAddr.set(flipper.toLowerCase(), { address: flipper, ...meta, status: "listed", kind: "flipper", isFlipper: true, sources: ["flipper"] });
  }

  for (const tv of listed) {
    const k = tv.token.toLowerCase();
    if (byAddr.has(k)) continue;
    byAddr.set(k, {
      address: tv.token,
      name: tv.name,
      symbol: tv.symbol || "???",
      decimals: tv.decimals,
      status: tv.enabled ? "listed" : "disabled",
      reason: tv.enabled ? undefined : "Disabled by the house",
      kind: kindOfAdapter(tv.adapter),
      isFlipper: false,
      listing: { enabled: tv.enabled, blocked: tv.blocked, adapter: tv.adapter, hops: Number(tv.hops) },
      sources: ["house"],
    });
  }

  const toCheck: DiscoveredToken[] = [];
  const needMeta: DiscoveredToken[] = [];

  if (indexed) {
    source = "indexer";
    for (const t of indexed) {
      const address = getAddress(t.address);
      const k = address.toLowerCase();
      if (hidden.has(k)) continue;
      const market = marketFromIndexer(t);
      const hookit = {
        launchId: t.launchId,
        rail: t.rail,
        poolId: t.poolId ?? undefined,
        creator: t.creator && isAddress(t.creator, { strict: false }) ? getAddress(t.creator) : undefined,
        launchedAt: t.launchedAt,
        marketCount: t.marketCount,
      };
      const existing = byAddr.get(k);
      if (existing) {
        existing.market ??= market;
        existing.hookit ??= hookit;
        existing.sources.push("indexer");
        continue;
      }
      const reason = preclassify(t);
      const tok: DiscoveredToken = {
        address,
        name: t.name ?? "",
        symbol: t.symbol ?? "???",
        decimals: t.decimals ?? 18,
        status: reason ? "ineligible" : "eligible",
        reason: reason ?? undefined,
        kind: "hookit",
        listVia: reason ? undefined : "hookit",
        isFlipper: false,
        hookit,
        market,
        sources: ["indexer"],
      };
      byAddr.set(k, tok);
      if (!reason) toCheck.push(tok);
    }
  } else if (opts.chainScan && opts.chainScan.factories?.length) {
    try {
      const scan = await scanHookitLaunches(pc, opts.chainScan);
      source = "chain";
      partial = scan.partial;
      for (const l of scan.launches) {
        const k = l.token.toLowerCase();
        if (hidden.has(k)) continue;
        const hookit = { launchId: Number(l.launchId), rail: "master", poolId: l.poolId, creator: l.creator, factory: l.factory };
        const existing = byAddr.get(k);
        if (existing) {
          existing.hookit ??= hookit;
          existing.sources.push("chain");
          continue;
        }
        const tok: DiscoveredToken = {
          address: l.token,
          name: "",
          symbol: "",
          decimals: 18,
          status: "eligible",
          kind: "hookit",
          listVia: "hookit",
          isFlipper: false,
          hookit,
          sources: ["chain"],
        };
        byAddr.set(k, tok);
        toCheck.push(tok);
        needMeta.push(tok);
      }
    } catch (e) {
      errors.push(`chain scan: ${msg(e)}`);
    }
  }

  await Promise.all([
    runLimited(needMeta, 8, async (t) => {
      // a transport failure (tokenMeta already retried) leaves this token's metadata for the next scan
      const m = await client.tokenMeta(t.address).catch((e) => {
        errors.push(`metadata ${t.address}: ${msg(e)}`);
        return undefined;
      });
      if (!m) return;
      t.name = m.name;
      t.symbol = m.symbol;
      t.decimals = m.decimals;
    }),
    (async () => {
      if (toCheck.length === 0) return;
      if (!client.addresses.hookitAdapter) {
        for (const t of toCheck) {
          t.status = "ineligible";
          t.reason = "Permissionless listing isn't configured";
          t.listVia = undefined;
        }
        return;
      }
      await runLimited(toCheck, 8, async (t) => {
        const ok = await client.isEligible(t.address).catch(() => null);
        if (ok === false) {
          t.status = "ineligible";
          t.reason = "Not routable by the hookit adapter";
          t.listVia = undefined;
        } else if (ok === null) {
          t.status = "ineligible";
          t.reason = "Couldn't check eligibility";
          t.listVia = undefined;
        }
      });
    })(),
  ]);

  if (opts.probeListing) {
    const eligible = [...byAddr.values()].filter((t) => t.status === "eligible");
    await runLimited(eligible, 3, async (t) => {
      const r = await client.canList(t.address);
      if (!r.ok) {
        t.status = "ineligible";
        t.reason = r.routeCostBps !== undefined ? "Liquidity too thin to list" : r.reason;
        t.listVia = undefined;
      }
    });
  }

  let tokens = [...byAddr.values()];
  if (opts.includeIneligible === false) tokens = tokens.filter((t) => t.status !== "ineligible");
  sortTokens(tokens);

  return { tokens, source, partial, errors };
}
