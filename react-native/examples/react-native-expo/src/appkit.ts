import { EthersAdapter } from "@reown/appkit-ethers-react-native";
import { createAppKit } from "@reown/appkit-react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { robinhood } from "viem/chains";

// Get a project id at https://dashboard.reown.com
const projectId = process.env.EXPO_PUBLIC_REOWN_PROJECT_ID ?? "YOUR_PROJECT_ID";

/**
 * Robinhood Chain (viem's chain, 4663). Set EXPO_PUBLIC_ROBINHOOD_RPC_URL to use your RPC provider's endpoint instead
 * of the public one.
 */
export const robinhoodChain = process.env.EXPO_PUBLIC_ROBINHOOD_RPC_URL
  ? { ...robinhood, rpcUrls: { default: { http: [process.env.EXPO_PUBLIC_ROBINHOOD_RPC_URL] } } }
  : robinhood;

// AppKit keeps its session in async storage (the key/value interface it expects).
const storage = {
  getKeys: () => AsyncStorage.getAllKeys() as Promise<string[]>,
  getEntries: async <T = unknown>() => {
    const keys = await AsyncStorage.getAllKeys();
    const entries = await AsyncStorage.multiGet(keys);
    return entries.map(([k, v]) => [k, v ? (JSON.parse(v) as T) : (undefined as T)] as [string, T]);
  },
  getItem: async <T = unknown>(key: string) => {
    const v = await AsyncStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : undefined;
  },
  setItem: async <T = unknown>(key: string, value: T) => AsyncStorage.setItem(key, JSON.stringify(value)),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
};

export const appKit = createAppKit({
  projectId,
  networks: [robinhoodChain],
  defaultNetwork: robinhoodChain,
  adapters: [new EthersAdapter()],
  storage,
  metadata: {
    name: "Flipper Example",
    description: "flipper.family widget in React Native",
    url: "https://flipper.family",
    icons: ["https://flipper.family/icon.svg"],
    redirect: { native: "flipperexample://" },
  },
});
