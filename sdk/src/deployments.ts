import { defineChain, getAddress, isAddress, isAddressEqual, type Address, type Chain } from "viem";
import { ink } from "viem/chains";
import { getFlipperAddresses } from "./addresses";
import { CHAIN_DEFAULTS, INK_CHAIN_ID, MULTICALL3, ROBINHOOD_CHAIN_ID } from "./constants";
import type { FlipperAddresses } from "./types";

/** Everything a client needs to talk to one flipper deployment. */
export interface FlipperDeployment {
  chainId: number;
  /** for a local fork (31337): the live chain it copies (e.g. 4663, Robinhood Chain) */
  liveChainId?: number;
  name: string;
  /** public JSON-RPC used for reads (and simulation); writes always go through the user's wallet */
  rpcUrl: string;
  /** flipper.family API (token index, logos); optional */
  apiUrl?: string;
  explorerUrl?: string;
  nativeSymbol?: string;
  blockTimeMs?: number;
  addresses: FlipperAddresses & { multicall3?: Address };
}

/** The `deployment.json` document served by flipper.family (`/embed/deployment.json`). */
export interface FlipperDeploymentManifest {
  v: 1;
  /** chain id used when the caller doesn't name one */
  default: number;
  deployments: Record<string, FlipperDeployment>;
}

/** The launch chain: Robinhood Chain. */
export const DEFAULT_CHAIN_ID = ROBINHOOD_CHAIN_ID;
/** Live deployment manifest. Hosts that pin `addresses` never fetch it. */
export const DEFAULT_DEPLOYMENT_URL = "https://flipper.family/embed/deployment.json";
export const DEFAULT_API_URL = "https://api.flipper.family";
export const DEFAULT_EMBED_URL = "https://flipper.family/embed";
export const LOCAL_CHAIN_ID = 31337;

/** Public RPCs per chain id (reads only). */
export const PUBLIC_RPC_URLS: Record<number, string> = {
  [INK_CHAIN_ID]: "https://rpc-gel.inkonchain.com",
  [ROBINHOOD_CHAIN_ID]: "https://rpc.mainnet.chain.robinhood.com",
  [LOCAL_CHAIN_ID]: "http://127.0.0.1:8545",
};

/**
 * Canonical deployments, pinned in the SDK: `resolveDeployment` refuses a fetched manifest whose house or lens for a
 * pinned chain differs from these (a compromised web tier or manifest can't redirect integrators' approvals). Only
 * integrator code can opt out, with `allowUnpinnedDeployment: true`; never a URL param. Local forks (31337) are never
 * pinned.
 *
 * LAUNCH CHECKLIST: fill in the mainnet house and lens here the moment they're deployed, e.g.
 *   [ROBINHOOD_CHAIN_ID]: { house: "0x…", lens: "0x…" },
 * then release the SDK and rebuild the widget (its CDN build and the embed bundle the SDK).
 */
export const CANONICAL_DEPLOYMENTS: Record<number, { house: Address; lens: Address }> = {};

/**
 * `u` when it's a URL the SDK and widget may call or link to: `https:`, or `http:` on localhost / 127.0.0.1 / [::1]
 * only. Anything else (`javascript:`, `data:`, plain http elsewhere, garbage) → undefined.
 */
export function safeHttpUrl(u: unknown): string | undefined {
  if (typeof u !== "string" || u.length > 2_048) return undefined;
  try {
    const url = new URL(u);
    if (url.protocol === "https:") return u;
    if (url.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) return u;
  } catch {
    /* not a URL */
  }
  return undefined;
}

/** `chain=` aliases accepted by the embed and the widget's `chain-id` attribute. */
export const CHAIN_ALIASES: Record<string, number> = {
  ink: INK_CHAIN_ID,
  robinhood: ROBINHOOD_CHAIN_ID,
  "robinhood-chain": ROBINHOOD_CHAIN_ID,
  local: LOCAL_CHAIN_ID,
  anvil: LOCAL_CHAIN_ID,
  localhost: LOCAL_CHAIN_ID,
};

/** "4663", 4663, "0x1237", "robinhood" → 4663; undefined when unrecognised. */
export function parseChainId(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : undefined;
  const s = v.trim().toLowerCase();
  // own keys only: "__proto__" / "constructor" aren't aliases
  if (Object.prototype.hasOwnProperty.call(CHAIN_ALIASES, s)) return CHAIN_ALIASES[s];
  const n = s.startsWith("0x") ? Number.parseInt(s, 16) : Number(s);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const ADDRESS_KEYS = [
  "house",
  "lens",
  "rewards",
  "hookitAdapter",
  "v4Adapter",
  "v3Adapter",
  "v3Bridge",
  "weth",
  "poolManager",
  "flipper",
  "rewardToken",
  "router",
  "vault",
  "multicall3",
  "partnerRegistry",
  "houseModule",
  "ponsVerifier",
  "stockVerifier",
  "auctionConverter",
  "wethWrapperHook",
  "principalLock",
] as const;

/** Checksums every known address field and drops malformed ones. */
export function normalizeAddresses(raw: Record<string, unknown> | null | undefined): Partial<FlipperDeployment["addresses"]> {
  const out: Record<string, Address> = {};
  if (!raw) return out;
  for (const k of ADDRESS_KEYS) {
    const v = raw[k];
    if (typeof v === "string" && isAddress(v.trim(), { strict: false })) out[k] = getAddress(v.trim());
  }
  return out as Partial<FlipperDeployment["addresses"]>;
}

export interface ResolveDeploymentOptions {
  chainId?: number;
  rpcUrl?: string;
  apiUrl?: string;
  /** contract overrides; with `house` and `lens` set, nothing is fetched */
  addresses?: Partial<FlipperDeployment["addresses"]>;
  /** manifest to fetch when the chain's addresses aren't known locally; `null` disables fetching */
  deploymentUrl?: string | null;
  /**
   * Accept a fetched manifest whose house / lens differ from `CANONICAL_DEPLOYMENTS` (your own deployment of the
   * contracts). Integrator code only: the widget's and embed's URL config can never set it.
   */
  allowUnpinnedDeployment?: boolean;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Resolves the deployment to use: explicit `addresses` win, then the SDK's built-in registry
 * (`registerFlipperAddresses`), then the live manifest at `deploymentUrl`. Throws a `DeploymentError` when the chain
 * has no deployment.
 */
export async function resolveDeployment(opts: ResolveDeploymentOptions = {}): Promise<FlipperDeployment> {
  const overrides = normalizeAddresses(opts.addresses as Record<string, unknown>);
  const complete = (a: Partial<FlipperAddresses>): a is FlipperAddresses => !!a.house && !!a.lens;

  const local = (chainId: number, addresses: FlipperAddresses): FlipperDeployment => {
    const known = CHAIN_DEFAULTS[chainId];
    return {
      chainId,
      name: known?.name ?? (chainId === LOCAL_CHAIN_ID ? "Local chain" : `Chain ${chainId}`),
      rpcUrl: opts.rpcUrl ?? PUBLIC_RPC_URLS[chainId] ?? "",
      apiUrl: opts.apiUrl ?? (chainId === DEFAULT_CHAIN_ID ? DEFAULT_API_URL : undefined),
      explorerUrl: known?.explorerUrl,
      nativeSymbol: known?.nativeSymbol ?? "ETH",
      blockTimeMs: known?.blockTimeMs,
      addresses: { multicall3: known?.multicall3 ?? MULTICALL3, ...addresses },
    };
  };

  if (complete(overrides)) {
    const d = local(opts.chainId ?? DEFAULT_CHAIN_ID, overrides);
    if (!d.rpcUrl) throw new DeploymentError(`Set rpcUrl: there is no public RPC for chain ${d.chainId}.`, d.chainId);
    return d;
  }
  const registered = getFlipperAddresses(opts.chainId ?? DEFAULT_CHAIN_ID);
  if (registered && opts.deploymentUrl === undefined) return local(opts.chainId ?? DEFAULT_CHAIN_ID, { ...registered, ...overrides });

  const url = opts.deploymentUrl === undefined ? DEFAULT_DEPLOYMENT_URL : opts.deploymentUrl;
  if (!url) throw new DeploymentError("Pass `addresses` (house and lens): no deployment manifest is configured.", opts.chainId);
  const manifest = await fetchDeploymentManifest(url, { fetch: opts.fetch, signal: opts.signal });
  const chainId = opts.chainId ?? manifest.default;
  const found = manifest.deployments[String(chainId)];
  if (!found) {
    const live = Object.keys(manifest.deployments).map(Number);
    throw new DeploymentError(`flipper isn't live on chain ${chainId} yet${live.length ? ` (live: ${live.join(", ")})` : ""}.`, chainId);
  }
  // a pinned chain: the manifest's own house and lens must be the canonical ones (overrides are the integrator's code)
  const pin = CANONICAL_DEPLOYMENTS[chainId];
  if (pin && !opts.allowUnpinnedDeployment) {
    const fetched = normalizeAddresses(found.addresses as unknown as Record<string, unknown>);
    for (const k of ["house", "lens"] as const) {
      if (!fetched[k] || !isAddressEqual(fetched[k]!, pin[k])) {
        throw new DeploymentError(
          `The deployment manifest's ${k} for chain ${chainId} (${fetched[k] ?? "missing"}) isn't flipper's canonical ${k} (${pin[k]}). Refusing it; ` +
            "pass allowUnpinnedDeployment: true only for your own deployment of the contracts.",
          chainId,
        );
      }
    }
  }
  const merged: FlipperDeployment = {
    ...found,
    rpcUrl: opts.rpcUrl ?? found.rpcUrl ?? PUBLIC_RPC_URLS[chainId] ?? "",
    apiUrl: opts.apiUrl ?? found.apiUrl,
    addresses: { ...(normalizeAddresses(found.addresses as unknown as Record<string, unknown>) as FlipperAddresses), ...overrides },
  };
  if (!complete(merged.addresses)) throw new DeploymentError(`The deployment for chain ${chainId} has no house / lens.`, chainId);
  return merged;
}

export class DeploymentError extends Error {
  override name = "DeploymentError";
  constructor(
    message: string,
    readonly chainId?: number,
  ) {
    super(message);
  }
}

const manifestCache = new Map<string, Promise<FlipperDeploymentManifest>>();
/** Fetches (once per URL per page) and validates a deployment manifest. */
export function fetchDeploymentManifest(url: string, opts: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<FlipperDeploymentManifest> {
  let p = manifestCache.get(url);
  if (!p) {
    const f = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    p = f(url, { headers: { accept: "application/json" }, signal: opts.signal })
      .then(async (res) => {
        if (!res.ok) throw new DeploymentError(`Couldn't load the flipper deployment (${res.status}).`);
        const j = (await res.json()) as FlipperDeploymentManifest;
        if (!j || typeof j !== "object" || !j.deployments || typeof j.deployments !== "object") throw new DeploymentError("The flipper deployment manifest is malformed.");
        // links and endpoints must be https (or http on localhost): a tampered `explorerUrl: "javascript:…"` is dropped
        for (const d of Object.values(j.deployments)) {
          if (!d || typeof d !== "object") continue;
          for (const k of ["rpcUrl", "apiUrl", "explorerUrl"] as const) {
            if (d[k] !== undefined && d[k] !== null && !safeHttpUrl(d[k])) delete (d as Partial<FlipperDeployment>)[k];
          }
        }
        return j;
      })
      .catch((err) => {
        manifestCache.delete(url);
        throw err instanceof DeploymentError ? err : new DeploymentError("Couldn't reach flipper.family to load the deployment.");
      });
    manifestCache.set(url, p);
  }
  return p;
}

/**
 * A viem `Chain` for a deployment, pointed at the deployment's RPC (when it's a safe URL). `switchWalletChain` doesn't
 * take the RPC from it when adding the chain to a wallet: it uses the hard-coded `PUBLIC_RPC_URLS`.
 */
export function flipperChain(d: Pick<FlipperDeployment, "chainId" | "name" | "rpcUrl" | "explorerUrl" | "nativeSymbol" | "blockTimeMs"> & { addresses?: { multicall3?: Address } }): Chain {
  if (d.chainId === INK_CHAIN_ID) {
    return defineChain({
      ...ink,
      rpcUrls: { default: { http: [d.rpcUrl || ink.rpcUrls.default.http[0]] } },
      contracts: { ...ink.contracts, multicall3: { ...ink.contracts.multicall3, address: d.addresses?.multicall3 ?? ink.contracts.multicall3.address } },
      blockTime: d.blockTimeMs ?? ink.blockTime,
    }) as Chain;
  }
  const symbol = d.nativeSymbol ?? "ETH";
  return defineChain({
    id: d.chainId,
    name: d.name,
    nativeCurrency: { name: symbol === "ETH" ? "Ether" : symbol, symbol, decimals: 18 },
    rpcUrls: { default: { http: [safeHttpUrl(d.rpcUrl) ?? PUBLIC_RPC_URLS[d.chainId] ?? d.rpcUrl] } },
    blockExplorers: safeHttpUrl(d.explorerUrl) ? { default: { name: `${d.name} explorer`, url: d.explorerUrl! } } : undefined,
    contracts: { multicall3: { address: d.addresses?.multicall3 ?? MULTICALL3 } },
    testnet: d.chainId === LOCAL_CHAIN_ID,
    blockTime: d.blockTimeMs,
  });
}
