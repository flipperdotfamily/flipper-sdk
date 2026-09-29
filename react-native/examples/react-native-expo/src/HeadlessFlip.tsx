import type { FlipperWallet } from "@flipperdotfamily/react-native";
import { formatTokenAmount, useFlipperHeadless } from "@flipperdotfamily/react-native/headless";
import { useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from "react-native";

/** A fully native flip UI on the headless hooks (no WebView). */
export function HeadlessFlip({ wallet, account, chainId }: { wallet: FlipperWallet | null; account: string | null; chainId: number }) {
  const [text, setText] = useState("");
  const f = useFlipperHeadless({ chainId, wallet, account, amount: text });

  if (f.error) return <Text>Couldn't load flipper: {f.error.message}</Text>;
  if (!f.token) return <ActivityIndicator />;

  const { symbol, decimals } = f.token;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Flip {symbol}</Text>
      <Text>Balance: {f.balance === null ? "—" : `${formatTokenAmount(f.balance, decimals)} ${symbol}`}</Text>
      <View style={styles.row}>
        <TextInput style={styles.input} value={text} onChangeText={setText} placeholder="Amount" keyboardType="decimal-pad" />
        <Button title="Max" onPress={async () => setText((await f.maxStake()) ?? "")} />
      </View>
      {f.preview && <Text>Win chance: {(Number(f.preview.winChanceBps) / 100).toFixed(2)}%</Text>}
      {f.payoutIfWon !== null && <Text>If you win: {formatTokenAmount(f.payoutIfWon, decimals)} {symbol}</Text>}
      {f.odds?.shifted && <Text>{f.odds.message}</Text>}
      {f.reject && <Text style={styles.warn}>{f.reject.message}</Text>}
      {!account ? (
        <Text>Connect a wallet to flip.</Text>
      ) : !f.canTransact ? (
        <Button title="Switch network" onPress={() => void f.switchChain()} />
      ) : (
        <Button title={f.busy ? "Flipping…" : "Flip"} disabled={f.busy || !!f.reject || !f.parsedAmount} onPress={() => void f.flip()} />
      )}
      {f.phase.kind === "working" && <Text>{f.phase.step}…</Text>}
      {f.phase.kind === "drawing" && <Text>Drawing…</Text>}
      {f.phase.kind === "settled" && (
        <Text style={styles.title}>
          {f.phase.copy.headline} {f.phase.copy.detail}
        </Text>
      )}
      {f.phase.kind === "error" && <Text style={styles.warn}>{f.phase.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 16, backgroundColor: "#10131a", gap: 8 },
  title: { fontWeight: "700", color: "#e8ecf4" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, backgroundColor: "#fff", borderRadius: 8, padding: 8 },
  warn: { color: "#ff8a65" },
});
