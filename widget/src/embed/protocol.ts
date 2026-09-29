/**
 * Embed bridge protocol v1 (packages/widget/BRIDGE.md): message shapes shared by the embed page (widget side) and
 * `@flipperdotfamily/widget/host` (web host side).
 */
import type { FlipperEventMap, FlipperEventName, FlipperTheme, FlipperThemeMode } from "../types";

export const BRIDGE_VERSION = 1 as const;

/**
 * Wallet methods the embed may send to its host. Anything else is refused with 4200, by the embed and by
 * `@flipperdotfamily/widget/host`. No message signing (`personal_sign`, `eth_signTypedData_*`): the widget never signs
 * messages, so a compromised embed couldn't use the bridge to ask for a Permit signature either.
 */
export const BRIDGE_METHODS = [
  "eth_accounts",
  "eth_requestAccounts",
  "eth_chainId",
  "eth_sendTransaction",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_watchAsset",
  "wallet_getCapabilities",
  "wallet_sendCalls",
  "wallet_getCallsStatus",
] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

export type WidgetToHost =
  | { v: 1; source: "flipper"; type: "rpc"; id: string; method: BridgeMethod; params: unknown[] }
  | { [K in FlipperEventName]: { v: 1; source: "flipper"; type: "event"; name: K; data: FlipperEventMap[K] } }[FlipperEventName];

export interface RpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/** The embed's configuration: URL params, the `config` param (base64 JSON), and live `config` messages. */
export interface FlipperEmbedConfig {
  chainId?: number;
  token?: string;
  tokens?: string[];
  /** "picker" (default) or "single" (needs `token`) */
  mode?: "picker" | "single";
  /** @deprecated use mode: "single" */
  hidePicker?: boolean;
  variant?: "card" | "compact";
  /** "auto" (default): the embed reports its height (resize events). "fill": it fills a fixed-size frame. */
  fit?: "auto" | "fill";
  size?: "sm" | "md" | "lg" | "auto";
  /** show the win chance / payout / fee line under the button (default false) */
  details?: boolean;
  /** idle headline under the coin: true = the built-in one, a string = your own (default none) */
  tagline?: string | boolean;
  theme?: FlipperThemeMode | FlipperTheme;
  accent?: string;
  radius?: number;
  branding?: boolean;
  brandName?: string;
  brandLogo?: string;
  coinImage?: string;
  coinImageTails?: string;
  locale?: string;
  strings?: Record<string, string>;
  partner?: string;
  minAmount?: string;
  maxAmount?: string;
  approval?: "max" | "exact";
  listing?: boolean;
  eth?: boolean;
  rpcUrl?: string;
  apiUrl?: string;
  addresses?: Record<string, string>;
}

export type HostToWidget =
  | { v: 1; source: "flipper-host"; type: "rpc-result"; id: string; result: unknown }
  | { v: 1; source: "flipper-host"; type: "rpc-error"; id: string; error: RpcErrorBody }
  | { v: 1; source: "flipper-host"; type: "wallet"; accounts: string[]; chainId: string }
  | ({ v: 1; source: "flipper-host"; type: "config" } & FlipperEmbedConfig);

/** Parses a message from either side (object or JSON string); null when it isn't one of ours. */
export function parseBridgeMessage<T extends { v: number; source: string }>(raw: unknown, source: T["source"]): T | null {
  let m: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 1_000_000 || !raw.startsWith("{")) return null;
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!m || typeof m !== "object") return null;
  const o = m as { v?: unknown; source?: unknown };
  return o.v === BRIDGE_VERSION && o.source === source ? (m as T) : null;
}

/** base64url (or base64) → UTF-8 JSON object; null on anything malformed. */
export function decodeConfigParam(s: string): FlipperEmbedConfig | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, "");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as FlipperEmbedConfig) : null;
  } catch {
    return null;
  }
}

/** JSON object → base64url (for the `config` param). */
export function encodeConfigParam(cfg: FlipperEmbedConfig): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cfg));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
