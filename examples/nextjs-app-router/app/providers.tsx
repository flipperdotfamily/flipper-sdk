"use client";

import { FlipperConfigProvider } from "@flipperdotfamily/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { defineChain } from "viem";
import { createConfig, http, WagmiProvider, type Config } from "wagmi";
import { loadStack, type Stack } from "./showcase";

const StackContext = createContext<Stack | null>(null);
/** The running stack (null until it has loaded in the browser; the static HTML renders without it). */
export const useStack = () => useContext(StackContext);

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [ready, setReady] = useState<{ stack: Stack; config: Config } | null>(null);

  useEffect(() => {
    void loadStack().then((stack) => {
      const chain = defineChain({
        id: stack.chainId,
        name: stack.chainName,
        nativeCurrency: { name: "Ether", symbol: stack.nativeSymbol, decimals: 18 },
        rpcUrls: { default: { http: [stack.rpcUrl] } },
      });
      // browser wallets come from EIP-6963 discovery (plus the showcase's dev wallet on a local fork)
      setReady({ stack, config: createConfig({ chains: [chain], connectors: [], ssr: true, transports: { [chain.id]: http(stack.rpcUrl) } }) });
    });
  }, []);

  // until the stack is known: the pre-rendered page, with the interactive parts waiting
  if (!ready) return <StackContext.Provider value={null}>{children}</StackContext.Provider>;
  return (
    <StackContext.Provider value={ready.stack}>
      <WagmiProvider config={ready.config}>
        <QueryClientProvider client={queryClient}>
          {/* defaults for every <FlipperWidget /> on the site */}
          <FlipperConfigProvider
            config={{ chainId: ready.stack.chainId, deploymentUrl: ready.stack.deploymentUrl, partner: "block-ledger", theme: { mode: "light", accent: "#c2410c", radius: 14 } }}
          >
            {children}
          </FlipperConfigProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </StackContext.Provider>
  );
}
