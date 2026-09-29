import type { Address, Hex } from "viem";
import type { PoolKey } from "./types";

/**
 * Typed client for the flipper.family API's public, CORS-open read endpoints (token index, logos). No auth.
 *
 * ```ts
 * const api = createFlipperApi({ url: "https://api.flipper.family", partner: "acme" });
 * const page = await api.tokens({ q: "tsla", limit: 30 });
 * ```
 */

/** A token pool as the API reports it (`Pool` in apps/api/API.md). */
export interface ApiPool {
  key: PoolKey;
  poolId: Hex;
  /** the other currency (0x000… for ETH) */
  quote: Address;
  block?: number;
  /** Uniswap version: 4, or 3 for v3 pools (only listable once the v3 route adapter ships) */
  version?: 3 | 4;
  /** v3 only: the pool contract */
  address?: Address;
  depthWei?: string | null;
  probeError?: string | null;
  probeLossBps?: number | null;
  rankLossBps?: number | null;
  updatedAt?: string | null;
}

export type ApiTokenSection = "listed" | "eligible" | "unsupported";

export interface ApiEligibility {
  status: "eligible" | "ineligible" | "unchecked";
  /** plain English, null when eligible */
  reason: string | null;
  code?: number | null;
  depthWei?: string | null;
  checkedAt?: string | null;
  error?: string;
}

export interface ApiRefresh {
  state: "idle" | "pending" | "running";
  requestedAt: string | null;
  completedAt: string | null;
  nextAllowedAt: string | null;
}

/** `Token` in apps/api/API.md. */
export interface ApiToken {
  address: Address;
  /** null until the indexer has read the token's metadata */
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  kind: "pons" | "v4" | string;
  /** the token's best eligible pool (null when none is left) */
  pool: ApiPool | null;
  depthWei?: string | null;
  probeLossBps?: number | null;
  rankLossBps?: number | null;
  eligibility: ApiEligibility;
  registered: boolean;
  listed: boolean;
  firstBlock?: number;
  /** the picker group: listed (flippable), eligible (listable), unsupported */
  section?: ApiTokenSection;
  verified?: boolean;
  verifiedBy?: string[];
  /** which listing route the adapters take ("v4" | "v3"; "listed" once it is) */
  listVia?: string | null;
  /** how the ListingPolicy vetted it: the path (pool / launchpad / token) and the launchpad that vouches, if any */
  vettedBy?: { path: string; launchpad: string | null } | null;
  /** absolute URL of the logo endpoint; null when none is known */
  logo?: string | null;
  logoSource?: string | null;
  refresh?: ApiRefresh;
  description?: string;
  links?: Partial<Record<"website" | "twitter" | "telegram" | "discord" | "farcaster", string>>;
}

export interface ApiTokenPage {
  tokens: ApiToken[];
  total: number;
  sections: Record<ApiTokenSection, number>;
  /** next page's offset; null on the last page */
  next: number | null;
  ranked?: boolean;
  updatedAt?: string;
}

export interface FlipperApiOptions {
  /** API base URL, e.g. https://api.flipper.family (no trailing /v1) */
  url: string;
  /** attribution id, sent as the `X-Flipper-Partner` header (1–64 chars of `[A-Za-z0-9._:-]`; anything else is dropped) */
  partner?: string | null;
  fetch?: typeof fetch;
  /** per-request timeout (ms); default 15 s */
  timeoutMs?: number;
}

export class FlipperApiError extends Error {
  override name = "FlipperApiError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** A valid partner id (`[A-Za-z0-9._:-]{1,64}`), or null. */
export function normalizePartner(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[A-Za-z0-9._:-]{1,64}$/.test(s) ? s : null;
}

/**
 * Only public, CORS-open reads: no credentials, no `Authorization` / `X-Flipper-Anon` (the API refuses those from
 * other origins). Debounce searches: public reads are rate-limited per end-user IP (20/s, burst 120; logos exempt).
 */
export function createFlipperApi({ url, partner, fetch: f, timeoutMs = 15_000 }: FlipperApiOptions) {
  const base = url.replace(/\/+$/, "").replace(/\/v1$/, "");
  const doFetch = f ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const partnerId = normalizePartner(partner);
  const headers: Record<string, string> = { accept: "application/json" };
  if (partnerId) headers["X-Flipper-Partner"] = partnerId;

  function build(path: string, query: Record<string, string | number | undefined | null> = {}) {
    const u = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
    return u.toString();
  }

  async function get<T>(path: string, query?: Record<string, string | number | undefined | null>, signal?: AbortSignal): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await doFetch(build(path, query), { headers, credentials: "omit", signal: ctrl.signal });
      if (!res.ok) {
        let msg = `The flipper API responded ${res.status}.`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* not JSON */
        }
        throw new FlipperApiError(msg, res.status);
      }
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof FlipperApiError) throw err;
      if (signal?.aborted) throw err;
      throw new FlipperApiError(ctrl.signal.aborted ? "The flipper API timed out." : "Can't reach the flipper API.", 0);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    url: base,
    partner: partnerId,
    /** One page of the token index: listed first, then eligible, then unsupported (search covers every section). */
    tokens(opts: { q?: string; limit?: number; offset?: number; kind?: "pons" | "v4"; signal?: AbortSignal } = {}): Promise<ApiTokenPage> {
      const { q, limit = 50, offset = 0, kind, signal } = opts;
      return get<ApiTokenPage>("/v1/tokens", { q: q?.trim() || undefined, limit, offset: offset || undefined, kind }, signal);
    },
    /** A single token with every eligible pool (best first). 404 → FlipperApiError with status 404. */
    token(address: Address, signal?: AbortSignal): Promise<{ token: ApiToken; pools: ApiPool[] }> {
      return get(`/v1/tokens/${address}`, undefined, signal);
    },
    /** The logo endpoint for a token (use the token's own `logo` URL when you have it: it carries a cache key). */
    logoUrl(address: Address): string {
      return `${base}/v1/tokens/${address}/logo`;
    },
  };
}

export type FlipperApi = ReturnType<typeof createFlipperApi>;

/** The picker section a token belongs to (the API computes it; older builds fall back to the flags). */
export function tokenSection(t: Pick<ApiToken, "section" | "listed" | "eligibility">): ApiTokenSection {
  if (t.section) return t.section;
  if (t.eligibility?.status === "ineligible") return "unsupported";
  return t.listed ? "listed" : "eligible";
}
