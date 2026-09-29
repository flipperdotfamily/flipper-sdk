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
import { shallowRef, toValue, watchEffect, type MaybeRefOrGetter, type ShallowRef } from "vue";
import { createPublicClient, http, type Address, type Chain } from "viem";

export interface UseFlipperClientOptions extends Omit<ResolveDeploymentOptions, "fetch" | "signal"> {
  provider?: Eip1193Provider | null;
  walletClient?: WalletClientLike | null;
}

/**
 * A headless `@flipperdotfamily/sdk` client for your own UI (reactive: rebuilt when the options change).
 *
 * ```ts
 * const { client, loading } = useFlipperClient(() => ({ provider: provider.value }));
 * ```
 */
export function useFlipperClient(options: MaybeRefOrGetter<UseFlipperClientOptions> = {}): {
  client: ShallowRef<FlipperClient | undefined>;
  deployment: ShallowRef<FlipperDeployment | undefined>;
  chain: ShallowRef<Chain | undefined>;
  loading: ShallowRef<boolean>;
  error: ShallowRef<Error | undefined>;
} {
  const client = shallowRef<FlipperClient>();
  const deployment = shallowRef<FlipperDeployment>();
  const chain = shallowRef<Chain>();
  const loading = shallowRef(true);
  const error = shallowRef<Error>();
  watchEffect((onCleanup) => {
    const o = toValue(options);
    let alive = true;
    onCleanup(() => (alive = false));
    loading.value = true;
    error.value = undefined;
    (async () => {
      const d = await resolveDeployment({ chainId: o.chainId, rpcUrl: o.rpcUrl, apiUrl: o.apiUrl, deploymentUrl: o.deploymentUrl, addresses: o.addresses });
      const c = flipperChain(d);
      const publicClient = createPublicClient({ chain: c, transport: http(d.rpcUrl, { batch: { wait: 16 } }) });
      let wc: FlipperWalletClient | undefined;
      const host = o.walletClient;
      if (host?.account) {
        wc =
          typeof (host as { writeContract?: unknown }).writeContract === "function"
            ? (host as unknown as FlipperWalletClient)
            : walletClientFromProvider({ request: (a) => host.request(a) }, c, host.account.address as Address);
      }
      if (!wc && o.provider) {
        const accounts = (await o.provider.request({ method: "eth_accounts" }).catch(() => [])) as Address[];
        if (accounts[0]) wc = walletClientFromProvider(o.provider, c, accounts[0]);
      }
      if (!alive) return;
      client.value = createFlipperClient({ publicClient: publicClient as never, walletClient: wc, addresses: d.addresses, hookitRoutes: (d.liveChainId ?? d.chainId) === INK_CHAIN_ID });
      deployment.value = d;
      chain.value = c;
      loading.value = false;
    })().catch((e: Error) => {
      if (!alive) return;
      error.value = e;
      loading.value = false;
    });
  });
  return { client, deployment, chain, loading, error };
}
