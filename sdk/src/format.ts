import { formatUnits, parseUnits } from "viem";

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-US", o);

/** Human number formatting for UI: 1,234.56 · 12.3M · 0.000005 */
export function formatNumber(n: number, opts: { maxFractionDigits?: number; compactFrom?: number } = {}): string {
  const { maxFractionDigits = 4, compactFrom = 1e6 } = opts;
  if (!Number.isFinite(n)) return "–";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a >= compactFrom) return nf({ notation: "compact", maximumFractionDigits: 2 }).format(n);
  if (a >= 1000) return nf({ maximumFractionDigits: 2 }).format(n);
  if (a >= 1) return nf({ maximumFractionDigits: Math.min(maxFractionDigits, 4) }).format(n);
  return nf({ maximumSignificantDigits: 4 }).format(n);
}

/** Format a token amount held as wei. */
export function formatTokenAmount(
  value: bigint,
  decimals: number,
  opts: { maxFractionDigits?: number; compactFrom?: number } = {},
): string {
  if (value === 0n) return "0";
  return formatNumber(Number(formatUnits(value, decimals)), opts);
}

/** Exact decimal string of `value` truncated (never rounded up) to `maxFractionDigits`. For input fields. */
export function toInputString(value: bigint, decimals: number, maxFractionDigits = 6): string {
  const s = formatUnits(value, decimals);
  const [int, frac = ""] = s.split(".");
  const f = frac.slice(0, maxFractionDigits).replace(/0+$/, "");
  return f ? `${int}.${f}` : (int ?? "0");
}

/** Parse a user-typed amount ("1,000.5", ".5", "2e3" is rejected). Returns null when invalid. */
export function parseAmount(input: string, decimals: number): bigint | null {
  const s = input.replace(/[,\s_]/g, "");
  if (s === "" || s === ".") return null;
  if (!/^\d*\.?\d*$/.test(s)) return null;
  const [int = "0", frac = ""] = s.split(".");
  try {
    return parseUnits(`${int || "0"}.${frac.slice(0, decimals) || "0"}`, decimals);
  } catch {
    return null;
  }
}

export const shortAddress = (a: string, head = 6, tail = 4) => (a.length > head + tail ? `${a.slice(0, head)}…${a.slice(-tail)}` : a);

/** "3d 4h", "5h 12m", "12m", "now" */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}
