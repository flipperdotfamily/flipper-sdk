import { isAddressEqual, zeroAddress, type Address } from "viem";
import type { ApiPool, ApiToken } from "./api";
import type { FlipperAddresses, PoolKey } from "./types";
import { V4_CHECK_REASONS } from "./v4";

/**
 * Permissionless listing, by venue. Each venue has its own route adapter:
 * - `v4`: V4RouteAdapter.registerAndList(token, poolKey), any Uniswap v4 pool with an allowed hook / quote;
 * - `v3`: V3RouteAdapter.registerAndList(token, v3Pool), a Uniswap v3 pool (bridged into v4 by the V3BridgeHook).
 *
 * `listingTargetFromApi` turns a token from the flipper API into a target; `client.checkListing(target)` dry-runs it
 * and `client.list(target)` sends it. New venues add a `ListingTarget` variant, a case in the client, and a mapping here.
 */
export type ListingVenue = "v4" | "v3" | "hookit";

export type ListingTarget =
  | { venue: "v4"; token: Address; key: PoolKey }
  | { venue: "v3"; token: Address; pool: Address }
  | { venue: "hookit"; token: Address };

/** Why an adapter rejects a pool (`check()` reason codes; v3 adds 9–11). */
export const V3_CHECK_REASONS: Record<number, string> = {
  ...V4_CHECK_REASONS,
  5: "The pool can't be bridged into flipper's routes",
  9: "Not a Uniswap v3 pool",
  10: "It's already listed through another adapter",
  11: "That's WETH: flip ETH instead",
  12: "Only whitelisted tokens can be listed right now",
  13: "The pool uses a hook flipper hasn't approved",
};
export const v3CheckReason = (code: number) => V3_CHECK_REASONS[code] ?? `Rejected by the v3 adapter (code ${code})`;

export type ListingCheck =
  | { ok: true; venue: ListingVenue; depthWei?: bigint }
  | {
      ok: false;
      venue: ListingVenue;
      /** plain English */
      reason: string;
      /** adapter `check()` code (0–11), when the adapter itself refused */
      code?: number;
      /** the house's listing probe: the round-trip cost that exceeded the limit (bps) */
      routeCostBps?: bigint;
      /** the token is listed already */
      alreadyListed?: boolean;
    };

/** Which venue a flipper API pool lists through (`listVia` / `adapter` when the API sends them, else by version). */
export function venueOfPool(pool: Pick<ApiPool, "version" | "address"> & { listVia?: string; adapter?: string }): ListingVenue | undefined {
  const via = (pool.listVia ?? pool.adapter ?? "").toLowerCase();
  if (via === "v3" || via === "v4" || via === "hookit") return via;
  if (pool.version === 3) return "v3";
  if (pool.version === 4 || pool.version === undefined) return "v4";
  return undefined;
}

/**
 * The listing target for a token from the flipper API (its best pool, or `pool` when given); null when it has none.
 * The token's own `listVia` wins over the pool's version.
 */
export function listingTargetFromApi(
  token: Pick<ApiToken, "address" | "pool"> & { listVia?: string | null },
  pool: ApiPool | null = token.pool,
): ListingTarget | null {
  const via = token.listVia?.toLowerCase();
  if (via === "hookit") return { venue: "hookit", token: token.address };
  if (!pool) return null;
  const venue = via === "v3" || via === "v4" ? via : venueOfPool(pool as ApiPool & { listVia?: string });
  if (venue === "v3") {
    const addr = pool.address ?? (pool.poolId && pool.poolId.length === 66 ? (`0x${pool.poolId.slice(26)}` as Address) : undefined);
    return addr ? { venue: "v3", token: token.address, pool: addr } : null;
  }
  if (venue === "v4" && pool.key) return { venue: "v4", token: token.address, key: pool.key };
  if (venue === "hookit") return { venue: "hookit", token: token.address };
  return null;
}

/** True for a route hop that goes through the V3BridgeHook (i.e. a Uniswap v3 pool). */
export function isV3Hop(key: Pick<PoolKey, "hooks">, addresses: Pick<FlipperAddresses, "v3Bridge">): boolean {
  return !!addresses.v3Bridge && !isAddressEqual(key.hooks, zeroAddress) && isAddressEqual(key.hooks, addresses.v3Bridge);
}
