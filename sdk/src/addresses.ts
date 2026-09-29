import type { FlipperAddresses } from "./types";

/**
 * Default addresses by chain id: `resolveDeployment` uses them without fetching the manifest. Robinhood Chain's are
 * written from the deployment manifest at release (`contracts/script/pin-sdk.py`); for other chains, pass `addresses`
 * explicitly or register them once with `registerFlipperAddresses`.
 */
export const FLIPPER_ADDRESSES: Record<number, FlipperAddresses> = {};

export function registerFlipperAddresses(chainId: number, addresses: FlipperAddresses): void {
  FLIPPER_ADDRESSES[chainId] = addresses;
}

export function getFlipperAddresses(chainId: number | undefined): FlipperAddresses | undefined {
  return chainId === undefined ? undefined : FLIPPER_ADDRESSES[chainId];
}
