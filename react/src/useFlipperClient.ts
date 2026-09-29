import {
  INK_CHAIN_ID,
  createFlipperClient,
  flipperChain,
  resolveDeployment,
  walletClientFromProvider,
  type Eip1193Provider,
  type FlipperClient,
  type FlipperDeployment,
  type FlipperWalletClient,
  type ResolveDeploymentOptions,
} from "@flipperdotfamily/sdk";
import type { WalletClientLike } from "@flipperdotfamily/widget/element";
import { useEffect, useState } from "react";
import { createPublicClient, http, type Address, type Chain } from "viem";

export interface UseFlipperClientOptions extends Omit<ResolveDeploymentOptions, "fetch" | "signal"> {
  /** EIP-1193 provider for writes (its first account signs) */
  provider?: Eip1193Provider | null;
  /** or a viem client for the connected account (wagmi's useWalletClient().data, or a connector client) */
  walletClient?: WalletClientLike | null;
}

export interface UseFlipperClientResult {
  client?: FlipperClient;
  deployment?: FlipperDeployment;
  chain?: Chain;
  loading: boolean;
  error?: Error;
}

/**
 * A headless `@flipperdotfamily/sdk` client for your own UI: resolves the deployment (addresses, RPC, API), builds a viem
 * public client, and wires writes to your wallet. Recreated when the chain, addresses or wallet change.
 *
 * ```ts
 * const { client } = useFlipperClient({ walletClient });
 * await client?.flip({ token, amount: parseUnits("10", 18) });
 * ```
 */
export function useFlipperClient(opts: UseFlipperClientOptions = {}): UseFlipperClientResult {
  const { provider, walletClient, chainId, rpcUrl, apiUrl, deploymentUrl, addresses } = opts;
  const [state, setState] = useState<UseFlipperClientResult>({ loading: true });
  const addressKey = JSON.stringify(addresses ?? null);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    (async () => {
      const deployment = await resolveDeployment({ chainId, rpcUrl, apiUrl, deploymentUrl, addresses });
      const chain = flipperChain(deployment);
      const publicClient = createPublicClient({ chain, transport: http(deployment.rpcUrl, { batch: { wait: 16 } }) });
      let wc: FlipperWalletClient | undefined;
      if (walletClient?.account) {
        const host = walletClient;
        wc =
          typeof (host as { writeContract?: unknown }).writeContract === "function"
            ? (host as unknown as FlipperWalletClient)
            : walletClientFromProvider({ request: (a) => host.request(a) }, chain, host.account!.address as Address);
      }
      if (!wc && provider) {
        const accounts = (await provider.request({ method: "eth_accounts" }).catch(() => [])) as Address[];
        if (accounts[0]) wc = walletClientFromProvider(provider, chain, accounts[0]);
      }
      const client = createFlipperClient({
        publicClient: publicClient as never,
        walletClient: wc,
        addresses: deployment.addresses,
        hookitRoutes: (deployment.liveChainId ?? deployment.chainId) === INK_CHAIN_ID,
      });
      if (alive) setState({ client, deployment, chain, loading: false });
    })().catch((error: Error) => alive && setState({ loading: false, error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, rpcUrl, apiUrl, deploymentUrl, addressKey, provider, walletClient]);

  return state;
}
