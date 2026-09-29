import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { defineChain } from "viem";
import { createConfig, http, WagmiProvider } from "wagmi";
import { App } from "./App";
import { loadStack } from "./showcase";
import "./styles.css";

const stack = await loadStack();
const chain = defineChain({
  id: stack.chainId,
  name: stack.chainName,
  nativeCurrency: { name: "Ether", symbol: stack.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [stack.rpcUrl] } },
});

// Lagoon's wagmi setup. No hard-wired connectors: wagmi discovers browser wallets through EIP-6963 (MetaMask, Rabby,
// Coinbase… and, on a local fork, the showcase's dev wallet). Add WalletConnect / Reown AppKit here as usual.
const config = createConfig({ chains: [chain], connectors: [], transports: { [chain.id]: http(stack.rpcUrl) } });
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App stack={stack} />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
