/**
 * Where to flip. Served by the examples showcase (dev.sh), the page loads the showcase kit at runtime: the local
 * stack's chain, RPC, API and addresses (from the web app's /embed/deployment.json) and, on a local fork, the dev
 * wallet (announced through EIP-6963, so wagmi lists it like any browser wallet). Anywhere else, production defaults.
 */
import { CHAIN_DEFAULTS, DEFAULT_CHAIN_ID, DEFAULT_DEPLOYMENT_URL, PUBLIC_RPC_URLS } from "@flipperdotfamily/sdk";

export interface ShowcaseToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  logo: string | null;
}

export interface Stack {
  showcase: boolean;
  deploymentUrl: string;
  chainId: number;
  chainName: string;
  rpcUrl: string;
  nativeSymbol: string;
  addresses: Record<string, `0x${string}`>;
  local: boolean;
  devWallet: { address: `0x${string}`; label: string } | null;
  findTokens(symbols: string[]): Promise<ShowcaseToken[]>;
  listTokens(): Promise<ShowcaseToken[]>;
}

// production defaults: the SDK's default chain (Robinhood Chain), so they follow the SDK instead of drifting from it
const PRODUCTION: Stack = {
  showcase: false,
  deploymentUrl: DEFAULT_DEPLOYMENT_URL,
  chainId: DEFAULT_CHAIN_ID,
  chainName: CHAIN_DEFAULTS[DEFAULT_CHAIN_ID]?.name ?? `Chain ${DEFAULT_CHAIN_ID}`,
  rpcUrl: PUBLIC_RPC_URLS[DEFAULT_CHAIN_ID] ?? "",
  nativeSymbol: CHAIN_DEFAULTS[DEFAULT_CHAIN_ID]?.nativeSymbol ?? "ETH",
  addresses: {},
  local: false,
  devWallet: null,
  findTokens: async () => [],
  listTokens: async () => [],
};

export async function loadStack(): Promise<Stack> {
  const url = "/_showcase/kit.js";
  try {
    const kit = (await import(/* @vite-ignore */ url)) as { loadStack(): Promise<Stack> };
    const s = await kit.loadStack();
    return s.chainId && s.rpcUrl ? s : { ...PRODUCTION, ...s, chainId: PRODUCTION.chainId, rpcUrl: PRODUCTION.rpcUrl };
  } catch {
    return PRODUCTION;
  }
}

export const DEV_WALLET_ID = "family.flipper.devwallet";
