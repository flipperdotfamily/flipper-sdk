import { AppKit, AppKitProvider, useAccount, useAppKit, useProvider } from "@reown/appkit-react-native";
import { FlipperWidget, type FlipperWallet, type FlipperWidgetHandle } from "@flipperdotfamily/react-native";
import { StatusBar } from "expo-status-bar";
import { useRef, useState } from "react";
import { Button, Platform, ScrollView, StyleSheet, Text, useColorScheme, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { appKit } from "./src/appkit";
import { HeadlessFlip } from "./src/HeadlessFlip";

// Development: the web app's embed on your machine (Android emulators reach the host at 10.0.2.2) and the local fork.
// Production: omit baseUrl / chain (https://flipper.family/embed on Robinhood Chain, 4663).
const DEV = __DEV__ && process.env.EXPO_PUBLIC_FLIPPER_LOCAL === "1";
const baseUrl = DEV ? (Platform.OS === "android" ? "http://10.0.2.2:3000/embed" : "http://localhost:3000/embed") : undefined;
const chain = DEV ? 31337 : 4663;

function FlipScreen() {
  const scheme = useColorScheme();
  const { open } = useAppKit();
  const { address, chainId, isConnected } = useAccount();
  const { provider, providerType } = useProvider();
  const widget = useRef<FlipperWidgetHandle>(null);
  const [last, setLast] = useState<string>("");
  const [native, setNative] = useState(false);

  // AppKit's EVM provider is EIP-1193: the widget forwards the embed's wallet requests to it, and the user confirms
  // each one in their wallet app.
  const wallet = isConnected && providerType === "eip155" ? (provider as unknown as FlipperWallet) : null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <Button title={isConnected ? "Wallet" : "Connect wallet"} onPress={() => open()} />
        <Button title={native ? "Widget UI" : "Native UI"} onPress={() => setNative((n) => !n)} />
      </View>

      {native ? (
        <HeadlessFlip wallet={wallet} account={address ?? null} chainId={chain} />
      ) : (
        <FlipperWidget
          ref={widget}
          baseUrl={baseUrl}
          chain={chain}
          wallet={wallet}
          address={address ?? null}
          walletChainId={chainId ?? null}
          // theme and white-label
          theme={scheme === "dark" ? "dark" : "light"}
          accent="#ff5a1f"
          radius={20}
          partner="example-app"
          branding={false}
          config={{ brandName: "Example Flip" }}
          // events
          onConnectRequest={() => open()}
          onFlipRequested={(f) => setLast(`flip ${f.flipId} requested`)}
          onFlipSettled={(f) => setLast(`flip ${f.flipId}: ${f.outcome}${f.pending ? " (payout pending)" : ""}`)}
          onError={(e) => setLast(`error: ${e.message}`)}
        />
      )}

      {!!last && <Text style={[styles.status, scheme === "dark" && styles.dark]}>{last}</Text>}
    </ScrollView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppKitProvider instance={appKit}>
        <SafeAreaView style={styles.fill}>
          <StatusBar style="auto" />
          <FlipScreen />
          <AppKit />
        </SafeAreaView>
      </AppKitProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 16 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  status: { textAlign: "center", color: "#333" },
  dark: { color: "#ddd" },
});
