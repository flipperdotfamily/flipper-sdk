import { createWalletClient, custom, numberToHex, type Address, type Chain } from "viem";
import type { FlipperWalletClient } from "./client";
import { CHAIN_DEFAULTS } from "./constants";
import { PUBLIC_RPC_URLS } from "./deployments";
import { FlipperError } from "./errors";

/** The EIP-1193 provider shape (window.ethereum, wagmi connectors, WalletConnect, AppKit, Privy…). */
export interface Eip1193Provider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on?(event: string, listener: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

export function isEip1193Provider(v: unknown): v is Eip1193Provider {
  return !!v && typeof (v as Eip1193Provider).request === "function";
}

/** The numeric code of an EIP-1193 / JSON-RPC error, looking through viem's wrappers. */
export function rpcErrorCode(err: unknown): number | undefined {
  let e = err as { code?: unknown; cause?: unknown } | undefined;
  for (let i = 0; e && i < 6; i++) {
    if (typeof e.code === "number") return e.code;
    e = e.cause as typeof e;
  }
  return undefined;
}

/** A viem WalletClient that signs and sends through `provider` (the host's wallet). */
export function walletClientFromProvider(provider: Eip1193Provider, chain: Chain, account?: Address): FlipperWalletClient {
  return createWalletClient({ chain, account, transport: custom(provider as Parameters<typeof custom>[0]) }) as unknown as FlipperWalletClient;
}

/**
 * Asks the wallet to switch to `chain` (`wallet_switchEthereumChain`), adding it first when the wallet doesn't know
 * it (error 4902, or the -32603 some wallets use), then switching again.
 */
export async function switchWalletChain(provider: Eip1193Provider, chain: Chain): Promise<void> {
  const chainId = numberToHex(chain.id);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    return;
  } catch (err) {
    const code = rpcErrorCode(err);
    const unknown = code === 4902 || (code === -32603 && /unrecognized|unknown|not added|add/i.test(String((err as Error)?.message)));
    if (!unknown) throw err;
  }
  // The chain the wallet saves must never come from an overridable read RPC (a crafted config could plant its own
  // node in the user's wallet): only the SDK's hard-coded public RPC and explorer for the chain.
  const rpc = PUBLIC_RPC_URLS[chain.id];
  if (!rpc) throw new FlipperError(`Add ${chain.name} (chain id ${chain.id}) to your wallet, then try again.`, "config");
  const explorer = CHAIN_DEFAULTS[chain.id]?.explorerUrl;
  await provider.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId,
        chainName: CHAIN_DEFAULTS[chain.id]?.name ?? chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [rpc],
        blockExplorerUrls: explorer ? [explorer] : undefined,
      },
    ],
  });
  await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] }).catch(() => undefined);
}
