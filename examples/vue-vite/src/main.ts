import { VueQueryPlugin } from "@tanstack/vue-query";
import { FlipperPlugin } from "@flipperdotfamily/vue";
import { createConfig, http, WagmiPlugin } from "@wagmi/vue";
import { defineChain } from "viem";
import { createApp } from "vue";
import App from "./App.vue";
import { loadStack } from "./showcase";
import "./styles.css";

const stack = await loadStack();
const chain = defineChain({
  id: stack.chainId,
  name: stack.chainName,
  nativeCurrency: { name: "Ether", symbol: stack.nativeSymbol, decimals: 18 },
  rpcUrls: { default: { http: [stack.rpcUrl] } },
});
// Questline's wagmi setup: browser wallets come from EIP-6963 discovery (plus the showcase's dev wallet on a fork)
const config = createConfig({ chains: [chain], connectors: [], transports: { [chain.id]: http(stack.rpcUrl) } });

createApp(App, { stack })
  .use(WagmiPlugin, { config })
  .use(VueQueryPlugin)
  // defaults for every <FlipperWidget> in the app: the local stack, Questline's partner id and its light theme
  .use(FlipperPlugin, {
    chainId: stack.chainId,
    deploymentUrl: stack.deploymentUrl,
    partner: "questline",
    theme: { mode: "light", accent: "#ff7a1a", radius: 22, displayFontFamily: "Fredoka, ui-rounded, system-ui, sans-serif" },
  })
  .mount("#app");
