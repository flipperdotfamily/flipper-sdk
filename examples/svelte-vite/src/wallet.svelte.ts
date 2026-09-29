import { connect, createConfig, disconnect, getConnectorClient, getConnectors, http, watchConnection, watchConnectors, type Connector } from "@wagmi/core";
import { defineChain } from "viem";
import type { Stack } from "./showcase";

/**
 * Folio's wallet layer: wagmi core (framework-agnostic), with browser wallets discovered through EIP-6963 (and, on a
 * local fork, the showcase's dev wallet). Reactive state for Svelte 5; `$state.raw` keeps viem objects unproxied.
 */
export function createWallet(stack: Stack) {
  const chain = defineChain({
    id: stack.chainId,
    name: stack.chainName,
    nativeCurrency: { name: "Ether", symbol: stack.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [stack.rpcUrl] } },
  });
  const config = createConfig({ chains: [chain], connectors: [], transports: { [chain.id]: http(stack.rpcUrl) } });

  const state = new (class {
    address = $state.raw<`0x${string}` | undefined>();
    client = $state.raw<Awaited<ReturnType<typeof getConnectorClient>> | undefined>();
    connectors = $state.raw<readonly Connector[]>(getConnectors(config));
    config = config;
    connect = (connector: Connector) => connect(config, { connector });
    disconnect = () => disconnect(config);
  })();

  watchConnectors(config, { onChange: (c) => (state.connectors = c) });
  watchConnection(config, {
    async onChange(c) {
      state.address = c.address;
      state.client = c.address ? await getConnectorClient(config).catch(() => undefined) : undefined;
    },
  });
  return state;
}

export type Wallet = ReturnType<typeof createWallet>;
