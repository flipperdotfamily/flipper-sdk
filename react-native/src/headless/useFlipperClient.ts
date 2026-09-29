import {
  DEFAULT_CHAIN_ID,
  INK_CHAIN_ID,
  createFlipperClient,
  flipperChain,
  pollingIntervalFor,
  resolveDeployment,
  switchWalletChain,
  walletClientFromProvider,
  type FlipperAddresses,
  type FlipperClient,
  type FlipperDeployment,
  type FlipperPublicClient,
} from "@flipperdotfamily/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, getAddress, http, isAddress, type Address, type Chain } from "viem";
import type { FlipperWallet, FlipperWalletState } from "../types";
import { watchWallet } from "../wallet";

export interface UseFlipperClientOptions {
  /** chain to flip on (default 4663, Robinhood Chain; 31337 for a local fork) */
  chainId?: number;
  /** read RPC (default: the deployment's public RPC) */
  rpcUrl?: string;
  /** pin contract addresses; with `house` and `lens` set, no deployment manifest is fetched */
  addresses?: Partial<FlipperAddresses>;
  /** deployment manifest URL (default https://flipper.family/embed/deployment.json); `null` disables fetching */
  deploymentUrl?: string | null;
  /** the host app's wallet (EIP-1193 provider or `createFlipperWallet(…)`), for transactions */
  wallet?: FlipperWallet | null;
  /** the active account, when your wallet library exposes it through hooks; default `eth_accounts[0]` */
  account?: string | null;
  /** @internal */
  hookitRoutes?: boolean;
  /** keeper API for holder-reward proofs */
  keeper?: { url: string; fetch?: typeof fetch };
}

export interface FlipperClientState {
  /** null until the deployment has resolved */
  client: FlipperClient | null;
  deployment: FlipperDeployment | null;
  chain: Chain | null;
  publicClient: FlipperPublicClient | null;
  /** the account transactions are sent from (null without a wallet) */
  account: Address | null;
  /** the wallet's current chain, when known */
  walletChainId: number | null;
  /** a wallet is connected and on the deployment's chain */
  canTransact: boolean;
  loading: boolean;
  error: Error | null;
  /** asks the wallet to switch to (adding it if needed) the deployment's chain */
  switchChain(): Promise<void>;
}

/**
 * A `FlipperClient` (from `@flipperdotfamily/sdk`) for React Native: reads through a public RPC, writes through the host
 * wallet. Resolves the deployment (explicit `addresses`, the SDK registry, then the live manifest).
 */
export function useFlipperClient(options: UseFlipperClientOptions = {}): FlipperClientState {
  const { chainId = DEFAULT_CHAIN_ID, rpcUrl, deploymentUrl, wallet, hookitRoutes, keeper } = options;
  const addressesKey = JSON.stringify(options.addresses ?? null);

  const [deployment, setDeployment] = useState<FlipperDeployment | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    resolveDeployment({
      chainId,
      rpcUrl,
      addresses: options.addresses,
      deploymentUrl,
      signal: ctrl.signal,
    })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setDeployment(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setDeployment(null);
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, rpcUrl, deploymentUrl, addressesKey]);

  const chain = useMemo(() => (deployment ? flipperChain(deployment) : null), [deployment]);
  const publicClient = useMemo(
    () =>
      deployment && chain
        ? (createPublicClient({
            chain,
            transport: http(deployment.rpcUrl),
            pollingInterval: pollingIntervalFor(deployment.blockTimeMs),
          }) as unknown as FlipperPublicClient)
        : null,
    [deployment, chain],
  );

  const [walletState, setWalletState] = useState<FlipperWalletState>({ accounts: [], chainId: null });
  useEffect(() => {
    setWalletState({ accounts: [], chainId: null });
    if (!wallet) return;
    const w = watchWallet(wallet, (update) => setWalletState((s) => ({ ...s, ...update })));
    return w.stop;
  }, [wallet]);

  const rawAccount = options.account !== undefined ? options.account : (walletState.accounts[0] ?? null);
  const account = wallet && rawAccount && isAddress(rawAccount, { strict: false }) ? getAddress(rawAccount) : null;

  const walletClient = useMemo(
    () => (wallet && account && chain ? walletClientFromProvider(wallet, chain, account) : null),
    [wallet, account, chain],
  );

  const client = useMemo(() => {
    if (!deployment || !publicClient) return null;
    const live = deployment.liveChainId ?? deployment.chainId;
    return createFlipperClient({
      publicClient,
      walletClient,
      addresses: deployment.addresses,
      hookitRoutes: hookitRoutes ?? live === INK_CHAIN_ID,
      keeper,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployment, publicClient, walletClient, hookitRoutes, keeper?.url]);

  const switchChain = useCallback(async () => {
    if (!wallet || !chain) throw new Error("Connect a wallet first.");
    await switchWalletChain(wallet, chain);
    setWalletState((s) => ({ ...s, chainId: chain.id }));
  }, [wallet, chain]);

  return {
    client,
    deployment,
    chain,
    publicClient,
    account,
    walletChainId: walletState.chainId,
    canTransact: !!walletClient && !!deployment && walletState.chainId === deployment.chainId,
    loading,
    error,
    switchChain,
  };
}
